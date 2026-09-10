-- 091_company_admin_inherits_purchasing_permissions.sql
-- A COMPANY_ADMIN operates across every Project in its Company. Ensure that
-- its permission set includes every capability currently assigned to the
-- project-scoped PURCHASING role, without removing its administrative grants.

begin;

do $$
declare
  v_company_admin_role_id uuid;
  v_purchasing_role_id uuid;
begin
  select role.id into strict v_company_admin_role_id
  from public.roles role
  where role.code = 'COMPANY_ADMIN'
    and role.scope = 'COMPANY'
    and role.active;

  select role.id into strict v_purchasing_role_id
  from public.roles role
  where role.code = 'PURCHASING'
    and role.scope = 'PROJECT'
    and role.active;

  insert into public.role_permissions(role_id, permission_id)
  select v_company_admin_role_id, assignment.permission_id
  from public.role_permissions assignment
  where assignment.role_id = v_purchasing_role_id
  on conflict do nothing;

  if exists (
    select assignment.permission_id
    from public.role_permissions assignment
    where assignment.role_id = v_purchasing_role_id
    except
    select assignment.permission_id
    from public.role_permissions assignment
    where assignment.role_id = v_company_admin_role_id
  ) then
    raise exception 'COMPANY_ADMIN_PURCHASING_PERMISSION_ALIGNMENT_FAILED';
  end if;
exception
  when no_data_found then
    raise exception 'COMPANY_ADMIN_OR_PURCHASING_ROLE_NOT_FOUND';
  when too_many_rows then
    raise exception 'COMPANY_ADMIN_OR_PURCHASING_ROLE_NOT_UNIQUE';
end;
$$;

commit;
