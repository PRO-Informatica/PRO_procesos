-- Replace Reception with Supervisor without changing role IDs or memberships.
-- Resident and Supervisor share operational access; only Resident may finish.
begin;

do $$
begin
  if not exists (select 1 from public.roles where code = 'RECEPTION' and scope = 'PROJECT' and active)
     or not exists (select 1 from public.roles where code = 'RESIDENT' and scope = 'PROJECT' and active)
     or exists (select 1 from public.roles where code = 'SUPERVISOR') then
    raise exception 'SUPERVISOR_ROLE_PREREQUISITES_INVALID';
  end if;
end;
$$;

insert into public.permissions(code, description, active)
values ('dispatch.complete', 'Finalizar despachos', true)
on conflict (code) do update set description = excluded.description, active = true;

-- Keep Resident's current permissions and include the existing guide/evidence
-- capabilities that previously required a second Reception assignment.
insert into public.role_permissions(role_id, permission_id)
select resident.id, assignment.permission_id
from public.roles resident
cross join public.roles reception
join public.role_permissions assignment on assignment.role_id = reception.id
where resident.code = 'RESIDENT' and reception.code = 'RECEPTION'
on conflict do nothing;

-- Preserve completion for other roles which already had dispatch.modify.
insert into public.role_permissions(role_id, permission_id)
select distinct role.id, completion.id
from public.roles role
join public.role_permissions assignment on assignment.role_id = role.id
join public.permissions permission on permission.id = assignment.permission_id
cross join public.permissions completion
where role.code <> 'RECEPTION'
  and permission.code = 'dispatch.modify'
  and completion.code = 'dispatch.complete'
on conflict do nothing;

-- The same role ID retains every historical and current assignment.
update public.roles set code = 'SUPERVISOR', name = 'Supervisor'
where code = 'RECEPTION';

delete from public.role_permissions assignment
using public.roles role
where assignment.role_id = role.id and role.code = 'SUPERVISOR';

insert into public.role_permissions(role_id, permission_id)
select supervisor.id, assignment.permission_id
from public.roles supervisor
cross join public.roles resident
join public.role_permissions assignment on assignment.role_id = resident.id
join public.permissions permission on permission.id = assignment.permission_id
where supervisor.code = 'SUPERVISOR' and resident.code = 'RESIDENT'
  and permission.code <> 'dispatch.complete';

-- Change only the permission check in the current completion implementation,
-- retaining all guide, evidence, version, billing and audit validations.
do $$
declare
  definition text := pg_get_functiondef('public.complete_dispatch(uuid,integer)'::regprocedure);
  needle text := 'v_dispatch.project_id, ''dispatch.modify''';
begin
  if (length(definition) - length(replace(definition, needle, ''))) / length(needle) <> 1 then
    raise exception 'COMPLETE_DISPATCH_PERMISSION_PATCH_MISMATCH';
  end if;
  execute replace(definition, needle, 'v_dispatch.project_id, ''dispatch.complete''');
end;
$$;

-- Reject unauthorized finalization before attempting to save any form fields.
create or replace function public.finalize_dispatch(
  p_dispatch_id uuid, p_expected_version integer,
  p_arrival_at timestamptz, p_departure_at timestamptz,
  p_received_by_name text, p_result public.dispatch_result,
  p_order_number text, p_real_volume numeric, p_real_unit_code text
)
returns integer
language plpgsql security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_project uuid;
  v_saved_version integer;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  select project_id into v_project from public.dispatches where id = p_dispatch_id;
  if not found then raise exception 'DISPATCH_NOT_FOUND'; end if;
  if not app_private.has_project_permission(v_project, 'dispatch.complete') then
    raise exception 'PERMISSION_DENIED';
  end if;
  v_saved_version := public.update_dispatch(
    p_dispatch_id, p_expected_version, p_arrival_at, p_departure_at,
    p_received_by_name, p_result, p_order_number, p_real_volume, p_real_unit_code
  );
  return public.complete_dispatch(p_dispatch_id, v_saved_version);
end;
$$;

alter function public.finalize_dispatch(uuid,integer,timestamptz,timestamptz,text,public.dispatch_result,text,numeric,text) owner to postgres;
revoke all on function public.finalize_dispatch(uuid,integer,timestamptz,timestamptz,text,public.dispatch_result,text,numeric,text) from public, anon;
grant execute on function public.finalize_dispatch(uuid,integer,timestamptz,timestamptz,text,public.dispatch_result,text,numeric,text) to authenticated;

commit;
