-- Keep the existing worksite address as primary and accept additional locations.
-- Existing projects, operational records, permissions and legacy RPCs are retained.
begin;

create function app_private.valid_project_additional_addresses(p_addresses text[])
returns boolean
language sql
immutable
set search_path = pg_catalog, app_private
as $$
  select p_addresses is not null
    and coalesce(array_ndims(p_addresses), 1) = 1
    and coalesce(array_lower(p_addresses, 1), 1) = 1
    and not exists (
      select 1 from unnest(p_addresses) address
      where address is null
        or char_length(btrim(address)) not between 5 and 300
        or address <> btrim(address)
        or app_private.normalize_address_identity(address) = ''
    )
    and cardinality(p_addresses) = (
      select count(distinct app_private.normalize_address_identity(address))
      from unnest(p_addresses) address
    );
$$;

alter function app_private.valid_project_additional_addresses(text[]) owner to postgres;
revoke all on function app_private.valid_project_additional_addresses(text[]) from public, anon, authenticated, service_role;

alter table public.projects
  add column additional_addresses text[] not null default '{}',
  add constraint projects_additional_addresses_ck
    check (app_private.valid_project_additional_addresses(additional_addresses));

create function public.platform_save_company_project(
  p_company_id uuid,
  p_project_id uuid,
  p_name text,
  p_code text,
  p_address text,
  p_additional_addresses text[],
  p_timezone text,
  p_status text,
  p_start_date date,
  p_estimated_end_date date,
  p_billing_legal_name text,
  p_billing_tax_id text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_project_id uuid;
  v_previous_address text;
  v_previous_additional text[] := '{}';
  v_additional text[];
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if not app_private.is_platform_admin() then raise exception 'PERMISSION_DENIED'; end if;
  if p_address is null or char_length(btrim(p_address)) not between 5 and 300
     or app_private.normalize_address_identity(p_address) = '' then
    raise exception 'PROJECT_ADDRESS_INVALID';
  end if;
  if p_additional_addresses is null or coalesce(array_ndims(p_additional_addresses), 1) <> 1
     or coalesce(array_lower(p_additional_addresses, 1), 1) <> 1 then
    raise exception 'PROJECT_ADDRESSES_INVALID';
  end if;
  select coalesce(array_agg(btrim(address) order by position), '{}')
  into v_additional from unnest(p_additional_addresses) with ordinality t(address, position);
  if not app_private.valid_project_additional_addresses(v_additional) then
    raise exception 'PROJECT_ADDRESSES_INVALID';
  end if;
  if exists (
    select 1 from unnest(v_additional) address
    where app_private.normalize_address_identity(address) = app_private.normalize_address_identity(p_address)
  ) then raise exception 'PROJECT_ADDRESS_DUPLICATE'; end if;

  if p_project_id is null then
    if upper(btrim(p_status)) is distinct from 'ACTIVE' then raise exception 'PROJECT_STATUS_INVALID'; end if;
    v_project_id := public.platform_create_company_project(
      p_company_id, p_name, p_code, p_address, p_timezone, p_start_date, p_estimated_end_date
    );
  else
    select address, additional_addresses into v_previous_address, v_previous_additional
    from public.projects where id = p_project_id and company_id = p_company_id for update;
    if not found then raise exception 'PROJECT_COMPANY_MISMATCH'; end if;
    v_project_id := public.platform_update_company_project(
      p_company_id, p_project_id, p_name, p_code, p_address, p_timezone,
      p_status, p_start_date, p_estimated_end_date
    );
  end if;

  perform public.platform_update_project_billing_identity(
    p_company_id, v_project_id, p_billing_legal_name, p_billing_tax_id
  );
  update public.projects set additional_addresses = v_additional where id = v_project_id;
  if v_previous_address is distinct from btrim(p_address)
     or v_previous_additional is distinct from v_additional then
    insert into public.audit_events(
      actor_user_id, company_id, project_id, entity_type, entity_id, action, old_values, new_values
    ) values (
      v_actor, p_company_id, v_project_id, 'project', v_project_id,
      'PROJECT_WORKSITE_ADDRESSES_UPDATED',
      jsonb_build_object('address', v_previous_address, 'additional_addresses', v_previous_additional),
      jsonb_build_object('address', btrim(p_address), 'additional_addresses', v_additional)
    );
  end if;
  return v_project_id;
end;
$$;

alter function public.platform_save_company_project(uuid,uuid,text,text,text,text[],text,text,date,date,text,text) owner to postgres;
revoke all on function public.platform_save_company_project(uuid,uuid,text,text,text,text[],text,text,date,date,text,text) from public, anon;
grant execute on function public.platform_save_company_project(uuid,uuid,text,text,text,text[],text,text,date,date,text,text) to authenticated, service_role;

-- Record the configured address that actually matched, rather than always the
-- primary one. Only an address belonging to this project can be recorded here.
do $$
declare
  v_definition text := pg_get_functiondef('public.reconcile_dispatch(uuid)'::regprocedure);
  v_previous text := 'project.billing_tax_id, v_payload ->> ''billing_tax_id'', project.address,';
  v_next text := 'project.billing_tax_id, v_payload ->> ''billing_tax_id'',
    case when (v_payload ->> ''matched_project_address'') = any(array[project.address] || project.additional_addresses)
      then v_payload ->> ''matched_project_address'' else project.address end,';
begin
  if length(v_definition) - length(replace(v_definition, v_previous, '')) <> length(v_previous) then
    raise exception 'PROJECT_ADDRESSES_RECONCILIATION_PREREQUISITE_CHANGED';
  end if;
  execute replace(v_definition, v_previous, v_next);
end;
$$;

notify pgrst, 'reload schema';
commit;
