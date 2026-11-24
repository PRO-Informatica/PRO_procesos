-- Residents consult billing records; Purchasing consults operational records.
begin;

delete from public.role_permissions as grant_row
using public.roles as role, public.permissions as permission
where grant_row.role_id = role.id
  and grant_row.permission_id = permission.id
  and role.scope = 'PROJECT'
  and (
    (
      role.code = 'RESIDENT'
      and permission.code ~ '^(batch|invoice)[.]'
      and permission.code not in ('batch.view', 'invoice.view')
    )
    or (
      role.code = 'PURCHASING'
      and permission.code ~ '^(programming|dispatch)[.]'
      and permission.code not in ('programming.view', 'dispatch.view')
    )
  );

commit;
