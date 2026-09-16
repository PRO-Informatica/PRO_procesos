-- 102_restore_rbac_catalog.sql
-- Restores the canonical RBAC configuration omitted by structure-only clones.
-- This migration inserts only missing permissions and role assignments. It does
-- not remove roles, permissions, assignments, memberships, users, or operational data.

begin;

do $$
begin
  if to_regclass('public.roles') is null
    or to_regclass('public.permissions') is null
    or to_regclass('public.role_permissions') is null then
    raise exception 'RBAC_CATALOG_TABLES_MISSING';
  end if;

  if exists (
    select required.code
    from (
      values
        ('COMPANY_ADMIN'),
        ('FINAL_AUTHORIZER'),
        ('PURCHASING'),
        ('RECEPTION'),
        ('RESIDENT')
    ) as required(code)
    left join public.roles role
      on role.code = required.code
     and role.active
    where role.id is null
  ) then
    raise exception 'CANONICAL_ACTIVE_ROLES_MISSING';
  end if;
end;
$$;

create temporary table expected_permissions (
  code text primary key,
  description text not null
) on commit drop;

insert into expected_permissions(code, description)
values
  ('audit.view', 'Ver auditoría'),
  ('batch.create', 'Crear lotes'),
  ('batch.final_authorize', 'Autorizar lote'),
  ('batch.modify', 'Modificar lote'),
  ('batch.reopen', 'Reabrir lote'),
  ('batch.request_authorization', 'Solicitar autorización'),
  ('batch.review', 'Validar lote'),
  ('batch.submit_review', 'Enviar lote a revisión'),
  ('batch.view', 'Ver lotes'),
  ('dispatch.create', 'Registrar despachos'),
  ('dispatch.modify', 'Modificar despacho permitido'),
  ('dispatch.register_incident', 'Registrar incidencias'),
  ('dispatch.view', 'Ver despachos'),
  ('document.replace', 'Reemplazar documento'),
  ('document.upload', 'Cargar documentos'),
  ('document.view', 'Ver documentos'),
  ('invoice.create', 'Registrar factura'),
  ('invoice.match', 'Relacionar factura y guía'),
  ('invoice.request_reinvoice', 'Gestionar refacturación'),
  ('invoice.review', 'Validar factura'),
  ('invoice.universal', 'Procesar facturas universalmente en el proyecto'),
  ('invoice.view', 'Ver facturación'),
  ('programming.cancel', 'Cancelar programaciones'),
  ('programming.close', 'Cerrar programación'),
  ('programming.confirm', 'Confirmar programaciones'),
  ('programming.create', 'Crear programaciones'),
  ('programming.modify', 'Modificar programaciones'),
  ('programming.view', 'Ver programaciones'),
  ('project.manage_members', 'Administrar miembros del proyecto'),
  ('project.manage_suppliers', 'Administrar proveedores del proyecto'),
  ('project.view', 'Ver proyecto');

do $$
begin
  if exists (
    select 1
    from public.permissions permission
    join expected_permissions expected using (code)
    where permission.description is distinct from expected.description
       or not permission.active
  ) then
    raise exception 'EXISTING_PERMISSION_DIFFERS_FROM_CANONICAL_CATALOG';
  end if;
end;
$$;

insert into public.permissions(code, description, active)
select code, description, true
from expected_permissions
on conflict (code) do nothing;

create temporary table expected_role_permissions (
  role_code text not null,
  permission_code text not null,
  primary key (role_code, permission_code)
) on commit drop;

insert into expected_role_permissions(role_code, permission_code)
values
  ('COMPANY_ADMIN', 'audit.view'),
  ('COMPANY_ADMIN', 'batch.create'),
  ('COMPANY_ADMIN', 'batch.final_authorize'),
  ('COMPANY_ADMIN', 'batch.modify'),
  ('COMPANY_ADMIN', 'batch.reopen'),
  ('COMPANY_ADMIN', 'batch.request_authorization'),
  ('COMPANY_ADMIN', 'batch.review'),
  ('COMPANY_ADMIN', 'batch.submit_review'),
  ('COMPANY_ADMIN', 'batch.view'),
  ('COMPANY_ADMIN', 'dispatch.create'),
  ('COMPANY_ADMIN', 'dispatch.modify'),
  ('COMPANY_ADMIN', 'dispatch.register_incident'),
  ('COMPANY_ADMIN', 'dispatch.view'),
  ('COMPANY_ADMIN', 'document.replace'),
  ('COMPANY_ADMIN', 'document.upload'),
  ('COMPANY_ADMIN', 'document.view'),
  ('COMPANY_ADMIN', 'invoice.create'),
  ('COMPANY_ADMIN', 'invoice.match'),
  ('COMPANY_ADMIN', 'invoice.request_reinvoice'),
  ('COMPANY_ADMIN', 'invoice.review'),
  ('COMPANY_ADMIN', 'invoice.universal'),
  ('COMPANY_ADMIN', 'invoice.view'),
  ('COMPANY_ADMIN', 'programming.cancel'),
  ('COMPANY_ADMIN', 'programming.close'),
  ('COMPANY_ADMIN', 'programming.confirm'),
  ('COMPANY_ADMIN', 'programming.create'),
  ('COMPANY_ADMIN', 'programming.modify'),
  ('COMPANY_ADMIN', 'programming.view'),
  ('COMPANY_ADMIN', 'project.manage_members'),
  ('COMPANY_ADMIN', 'project.manage_suppliers'),
  ('COMPANY_ADMIN', 'project.view'),
  ('FINAL_AUTHORIZER', 'batch.final_authorize'),
  ('FINAL_AUTHORIZER', 'batch.view'),
  ('FINAL_AUTHORIZER', 'document.view'),
  ('FINAL_AUTHORIZER', 'invoice.view'),
  ('FINAL_AUTHORIZER', 'project.view'),
  ('PURCHASING', 'batch.create'),
  ('PURCHASING', 'batch.modify'),
  ('PURCHASING', 'batch.request_authorization'),
  ('PURCHASING', 'batch.submit_review'),
  ('PURCHASING', 'batch.view'),
  ('PURCHASING', 'dispatch.view'),
  ('PURCHASING', 'document.upload'),
  ('PURCHASING', 'document.view'),
  ('PURCHASING', 'invoice.create'),
  ('PURCHASING', 'invoice.match'),
  ('PURCHASING', 'invoice.request_reinvoice'),
  ('PURCHASING', 'invoice.review'),
  ('PURCHASING', 'invoice.universal'),
  ('PURCHASING', 'invoice.view'),
  ('PURCHASING', 'programming.view'),
  ('PURCHASING', 'project.view'),
  ('RECEPTION', 'dispatch.create'),
  ('RECEPTION', 'dispatch.modify'),
  ('RECEPTION', 'dispatch.register_incident'),
  ('RECEPTION', 'dispatch.view'),
  ('RECEPTION', 'document.upload'),
  ('RECEPTION', 'document.view'),
  ('RECEPTION', 'programming.view'),
  ('RECEPTION', 'project.view'),
  ('RESIDENT', 'batch.review'),
  ('RESIDENT', 'batch.view'),
  ('RESIDENT', 'dispatch.view'),
  ('RESIDENT', 'document.view'),
  ('RESIDENT', 'invoice.review'),
  ('RESIDENT', 'invoice.view'),
  ('RESIDENT', 'programming.cancel'),
  ('RESIDENT', 'programming.close'),
  ('RESIDENT', 'programming.confirm'),
  ('RESIDENT', 'programming.create'),
  ('RESIDENT', 'programming.modify'),
  ('RESIDENT', 'programming.view'),
  ('RESIDENT', 'project.view');

insert into public.role_permissions(role_id, permission_id)
select role.id, permission.id
from expected_role_permissions expected
join public.roles role
  on role.code = expected.role_code
 and role.active
join public.permissions permission
  on permission.code = expected.permission_code
 and permission.active
on conflict do nothing;

do $$
begin
  if (select count(*) from expected_permissions) <> 31 then
    raise exception 'CANONICAL_PERMISSION_COUNT_INVALID';
  end if;

  if (select count(*) from expected_role_permissions) <> 73 then
    raise exception 'CANONICAL_ROLE_PERMISSION_COUNT_INVALID';
  end if;

  if exists (
    select expected.role_code, expected.permission_code
    from expected_role_permissions expected
    except
    select role.code, permission.code
    from public.role_permissions assignment
    join public.roles role on role.id = assignment.role_id
    join public.permissions permission on permission.id = assignment.permission_id
  ) then
    raise exception 'CANONICAL_ROLE_PERMISSION_ASSIGNMENT_MISSING';
  end if;
end;
$$;

commit;
