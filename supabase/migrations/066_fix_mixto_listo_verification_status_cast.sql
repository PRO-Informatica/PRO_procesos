-- 066_fix_mixto_listo_verification_status_cast.sql
-- READY FOR MANUAL EXECUTION — NOT YET EXECUTED.
--
-- Minimal hotfix for the applied 065 confirmation RPC. PostgreSQL resolves
-- the CASE branches as text unless the extraction verification enum is
-- explicit, which blocks every Mixto Listo confirmation before Invoice
-- persistence.

begin;

do $$
declare
  v_signature regprocedure := to_regprocedure(
    'public.confirm_mixto_listo_invoice_intake(uuid,text,jsonb,uuid,text)'
  );
  v_definition text;
  v_original text :=
    'verification_status = case when v_changed then ''CORRECTED'' else ''CONFIRMED'' end,';
  v_replacement text :=
    'verification_status = case when v_changed then ''CORRECTED''::public.extraction_verification_status else ''CONFIRMED''::public.extraction_verification_status end,';
begin
  if v_signature is null then
    raise exception 'MIXTO_LISTO_CONFIRMATION_RPC_MISSING';
  end if;

  select pg_get_functiondef(v_signature) into v_definition;

  if position(v_replacement in v_definition) > 0 then
      raise exception 'MIXTO_LISTO_VERIFICATION_STATUS_CAST_ALREADY_FIXED';
  end if;

  if position(v_original in v_definition) = 0 then
    raise exception 'MIXTO_LISTO_CONFIRMATION_DEFINITION_DRIFT';
  end if;

  v_definition := replace(v_definition, v_original, v_replacement);
  execute v_definition;

  select pg_get_functiondef(v_signature) into v_definition;
  if position(v_replacement in v_definition) = 0
     or position(v_original in v_definition) > 0 then
    raise exception 'MIXTO_LISTO_VERIFICATION_STATUS_CAST_NOT_APPLIED';
  end if;
end;
$$;

alter function public.confirm_mixto_listo_invoice_intake(
  uuid,text,jsonb,uuid,text
) owner to postgres;

revoke all on function public.confirm_mixto_listo_invoice_intake(
  uuid,text,jsonb,uuid,text
) from public, anon;

grant execute on function public.confirm_mixto_listo_invoice_intake(
  uuid,text,jsonb,uuid,text
) to authenticated, service_role;

commit;
