-- Integration QA for 110. Uses the real RPC and triggers with authenticated
-- callers. All fixtures and changes are rolled back, including fault injection.
begin;

create function pg_temp.reject_company_project_audit()
returns trigger language plpgsql as $$
begin
  if current_setting('qa.reject_company_project_audit', true) = 'on'
     and new.action = 'PROJECT_DISABLED_WITH_COMPANY' then
    raise exception 'QA_SIMULATED_PROJECT_AUDIT_FAILURE';
  end if;
  return new;
end;
$$;

create trigger qa_reject_company_project_audit
before insert on public.audit_events
for each row execute function pg_temp.reject_company_project_audit();

do $$
declare
  v_actor uuid;
  v_company uuid := gen_random_uuid();
  v_other_company uuid := gen_random_uuid();
  v_active_project uuid := gen_random_uuid();
  v_second_project uuid := gen_random_uuid();
  v_inactive_project uuid := gen_random_uuid();
  v_closed_project uuid := gen_random_uuid();
  v_other_project uuid := gen_random_uuid();
  v_audit_count integer;
begin
  select admin.user_id into strict v_actor
  from public.platform_admins admin
  join public.profiles profile on profile.id = admin.user_id
  where admin.active and profile.active
  order by admin.user_id limit 1;

  insert into public.companies(id, name, code, status) values
    (v_company, 'Company cascade QA', 'QA-' || v_company::text, 'ACTIVE'),
    (v_other_company, 'Other company QA', 'QA-' || v_other_company::text, 'ACTIVE');

  insert into public.projects(id, company_id, name, code, address, status) values
    (v_active_project, v_company, 'Active QA', v_active_project::text, '9 calle 5A-62 zona 9', 'ACTIVE'),
    (v_second_project, v_company, 'Second QA', v_second_project::text, '9 calle 5A-62 zona 9', 'ACTIVE'),
    (v_inactive_project, v_company, 'Inactive QA', v_inactive_project::text, '9 calle 5A-62 zona 9', 'INACTIVE'),
    (v_closed_project, v_company, 'Closed QA', v_closed_project::text, '9 calle 5A-62 zona 9', 'CLOSED'),
    (v_other_project, v_other_company, 'Other QA', v_other_project::text, '9 calle 5A-62 zona 9', 'ACTIVE');

  perform set_config('request.jwt.claim.sub', v_actor::text, true);
  execute 'set local role authenticated';
  perform public.platform_set_company_status(v_company, false);
  execute 'reset role';

  if (select status from public.companies where id = v_company) <> 'INACTIVE'
     or exists (select 1 from public.projects where company_id = v_company and status = 'ACTIVE')
     or (select status from public.projects where id = v_closed_project) <> 'CLOSED'
     or (select status from public.projects where id = v_inactive_project) <> 'INACTIVE'
     or (select status from public.projects where id = v_other_project) <> 'ACTIVE'
     or (select count(*) from public.projects where company_id = v_company) <> 4 then
    raise exception 'QA_COMPANY_CASCADE_OR_ISOLATION_FAILED';
  end if;
  raise notice 'PASS: deactivation cascades, preserves closed/inactive projects and isolates companies';

  select count(*) into v_audit_count from public.audit_events
  where company_id = v_company and action = 'PROJECT_DISABLED_WITH_COMPANY'
    and actor_user_id = v_actor
    and old_values->>'status' = 'ACTIVE' and new_values->>'status' = 'INACTIVE';
  if v_audit_count <> 2 then raise exception 'QA_PROJECT_CASCADE_AUDIT_FAILED'; end if;

  -- A direct activation, a new active Project, and moving an active Project
  -- from another Company must all be rejected by the database guard.
  begin
    update public.projects set status = 'ACTIVE' where id = v_active_project;
    raise exception 'QA_PROJECT_ACTIVATION_NOT_BLOCKED';
  exception when raise_exception then
    if sqlerrm <> 'PROJECT_COMPANY_INACTIVE' then raise; end if;
  end;
  begin
    insert into public.projects(company_id, name, code, address)
    values (v_company, 'Rejected QA', gen_random_uuid()::text, '9 calle 5A-62 zona 9');
    raise exception 'QA_PROJECT_CREATION_NOT_BLOCKED';
  exception when raise_exception then
    if sqlerrm <> 'PROJECT_COMPANY_INACTIVE' then raise; end if;
  end;
  begin
    update public.projects set company_id = v_company where id = v_other_project;
    raise exception 'QA_PROJECT_MOVE_NOT_BLOCKED';
  exception when raise_exception then
    if sqlerrm <> 'PROJECT_COMPANY_INACTIVE' then raise; end if;
  end;

  -- The existing edit RPC is also covered, so a forged form cannot reactivate.
  execute 'set local role authenticated';
  begin
    perform public.platform_update_company_project(
      v_company, v_active_project, 'Active QA', v_active_project::text,
      '9 calle 5A-62 zona 9', 'America/Guatemala', 'ACTIVE', null, null
    );
    raise exception 'QA_PROJECT_RPC_ACTIVATION_NOT_BLOCKED';
  exception when raise_exception then
    if sqlerrm <> 'PROJECT_COMPANY_INACTIVE' then raise; end if;
  end;
  execute 'reset role';
  raise notice 'PASS: creation, activation, reassignment and edit RPC enforce Company state';

  execute 'set local role authenticated';
  perform public.platform_set_company_status(v_company, false);
  execute 'reset role';
  if (select count(*) from public.audit_events
      where company_id = v_company and action = 'PROJECT_DISABLED_WITH_COMPANY') <> 2 then
    raise exception 'QA_PROJECT_CASCADE_DUPLICATE_AUDIT';
  end if;
  raise notice 'PASS: audit records the actor and repeated deactivation is idempotent';

  execute 'set local role authenticated';
  perform public.platform_set_company_status(v_company, true);
  execute 'reset role';
  if exists (select 1 from public.projects where company_id = v_company and status = 'ACTIVE') then
    raise exception 'QA_PROJECTS_REACTIVATED_AUTOMATICALLY';
  end if;
  execute 'set local role authenticated';
  perform public.platform_update_company_project(
    v_company, v_active_project, 'Active QA', v_active_project::text,
    '9 calle 5A-62 zona 9', 'America/Guatemala', 'ACTIVE', null, null
  );
  execute 'reset role';
  if (select status from public.projects where id = v_active_project) <> 'ACTIVE' then
    raise exception 'QA_PROJECT_MANUAL_REACTIVATION_FAILED';
  end if;
  raise notice 'PASS: enabling Company keeps Projects disabled; manual reactivation works afterward';

  -- Reject the cascade audit to prove the Company and its Projects roll back
  -- together, even if the failure occurs during a dependent write.
  perform set_config('qa.reject_company_project_audit', 'on', true);
  execute 'set local role authenticated';
  begin
    perform public.platform_set_company_status(v_company, false);
    raise exception 'QA_EXPECTED_ATOMIC_FAILURE_MISSING';
  exception when raise_exception then
    if sqlerrm <> 'QA_SIMULATED_PROJECT_AUDIT_FAILURE' then raise; end if;
  end;
  execute 'reset role';
  perform set_config('qa.reject_company_project_audit', 'off', true);
  if (select status from public.companies where id = v_company) <> 'ACTIVE'
     or (select status from public.projects where id = v_active_project) <> 'ACTIVE' then
    raise exception 'QA_COMPANY_CASCADE_ATOMIC_ROLLBACK_FAILED';
  end if;
  raise notice 'PASS: dependent failure rolls back Company and Project status together';

  perform set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
  execute 'set local role authenticated';
  begin
    perform public.platform_set_company_status(v_company, false);
    raise exception 'QA_UNAUTHORIZED_COMPANY_CHANGE_ALLOWED';
  exception when raise_exception then
    if sqlerrm <> 'PERMISSION_DENIED' then raise; end if;
  end;
  execute 'reset role';
  if (select status from public.companies where id = v_company) <> 'ACTIVE' then
    raise exception 'QA_UNAUTHORIZED_COMPANY_CHANGE_PERSISTED';
  end if;
  if has_function_privilege('authenticated', 'app_private.disable_inactive_company_projects()', 'EXECUTE')
     or has_function_privilege('authenticated', 'app_private.require_active_project_company()', 'EXECUTE')
     or has_function_privilege('anon', 'app_private.disable_inactive_company_projects()', 'EXECUTE')
     or has_function_privilege('anon', 'app_private.require_active_project_company()', 'EXECUTE') then
    raise exception 'QA_COMPANY_PROJECT_TRIGGER_EXPOSED';
  end if;
  raise notice 'PASS: unauthorized callers are rejected and trigger helpers are private';
end;
$$;

rollback;
