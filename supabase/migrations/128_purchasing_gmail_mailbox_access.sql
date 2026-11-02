-- Show the Gmail connection indicator and allow mailbox access for Purchasing.
-- Sending mail remains governed by the separate gmail.mail.send permission.

begin;

do $$
declare
  v_role_id uuid;
  v_permission_id uuid;
begin
  select id into strict v_role_id
  from public.roles
  where code = 'PURCHASING'
    and scope = 'PROJECT'
    and active;

  select id into strict v_permission_id
  from public.permissions
  where code = 'gmail.mailbox.view'
    and active;

  insert into public.role_permissions(role_id, permission_id)
  values (v_role_id, v_permission_id)
  on conflict do nothing;

  if not exists (
    select 1
    from public.role_permissions
    where role_id = v_role_id
      and permission_id = v_permission_id
  ) then
    raise exception 'PURCHASING_GMAIL_MAILBOX_GRANT_FAILED';
  end if;
exception
  when no_data_found then
    raise exception 'ACTIVE_PURCHASING_OR_GMAIL_MAILBOX_PERMISSION_MISSING';
  when too_many_rows then
    raise exception 'PURCHASING_OR_GMAIL_MAILBOX_PERMISSION_NOT_UNIQUE';
end;
$$;

commit;
