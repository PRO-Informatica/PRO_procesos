# Propuestas de base de datos

Los archivos de esta carpeta son borradores para revisión. No forman parte de `supabase/migrations` y no deben ejecutarse automáticamente.

## Platform Phase 5: plantilla fija de Guía de despacho

Aprobada y promovida a migration, todavía **no ejecutada**:

- proposal: `20260829_dispatch_guide_lines.sql`
- migration: `../migrations/045_default_dispatch_guide_template.sql`

Propone productos repetibles mediante `dispatch_guide_lines`, conserva
`dispatch_guides.quantity` como agregado derivado para compatibilidad con las
RPC actuales y añade un snapshot textual de la persona que recibe. No crea
Company Templates, form-builder ni matching por código de producto.

## Platform Admin: administración maestra de usuarios

Ejecutada manualmente y promovida al registro oficial:

- proposal: `20260828_platform_admin_user_access_management.sql`
- migration: `../migrations/044_platform_admin_user_access_management.sql`

Incluye RPC `SECURITY DEFINER` para editar `profiles.full_name`, administrar memberships de empresa/proyecto y asignar o revocar roles desde PLATFORM_ADMIN. No incluye passwords: esas operaciones permanecen exclusivamente en Supabase Auth Admin server-side.

> `20260827_platform_admin_global_read.sql` está obsoleto y no debe ejecutarse. La migration equivalente `043_platform_admin_global_read.sql` ya fue aplicada manualmente en Supabase, incluyendo global SELECT sobre `notifications` y las actualizaciones de los helpers de documentos y Storage.

## Platform Admin: lectura global

Propuesta actual: `20260827_platform_admin_global_read.sql`.

Objetivo:

- añadir visibilidad global de sólo lectura para `PLATFORM_ADMIN`;
- conservar todas las policies de membresía y permisos existentes;
- no conceder mutaciones operacionales;
- mantener privado el bucket `private-documents`;
- separar visibilidad administrativa de membresía operacional.

### Decisiones de alcance

- Se proponen policies `FOR SELECT TO authenticated` que usan `(select app_private.is_platform_admin())`.
- No se incluyen policies `INSERT`, `UPDATE` o `DELETE`.
- `notifications` queda fuera hasta definir qué significa exactamente una notificación “relevante” para administración global. Dar acceso a todas expondría alertas personales sin una regla explícita.
- `company_templates` queda fuera porque la tabla no existe actualmente en el schema cache de Supabase (`PGRST205`).
- Storage conserva el bucket privado. La policy propuesta sólo permite leer objetos registrados como versiones `UPLOADED` en `public.document_versions`.

### Bloqueo para `can_read_document`

La actualización solicita incorporar `app_private.is_platform_admin()` dentro de `app_private.can_read_document()`.

El cuerpo y la firma exacta de la función actual no están en el repositorio. No debe utilizarse `CREATE OR REPLACE FUNCTION` hasta revisar su migration o extraer su definición, porque podría eliminar reglas actuales de membresía/permisos.

El cambio final debe conservar íntegramente el predicado actual y añadir conceptualmente:

```sql
app_private.is_platform_admin()
OR
(predicado_actual_sin_modificar)
```

También debe revisarse `app_private.can_read_storage_object()` si la policy vigente de `storage.objects` depende de ese helper.

### Cambios requeridos en ProjectContext

El selector operacional no debe consultar simplemente todos los proyectos visibles por RLS. Debe construir su conjunto desde:

1. `project_members` activos del usuario;
2. compañías donde el usuario posea una asignación `COMPANY_ADMIN` no revocada;
3. proyectos pertenecientes a esas compañías;
4. unión y deduplicación de ambos conjuntos.

`PLATFORM_ADMIN` debe resolverse en un contexto separado y nunca convertirse en rol o permiso de proyecto.
