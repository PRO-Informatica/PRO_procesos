-- 074_discard_pending_mixto_listo_invoice_intake.sql
-- READY FOR MANUAL EXECUTION — NOT YET EXECUTED.
--
-- Allows authorized users to discard an unconfirmed Mixto Listo Invoice
-- intake. The PDF and extraction remain available for audit; the intake is
-- moved to FAILED so it leaves the pending review workflow permanently.

begin;

do $$
begin
  if to_regclass('public.mixto_listo_invoice_intakes') is null
     or to_regclass('public.audit_events') is null
     or to_regprocedure(
       'app_private.has_project_permission(uuid,text)'
     ) is null then
    raise exception 'DISCARD_INVOICE_INTAKE_REQUIRED_CONTRACT_MISSING';
  end if;

  if to_regprocedure(
       'public.discard_mixto_listo_invoice_intake(uuid,text)'
     ) is not null then
    raise exception 'DISCARD_INVOICE_INTAKE_CONTRACT_ALREADY_EXISTS';
  end if;
end;
$$;

create function public.discard_mixto_listo_invoice_intake(
  p_intake_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_intake public.mixto_listo_invoice_intakes%rowtype;
  v_reason text := nullif(btrim(p_reason), '');
  v_company_id uuid;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;

  select intake.* into v_intake
  from public.mixto_listo_invoice_intakes intake
  where intake.id = p_intake_id
  for update;
  if not found then raise exception 'MIXTO_LISTO_INTAKE_NOT_FOUND'; end if;

  if not app_private.has_project_permission(
       v_intake.project_id, 'invoice.create'
     ) then
    raise exception 'PERMISSION_DENIED';
  end if;
  if v_intake.status = 'CONFIRMED'
     or v_intake.confirmed_invoice_id is not null then
    raise exception 'MIXTO_LISTO_CONFIRMED_INTAKE_NOT_DISCARDABLE';
  end if;
  if v_intake.status = 'FAILED' then
    return v_intake.id;
  end if;
  if v_intake.status not in (
    'UPLOAD_PENDING', 'EXTRACTION_PENDING', 'READY_TO_CONFIRM',
    'ORDER_MISMATCH', 'NEEDS_CORRECTION'
  ) then
    raise exception 'MIXTO_LISTO_INTAKE_NOT_DISCARDABLE';
  end if;
  if v_reason is null or char_length(v_reason) > 500 then
    raise exception 'MIXTO_LISTO_DISCARD_REASON_INVALID';
  end if;

  update public.mixto_listo_invoice_intakes
  set status = 'FAILED',
      updated_at = now()
  where id = v_intake.id;

  select project.company_id into v_company_id
  from public.projects project
  where project.id = v_intake.project_id;

  insert into public.audit_events(
    actor_user_id, company_id, project_id, entity_type,
    entity_id, action, old_values, new_values, comment
  ) values (
    v_actor, v_company_id, v_intake.project_id, 'invoice_intake',
    v_intake.id, 'MIXTO_LISTO_INVOICE_INTAKE_DISCARDED',
    jsonb_build_object(
      'status', v_intake.status,
      'invoice_number', v_intake.invoice_number,
      'reconciliation_order_id', v_intake.reconciliation_order_id
    ),
    jsonb_build_object(
      'status', 'FAILED',
      'document_preserved', true,
      'extraction_preserved', v_intake.extraction_id is not null
    ),
    v_reason
  );

  return v_intake.id;
end;
$$;

alter function public.discard_mixto_listo_invoice_intake(uuid,text)
owner to postgres;
revoke all on function public.discard_mixto_listo_invoice_intake(uuid,text)
from public, anon;
grant execute on function public.discard_mixto_listo_invoice_intake(uuid,text)
to authenticated, service_role;

do $$
begin
  if not has_function_privilege(
       'authenticated',
       'public.discard_mixto_listo_invoice_intake(uuid,text)',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.discard_mixto_listo_invoice_intake(uuid,text)',
       'EXECUTE'
     ) then
    raise exception 'DISCARD_INVOICE_INTAKE_SECURITY_NOT_ALIGNED';
  end if;
end;
$$;

commit;

-- Live QA after manual execution:
--   * invoice.create can discard READY_TO_CONFIRM/ORDER_MISMATCH/correction;
--   * the discarded intake leaves the pending review list;
--   * its PDF and extraction remain preserved for audit;
--   * a CONFIRMED intake cannot be discarded;
--   * users outside the Project and anon cannot execute the operation.
