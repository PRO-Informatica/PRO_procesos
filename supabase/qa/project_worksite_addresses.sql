-- Synthetic configuration and RPC checks; always executed inside a rolled-back transaction.
begin;
do $$
declare
  v_actor uuid;
  v_company uuid;
  v_other_company uuid;
  v_project uuid;
  v_name text := 'QA multi-address project';
  v_code text := 'QA-ADDR-' || left(gen_random_uuid()::text, 8);
  v_primary text := '9 CALLE 5A-62 ZONA 9 QUETZALTENANGO';
  v_secondary text := 'CALLE PRINCIPAL LOTE 2 CASA 18 ZONA 4';
  v_third text := '10 CALLE 3-42 ZONA 8 GUATEMALA';
  v_before bigint;
begin
  select p.id into strict v_actor
  from public.profiles p join public.platform_admins a on a.user_id = p.id
  where p.active and a.active order by p.id limit 1;
  insert into public.companies(code, name) values ('QA-ADDR-' || left(gen_random_uuid()::text, 8), 'QA multiple addresses') returning id into v_company;
  insert into public.companies(code, name) values ('QA-ADDR-' || left(gen_random_uuid()::text, 8), 'QA other company') returning id into v_other_company;
  perform set_config('request.jwt.claim.sub', v_actor::text, true);
  execute 'set local role authenticated';
  v_project := public.platform_save_company_project(v_company, null, v_name, v_code, v_primary,
    array[v_secondary, v_third], 'America/Guatemala', 'ACTIVE', null, null, 'QA legal entity', '1234567');
  execute 'reset role';
  if not exists (select 1 from public.projects where id = v_project and address = v_primary
    and additional_addresses = array[v_secondary, v_third] and billing_legal_name = 'QA legal entity') then
    raise exception 'QA_ADDRESSES_CREATE_ROUNDTRIP_FAILED';
  end if;

  -- Reordering the primary address, editing, and removing alternatives all work.
  execute 'set local role authenticated';
  perform public.platform_save_company_project(v_company, v_project, v_name, v_code, v_secondary,
    array[v_primary, v_third], 'America/Guatemala', 'ACTIVE', null, null, 'QA legal entity', '1234567');
  execute 'reset role';
  if not exists (select 1 from public.projects where id = v_project and address = v_secondary
    and additional_addresses = array[v_primary, v_third]) then raise exception 'QA_ADDRESSES_EDIT_FAILED'; end if;
  execute 'set local role authenticated';
  perform public.platform_save_company_project(v_company, v_project, v_name, v_code, v_primary,
    '{}', 'America/Guatemala', 'ACTIVE', null, null, 'QA legal entity', '1234567');
  execute 'reset role';
  if not exists (select 1 from public.projects where id = v_project and cardinality(additional_addresses) = 0) then
    raise exception 'QA_ADDRESSES_REMOVE_FAILED';
  end if;

  -- Invalid rows and normalized duplicates fail without changing the saved project.
  execute 'set local role authenticated';
  begin
    perform public.platform_save_company_project(v_company, v_project, v_name, v_code, v_primary,
      array[''], 'America/Guatemala', 'ACTIVE', null, null, 'QA legal entity', '1234567');
    raise exception 'QA_EMPTY_ADDRESS_ALLOWED';
  exception when raise_exception then if sqlerrm <> 'PROJECT_ADDRESSES_INVALID' then raise; end if; end;
  begin
    perform public.platform_save_company_project(v_company, v_project, v_name, v_code, v_primary,
      array[lower(replace(v_primary, '-', ' '))], 'America/Guatemala', 'ACTIVE', null, null, 'QA legal entity', '1234567');
    raise exception 'QA_DUPLICATE_ADDRESS_ALLOWED';
  exception when raise_exception then if sqlerrm <> 'PROJECT_ADDRESS_DUPLICATE' then raise; end if; end;
  begin
    perform public.platform_save_company_project(v_other_company, v_project, v_name, v_code, v_primary,
      '{}', 'America/Guatemala', 'ACTIVE', null, null, 'QA legal entity', '1234567');
    raise exception 'QA_CROSS_COMPANY_EDIT_ALLOWED';
  exception when raise_exception then if sqlerrm <> 'PROJECT_COMPANY_MISMATCH' then raise; end if; end;
  execute 'reset role';

  -- Billing and addresses are atomic: even a late failure cannot leave a new project.
  select count(*) into v_before from public.projects;
  execute 'set local role authenticated';
  begin
    perform public.platform_save_company_project(v_company, null, v_name, v_code || '-BAD', v_primary,
      array[v_secondary], 'America/Guatemala', 'ACTIVE', null, null, '', '1234567');
    raise exception 'QA_INVALID_BILLING_ALLOWED';
  exception when raise_exception then if sqlerrm <> 'PROJECT_BILLING_LEGAL_NAME_INVALID' then raise; end if; end;
  execute 'reset role';
  if (select count(*) from public.projects) <> v_before then raise exception 'QA_PARTIAL_PROJECT_CREATED'; end if;
  if not exists (select 1 from public.projects where id = v_project and address = v_primary and cardinality(additional_addresses) = 0) then
    raise exception 'QA_INVALID_EDIT_CHANGED_PROJECT';
  end if;

  perform set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
  execute 'set local role authenticated';
  begin
    perform public.platform_save_company_project(v_company, v_project, v_name, v_code, v_primary,
      array[v_secondary], 'America/Guatemala', 'ACTIVE', null, null, 'QA legal entity', '1234567');
    raise exception 'QA_NON_ADMIN_ALLOWED';
  exception when raise_exception then if sqlerrm <> 'PERMISSION_DENIED' then raise; end if; end;
  execute 'reset role';
  if has_function_privilege('anon', 'public.platform_save_company_project(uuid,uuid,text,text,text,text[],text,text,date,date,text,text)', 'EXECUTE') then
    raise exception 'QA_ANONYMOUS_EXECUTION_ALLOWED';
  end if;
  raise notice 'PASS: address creation/edit/removal, primary reorder, invalid/duplicate rows, atomic billing failure, tenant isolation, non-admin and anonymous denial; rollback';
end;
$$;
rollback;
