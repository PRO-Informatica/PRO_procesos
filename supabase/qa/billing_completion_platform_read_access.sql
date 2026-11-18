-- Read-only authorization regression checks. JWT context and temporary helpers roll back.
begin;

create function pg_temp.expect_billing_error(p_projects uuid[], p_message text)
returns void language plpgsql as $$
begin
  begin
    perform public.get_dispatch_billing_completion(p_projects);
  exception when others then
    if sqlerrm = p_message then return; end if;
    raise;
  end;
  raise exception 'QA_EXPECTED_BILLING_ERROR:%', p_message;
end;
$$;

do $$
declare
  v_admin uuid;
  v_project uuid;
  v_projects uuid[];
  v_actual jsonb;
  v_expected jsonb;
  v_actor record;
  v_allowed boolean := false;
  v_denied boolean := false;
begin
  select pa.user_id into strict v_admin
    from public.platform_admins pa join public.profiles p on p.id=pa.user_id
    where pa.active and p.active order by pa.user_id limit 1;
  select array_agg(id order by id) into v_projects from public.projects;
  if coalesce(cardinality(v_projects), 0)=0 then raise exception 'QA_PROJECT_REQUIRED'; end if;

  perform set_config('request.jwt.claims', '{}', true);
  perform set_config('request.jwt.claim.sub', '', true);
  execute 'set local role authenticated';
  perform pg_temp.expect_billing_error(v_projects, 'AUTH_REQUIRED');
  execute 'reset role';

  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  select coalesce(jsonb_object_agg(d.id::text, app_private.dispatch_billing_complete(d.id)), '{}'::jsonb)
    into v_expected from public.dispatches d where d.project_id=any(v_projects);
  execute 'set local role authenticated';
  v_actual := public.get_dispatch_billing_completion(v_projects);
  perform pg_temp.expect_billing_error(null, 'PROJECT_IDS_INVALID');
  perform pg_temp.expect_billing_error(array[null]::uuid[], 'PROJECT_IDS_INVALID');
  perform pg_temp.expect_billing_error(array_fill(v_projects[1], array[1001]), 'PROJECT_IDS_INVALID');
  if public.get_dispatch_billing_completion('{}'::uuid[]) <> '{}'::jsonb then
    raise exception 'QA_EMPTY_PROJECTS_FAILED';
  end if;
  execute 'reset role';
  if v_actual is distinct from v_expected then raise exception 'QA_COMPLETION_CALCULATION_CHANGED'; end if;

  -- Existing operational roles continue to determine non-platform access.
  for v_actor in select p.id from public.profiles p where p.active
    and not exists(select 1 from public.platform_admins pa where pa.user_id=p.id and pa.active)
  loop
    perform set_config('request.jwt.claim.sub', v_actor.id::text, true);
    foreach v_project in array v_projects loop
      if app_private.has_project_permission(v_project, 'batch.view')
        or app_private.has_project_permission(v_project, 'dispatch.view')
        or app_private.has_project_permission(v_project, 'programming.view') then
        execute 'set local role authenticated';
        perform public.get_dispatch_billing_completion(array[v_project]);
        execute 'reset role';
        v_allowed := true;
      else
        execute 'set local role authenticated';
        perform pg_temp.expect_billing_error(array[v_project], 'PERMISSION_DENIED');
        execute 'reset role';
        v_denied := true;
      end if;
    end loop;
  end loop;
  if not v_allowed or not v_denied then raise exception 'QA_ALLOWED_AND_DENIED_ACTORS_REQUIRED'; end if;
end;
$$;

rollback;
