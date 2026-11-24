-- Enable Gmail connection and mailbox access for company administrators.
begin;

do $$
declare
  v_role_id uuid;
  v_permission_id uuid;
begin
  select id into strict v_role_id
  from public.roles
  where code = 'COMPANY_ADMIN'
    and scope = 'COMPANY'
    and active;

  select id into strict v_permission_id
  from public.permissions
  where code = 'gmail.mailbox.view'
    and active;

  insert into public.role_permissions (role_id, permission_id)
  values (v_role_id, v_permission_id)
  on conflict do nothing;
end;
$$;

commit;
