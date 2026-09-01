-- 057_dispatch_documents_upload.sql
-- READY FOR MANUAL EXECUTION — NOT YET EXECUTED.
--
-- Operational Phase 7, Migration C only.
-- Adds private, versioned document-upload preparation for Dispatch Guides and
-- Dispatch Incidents. PostgreSQL creates metadata and validates final Storage
-- registration; Server Actions create signed upload/download URLs.
--
-- Business decisions for this phase:
--   * bucket remains private-documents and private;
--   * allowed MIME types: JPEG, PNG, WebP and PDF;
--   * maximum file size: 10 MiB (10 * 1024 * 1024 bytes);
--   * signed upload expectation: 2 hours;
--   * guide mutation permission: dispatch.modify;
--   * incident evidence permission: dispatch.register_incident.
--
-- Intentionally excluded:
--   * byte upload/download and signed URL generation in PostgreSQL
--   * UI and Server Action implementation
--   * automatic cleanup of abandoned PENDING versions or Storage objects
--   * guide correction, result mutation and dispatch revisions
--   * batches, invoices, reconciliation and final authorization

begin;

-- ============================================================
-- 1. PRECONDITIONS / DRIFT GUARDS
-- ============================================================

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'documents',
    'document_versions',
    'guide_documents',
    'dispatch_guides',
    'dispatches',
    'dispatch_incidents',
    'projects',
    'profiles',
    'audit_events'
  ]
  loop
    if to_regclass(format('public.%I', v_table)) is null then
      raise exception 'DISPATCH_DOCUMENT_REQUIRED_RELATION_MISSING: %', v_table;
    end if;
  end loop;

  if to_regclass('storage.buckets') is null
     or to_regclass('storage.objects') is null then
    raise exception 'DISPATCH_DOCUMENT_STORAGE_RELATION_MISSING';
  end if;

  if to_regclass('public.incident_documents') is not null then
    raise exception 'INCIDENT_DOCUMENTS_ALREADY_EXISTS';
  end if;

  if to_regtype('public.document_upload_status') is null then
    raise exception 'DOCUMENT_UPLOAD_STATUS_TYPE_MISSING';
  end if;

  if to_regprocedure('app_private.can_read_document(uuid)') is null
     or to_regprocedure(
       'app_private.can_read_storage_object(text,text)'
     ) is null
     or to_regprocedure(
       'app_private.has_project_permission(uuid,text)'
     ) is null then
    raise exception 'DISPATCH_DOCUMENT_REQUIRED_HELPER_MISSING';
  end if;

  if to_regprocedure(
    'app_private.prepare_document_upload_version(uuid,uuid,uuid,text,text,bigint)'
  ) is not null
     or to_regprocedure(
       'app_private.resolve_dispatch_document_mutation(uuid)'
     ) is not null then
    raise exception 'DISPATCH_DOCUMENT_PRIVATE_HELPER_ALREADY_EXISTS';
  end if;

  if to_regprocedure(
    'public.prepare_guide_document_upload(uuid,text,text,bigint,text,uuid)'
  ) is not null
     or to_regprocedure(
       'public.prepare_incident_document_upload(uuid,text,text,bigint,text,uuid)'
     ) is not null
     or to_regprocedure(
       'public.finalize_document_upload(uuid,uuid)'
     ) is not null
     or to_regprocedure(
       'public.fail_document_upload(uuid,uuid,text)'
     ) is not null then
    raise exception 'DISPATCH_DOCUMENT_CANONICAL_RPC_ALREADY_EXISTS';
  end if;

  if exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'document_versions'
      and c.column_name in (
        'failed_at',
        'failed_by',
        'failure_reason'
      )
  ) then
    raise exception 'DOCUMENT_VERSION_FAILURE_COLUMN_ALREADY_EXISTS';
  end if;

  if not exists (
    select 1
    from storage.buckets b
    where b.id = 'private-documents'
      and b.name = 'private-documents'
      and b.public = false
  ) then
    raise exception 'PRIVATE_DOCUMENTS_BUCKET_MISSING_OR_PUBLIC';
  end if;

  -- Discovery found no configured limit or MIME whitelist. Abort if another
  -- actor configured either value before manual execution.
  if exists (
    select 1
    from storage.buckets b
    where b.id = 'private-documents'
      and (
        b.file_size_limit is not null
        or b.allowed_mime_types is not null
      )
  ) then
    raise exception 'PRIVATE_DOCUMENTS_BUCKET_LIMIT_REQUIRES_MANUAL_REVIEW';
  end if;

  if not exists (
    select 1
    from pg_policies p
    where p.schemaname = 'public'
      and p.tablename = 'documents'
      and p.policyname = 'documents_select'
      and p.cmd = 'SELECT'
      and 'authenticated'::name = any(p.roles)
      and position('can_read_document' in coalesce(p.qual, '')) > 0
  )
  or not exists (
    select 1
    from pg_policies p
    where p.schemaname = 'public'
      and p.tablename = 'document_versions'
      and p.policyname = 'document_versions_select'
      and p.cmd = 'SELECT'
      and 'authenticated'::name = any(p.roles)
      and position('can_read_document' in coalesce(p.qual, '')) > 0
  ) then
    raise exception 'DOCUMENT_SELECT_POLICY_NOT_ALIGNED';
  end if;

  if not exists (
    select 1
    from pg_policies p
    where p.schemaname = 'public'
      and p.tablename = 'guide_documents'
      and p.policyname = 'guide_documents_select'
      and p.cmd = 'SELECT'
      and 'authenticated'::name = any(p.roles)
      and position('dispatch.view' in coalesce(p.qual, '')) > 0
      and position('can_read_document' in coalesce(p.qual, '')) > 0
  ) then
    raise exception 'GUIDE_DOCUMENTS_SELECT_POLICY_NOT_ALIGNED';
  end if;

  if not exists (
    select 1
    from pg_policies p
    where p.schemaname = 'storage'
      and p.tablename = 'objects'
      and p.policyname = 'private_documents_read'
      and p.cmd = 'SELECT'
      and 'authenticated'::name = any(p.roles)
      and position('private-documents' in coalesce(p.qual, '')) > 0
      and position('can_read_storage_object' in coalesce(p.qual, '')) > 0
  ) then
    raise exception 'PRIVATE_DOCUMENTS_STORAGE_READ_POLICY_NOT_ALIGNED';
  end if;

  if exists (
    select 1
    from pg_policies p
    where p.schemaname = 'storage'
      and p.tablename = 'objects'
      and p.cmd in ('INSERT', 'UPDATE', 'ALL')
      and position(
        'private-documents' in
        coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '')
      ) > 0
      and (
        'anon'::name = any(p.roles)
        or 'authenticated'::name = any(p.roles)
        or 'public'::name = any(p.roles)
      )
  ) then
    raise exception 'PRIVATE_DOCUMENTS_BROWSER_WRITE_POLICY_REQUIRES_REVIEW';
  end if;

  if exists (
    select 1
    from (
      values
        ('documents'),
        ('document_versions'),
        ('guide_documents')
    ) expected(table_name)
    where not exists (
      select 1
      from pg_policies p
      where p.schemaname = 'public'
        and p.tablename = expected.table_name
        and p.cmd = 'SELECT'
        and position('is_platform_admin' in coalesce(p.qual, '')) > 0
    )
  ) then
    raise exception 'DISPATCH_DOCUMENT_PLATFORM_ADMIN_READ_POLICY_MISSING';
  end if;

  if exists (
    select 1
    from public.document_versions dv
    where dv.upload_status = 'PENDING'
    group by dv.document_id
    having count(*) > 1
  ) then
    raise exception 'DOCUMENT_MULTIPLE_PENDING_VERSIONS_REQUIRE_REVIEW';
  end if;

  if exists (
    select 1
    from public.document_versions dv
    where dv.is_current = true
    group by dv.document_id
    having count(*) > 1
  ) then
    raise exception 'DOCUMENT_MULTIPLE_CURRENT_VERSIONS_REQUIRE_REVIEW';
  end if;

  if exists (
    select 1
    from (
      values
        ('documents'),
        ('document_versions'),
        ('guide_documents'),
        ('dispatch_incidents')
    ) expected(table_name)
    where not exists (
      select 1
      from pg_class c
      join pg_namespace n
        on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = expected.table_name
        and c.relrowsecurity = true
    )
  ) then
    raise exception 'DISPATCH_DOCUMENT_REQUIRED_RLS_NOT_ENABLED';
  end if;
end;
$$;

-- ============================================================
-- 2. STORAGE BUCKET BUSINESS LIMITS
-- ============================================================

update storage.buckets
set file_size_limit = 10485760,
    allowed_mime_types = array[
      'image/jpeg',
      'image/png',
      'image/webp',
      'application/pdf'
    ]::text[],
    updated_at = now()
where id = 'private-documents'
  and public = false;

-- No storage.objects INSERT/UPDATE policy is added. A Server Action holding
-- the service role creates a non-upsert signed upload URL. The browser uploads
-- with that short-lived token and never receives the service-role credential.

-- ============================================================
-- 3. VERSION FAILURE METADATA + CONCURRENCY INVARIANTS
-- ============================================================

alter table public.document_versions
add column failed_at timestamptz,
add column failed_by uuid,
add column failure_reason text;

alter table public.document_versions
add constraint document_versions_failed_by_fk
foreign key (failed_by)
references public.profiles(id)
on delete restrict;

alter table public.document_versions
add constraint document_versions_upload_lifecycle_ck
check (
  (
    upload_status = 'PENDING'
    and upload_expires_at is not null
    and uploaded_at is null
    and failed_at is null
    and failed_by is null
    and failure_reason is null
    and is_current = false
  )
  or (
    upload_status = 'UPLOADED'
    and uploaded_at is not null
    and failed_at is null
    and failed_by is null
    and failure_reason is null
  )
  or (
    upload_status = 'FAILED'
    and uploaded_at is null
    and failed_at is not null
    and failed_by is not null
    and nullif(btrim(failure_reason), '') is not null
    and is_current = false
  )
);

create unique index document_versions_one_pending_uq
on public.document_versions(document_id)
where upload_status = 'PENDING';

create unique index document_versions_one_current_uq
on public.document_versions(document_id)
where is_current = true;

-- ============================================================
-- 4. TYPED INCIDENT DOCUMENT RELATION
-- ============================================================

alter table public.dispatch_incidents
add constraint dispatch_incidents_id_project_uq
unique (id, project_id);

create table public.incident_documents (
  project_id uuid not null,
  incident_id uuid not null,
  document_id uuid not null,
  purpose text not null,
  created_at timestamptz not null default now(),

  constraint incident_documents_pkey
    primary key (incident_id, document_id),

  constraint incident_documents_incident_fk
    foreign key (incident_id, project_id)
    references public.dispatch_incidents(id, project_id)
    on delete restrict,

  constraint incident_documents_document_fk
    foreign key (document_id, project_id)
    references public.documents(id, project_id)
    on delete restrict,

  constraint incident_documents_purpose_ck
    check (purpose = 'INCIDENT_EVIDENCE')
);

create index idx_incident_documents_document
on public.incident_documents(document_id, project_id);

alter table public.incident_documents
enable row level security;

create policy incident_documents_select
on public.incident_documents
for select
to authenticated
using (
  app_private.has_project_permission(
    project_id,
    'dispatch.view'
  )
  and app_private.can_read_document(document_id)
);

create policy platform_admin_read_incident_documents
on public.incident_documents
for select
to authenticated
using (
  app_private.is_platform_admin()
);

-- ============================================================
-- 5. RELATION-AWARE DOCUMENT READ AUTHORIZATION
-- ============================================================

-- Preserve the existing global PLATFORM_ADMIN path and the existing generic
-- project/document.view behavior for non-Dispatch documents. Dispatch Guide
-- and Incident documents require dispatch.view, preventing project membership
-- alone from bypassing the operational permission model.
create or replace function app_private.can_read_document(
  p_document_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, app_private
as $$
  select
    app_private.is_platform_admin()
    or exists (
      select 1
      from public.documents d
      where d.id = p_document_id
        and (
          exists (
            select 1
            from public.guide_documents gd
            where gd.document_id = d.id
              and gd.project_id = d.project_id
              and app_private.has_project_permission(
                gd.project_id,
                'dispatch.view'
              )
          )
          or exists (
            select 1
            from public.incident_documents idoc
            where idoc.document_id = d.id
              and idoc.project_id = d.project_id
              and app_private.has_project_permission(
                idoc.project_id,
                'dispatch.view'
              )
          )
          or (
            not exists (
              select 1
              from public.guide_documents gd
              where gd.document_id = d.id
                and gd.project_id = d.project_id
            )
            and not exists (
              select 1
              from public.incident_documents idoc
              where idoc.document_id = d.id
                and idoc.project_id = d.project_id
            )
            and (
              app_private.is_project_member(d.project_id)
              or app_private.has_project_permission(
                d.project_id,
                'document.view'
              )
            )
          )
        )
    );
$$;

alter function app_private.can_read_document(uuid)
owner to postgres;

revoke all
on function app_private.can_read_document(uuid)
from public, anon;

grant execute
on function app_private.can_read_document(uuid)
to authenticated, service_role;

-- app_private.can_read_storage_object(text, text) remains unchanged. It
-- already requires an UPLOADED version and delegates authorization to the
-- relation-aware can_read_document(uuid) above.

-- ============================================================
-- 6. PRIVATE VERSION PREPARATION HELPER
-- ============================================================

create function app_private.prepare_document_upload_version(
  p_document_id uuid,
  p_project_id uuid,
  p_actor uuid,
  p_file_name text,
  p_mime_type text,
  p_file_size bigint
)
returns table (
  document_id uuid,
  version_id uuid,
  version_number integer,
  storage_bucket text,
  storage_path text,
  file_name text,
  mime_type text,
  file_size bigint,
  upload_expires_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_document_project_id uuid;
  v_version_id uuid := gen_random_uuid();
  v_version integer;
  v_file_name text;
  v_mime_type text := lower(nullif(btrim(p_mime_type), ''));
  v_storage_bucket constant text := 'private-documents';
  v_storage_path text;
  v_upload_expires_at timestamptz := now() + interval '2 hours';
begin
  if p_actor is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select d.project_id
  into v_document_project_id
  from public.documents d
  where d.id = p_document_id
  for update;

  if not found
     or v_document_project_id <> p_project_id then
    raise exception 'DOCUMENT_CONTEXT_INVALID';
  end if;

  if nullif(btrim(p_file_name), '') is null then
    raise exception 'DOCUMENT_FILE_NAME_REQUIRED';
  end if;

  -- Preserve a safe display name only. It never participates in the path or
  -- authorization decision.
  v_file_name := regexp_replace(
    btrim(p_file_name),
    '[[:cntrl:]/\\]+',
    '_',
    'g'
  );

  if nullif(v_file_name, '') is null
     or char_length(v_file_name) > 255 then
    raise exception 'DOCUMENT_FILE_NAME_INVALID';
  end if;

  if v_mime_type is null
     or v_mime_type not in (
       'image/jpeg',
       'image/png',
       'image/webp',
       'application/pdf'
     ) then
    raise exception 'DOCUMENT_MIME_TYPE_NOT_ALLOWED';
  end if;

  if p_file_size is null
     or p_file_size <= 0
     or p_file_size > 10485760 then
    raise exception 'DOCUMENT_FILE_SIZE_INVALID';
  end if;

  if exists (
    select 1
    from public.document_versions dv
    where dv.document_id = p_document_id
      and dv.upload_status = 'PENDING'
  ) then
    raise exception 'DOCUMENT_UPLOAD_ALREADY_PENDING';
  end if;

  select coalesce(max(dv.version), 0) + 1
  into v_version
  from public.document_versions dv
  where dv.document_id = p_document_id;

  v_storage_path := format(
    'project/%s/documents/%s/%s',
    p_project_id,
    p_document_id,
    v_version_id
  );

  insert into public.document_versions (
    id,
    document_id,
    version,
    storage_bucket,
    storage_path,
    file_name,
    mime_type,
    file_size,
    sha256,
    upload_status,
    upload_expires_at,
    uploaded_at,
    is_current,
    uploaded_by
  )
  values (
    v_version_id,
    p_document_id,
    v_version,
    v_storage_bucket,
    v_storage_path,
    v_file_name,
    v_mime_type,
    p_file_size,
    null,
    'PENDING',
    v_upload_expires_at,
    null,
    false,
    p_actor
  );

  return query
  select
    p_document_id,
    v_version_id,
    v_version,
    v_storage_bucket,
    v_storage_path,
    v_file_name,
    v_mime_type,
    p_file_size,
    v_upload_expires_at;
end;
$$;

alter function app_private.prepare_document_upload_version(
  uuid,
  uuid,
  uuid,
  text,
  text,
  bigint
)
owner to postgres;

revoke all
on function app_private.prepare_document_upload_version(
  uuid,
  uuid,
  uuid,
  text,
  text,
  bigint
)
from public, anon, authenticated;

-- ============================================================
-- 7. GUIDE UPLOAD PREPARATION
-- ============================================================

create function public.prepare_guide_document_upload(
  p_guide_id uuid,
  p_file_name text,
  p_mime_type text,
  p_file_size bigint,
  p_purpose text,
  p_document_id uuid default null
)
returns table (
  document_id uuid,
  version_id uuid,
  version_number integer,
  storage_bucket text,
  storage_path text,
  file_name text,
  mime_type text,
  file_size bigint,
  upload_expires_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_project_id uuid;
  v_company_id uuid;
  v_document_id uuid := p_document_id;
  v_prepared record;
begin
  if v_actor is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if nullif(btrim(p_purpose), '') is distinct from 'DISPATCH_GUIDE' then
    raise exception 'GUIDE_DOCUMENT_PURPOSE_INVALID';
  end if;

  select dg.project_id, p.company_id
  into v_project_id, v_company_id
  from public.dispatch_guides dg
  join public.dispatches d
    on d.id = dg.dispatch_id
   and d.project_id = dg.project_id
  join public.projects p
    on p.id = d.project_id
  where dg.id = p_guide_id;

  if not found then
    raise exception 'DISPATCH_GUIDE_NOT_FOUND';
  end if;

  if not app_private.has_project_permission(
    v_project_id,
    'dispatch.modify'
  ) then
    raise exception 'GUIDE_DOCUMENT_PERMISSION_DENIED';
  end if;

  if v_document_id is null then
    v_document_id := gen_random_uuid();

    insert into public.documents (
      id,
      project_id,
      category,
      created_by
    )
    values (
      v_document_id,
      v_project_id,
      'DISPATCH_GUIDE',
      v_actor
    );

    insert into public.guide_documents (
      project_id,
      guide_id,
      document_id,
      purpose
    )
    values (
      v_project_id,
      p_guide_id,
      v_document_id,
      'DISPATCH_GUIDE'
    );
  elsif not exists (
    select 1
    from public.documents doc
    join public.guide_documents gd
      on gd.document_id = doc.id
     and gd.project_id = doc.project_id
    where doc.id = v_document_id
      and doc.project_id = v_project_id
      and doc.category = 'DISPATCH_GUIDE'
      and gd.guide_id = p_guide_id
      and gd.purpose = 'DISPATCH_GUIDE'
  ) then
    raise exception 'GUIDE_DOCUMENT_RETRY_CONTEXT_INVALID';
  end if;

  select prepared.*
  into v_prepared
  from app_private.prepare_document_upload_version(
    v_document_id,
    v_project_id,
    v_actor,
    p_file_name,
    p_mime_type,
    p_file_size
  ) prepared;

  insert into public.audit_events (
    actor_user_id,
    company_id,
    project_id,
    entity_type,
    entity_id,
    action,
    new_values
  )
  values (
    v_actor,
    v_company_id,
    v_project_id,
    'document',
    v_document_id,
    'GUIDE_DOCUMENT_PREPARED',
    jsonb_build_object(
      'guide_id', p_guide_id,
      'document_id', v_document_id,
      'version_id', v_prepared.version_id,
      'version', v_prepared.version_number,
      'purpose', 'DISPATCH_GUIDE',
      'mime_type', v_prepared.mime_type,
      'file_size', v_prepared.file_size
    )
  );

  return query
  select
    v_prepared.document_id,
    v_prepared.version_id,
    v_prepared.version_number,
    v_prepared.storage_bucket,
    v_prepared.storage_path,
    v_prepared.file_name,
    v_prepared.mime_type,
    v_prepared.file_size,
    v_prepared.upload_expires_at;
end;
$$;

alter function public.prepare_guide_document_upload(
  uuid,
  text,
  text,
  bigint,
  text,
  uuid
)
owner to postgres;

revoke all
on function public.prepare_guide_document_upload(
  uuid,
  text,
  text,
  bigint,
  text,
  uuid
)
from public, anon;

grant execute
on function public.prepare_guide_document_upload(
  uuid,
  text,
  text,
  bigint,
  text,
  uuid
)
to authenticated, service_role;

-- ============================================================
-- 8. INCIDENT EVIDENCE UPLOAD PREPARATION
-- ============================================================

create function public.prepare_incident_document_upload(
  p_incident_id uuid,
  p_file_name text,
  p_mime_type text,
  p_file_size bigint,
  p_purpose text,
  p_document_id uuid default null
)
returns table (
  document_id uuid,
  version_id uuid,
  version_number integer,
  storage_bucket text,
  storage_path text,
  file_name text,
  mime_type text,
  file_size bigint,
  upload_expires_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_project_id uuid;
  v_company_id uuid;
  v_document_id uuid := p_document_id;
  v_prepared record;
begin
  if v_actor is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if nullif(btrim(p_purpose), '') is distinct from 'INCIDENT_EVIDENCE' then
    raise exception 'INCIDENT_DOCUMENT_PURPOSE_INVALID';
  end if;

  select di.project_id, p.company_id
  into v_project_id, v_company_id
  from public.dispatch_incidents di
  join public.dispatches d
    on d.id = di.dispatch_id
   and d.project_id = di.project_id
  join public.projects p
    on p.id = d.project_id
  where di.id = p_incident_id;

  if not found then
    raise exception 'DISPATCH_INCIDENT_NOT_FOUND';
  end if;

  if not app_private.has_project_permission(
    v_project_id,
    'dispatch.register_incident'
  ) then
    raise exception 'INCIDENT_DOCUMENT_PERMISSION_DENIED';
  end if;

  if v_document_id is null then
    v_document_id := gen_random_uuid();

    insert into public.documents (
      id,
      project_id,
      category,
      created_by
    )
    values (
      v_document_id,
      v_project_id,
      'INCIDENT_EVIDENCE',
      v_actor
    );

    insert into public.incident_documents (
      project_id,
      incident_id,
      document_id,
      purpose
    )
    values (
      v_project_id,
      p_incident_id,
      v_document_id,
      'INCIDENT_EVIDENCE'
    );
  elsif not exists (
    select 1
    from public.documents doc
    join public.incident_documents idoc
      on idoc.document_id = doc.id
     and idoc.project_id = doc.project_id
    where doc.id = v_document_id
      and doc.project_id = v_project_id
      and doc.category = 'INCIDENT_EVIDENCE'
      and idoc.incident_id = p_incident_id
      and idoc.purpose = 'INCIDENT_EVIDENCE'
  ) then
    raise exception 'INCIDENT_DOCUMENT_RETRY_CONTEXT_INVALID';
  end if;

  select prepared.*
  into v_prepared
  from app_private.prepare_document_upload_version(
    v_document_id,
    v_project_id,
    v_actor,
    p_file_name,
    p_mime_type,
    p_file_size
  ) prepared;

  insert into public.audit_events (
    actor_user_id,
    company_id,
    project_id,
    entity_type,
    entity_id,
    action,
    new_values
  )
  values (
    v_actor,
    v_company_id,
    v_project_id,
    'document',
    v_document_id,
    'INCIDENT_DOCUMENT_PREPARED',
    jsonb_build_object(
      'incident_id', p_incident_id,
      'document_id', v_document_id,
      'version_id', v_prepared.version_id,
      'version', v_prepared.version_number,
      'purpose', 'INCIDENT_EVIDENCE',
      'mime_type', v_prepared.mime_type,
      'file_size', v_prepared.file_size
    )
  );

  return query
  select
    v_prepared.document_id,
    v_prepared.version_id,
    v_prepared.version_number,
    v_prepared.storage_bucket,
    v_prepared.storage_path,
    v_prepared.file_name,
    v_prepared.mime_type,
    v_prepared.file_size,
    v_prepared.upload_expires_at;
end;
$$;

alter function public.prepare_incident_document_upload(
  uuid,
  text,
  text,
  bigint,
  text,
  uuid
)
owner to postgres;

revoke all
on function public.prepare_incident_document_upload(
  uuid,
  text,
  text,
  bigint,
  text,
  uuid
)
from public, anon;

grant execute
on function public.prepare_incident_document_upload(
  uuid,
  text,
  text,
  bigint,
  text,
  uuid
)
to authenticated, service_role;

-- ============================================================
-- 9. SHARED MUTATION CONTEXT / PERMISSION RESOLUTION
-- ============================================================

create function app_private.resolve_dispatch_document_mutation(
  p_document_id uuid
)
returns table (
  project_id uuid,
  company_id uuid,
  context_type text,
  context_id uuid
)
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_count integer;
  v_project_id uuid;
  v_company_id uuid;
  v_context_type text;
  v_context_id uuid;
begin
  select
    count(*)::integer,
    (array_agg(ctx.project_id))[1],
    (array_agg(ctx.context_type))[1],
    (array_agg(ctx.context_id))[1]
  into
    v_count,
    v_project_id,
    v_context_type,
    v_context_id
  from (
    select
      gd.project_id,
      'GUIDE'::text as context_type,
      gd.guide_id as context_id
    from public.guide_documents gd
    where gd.document_id = p_document_id

    union all

    select
      idoc.project_id,
      'INCIDENT'::text as context_type,
      idoc.incident_id as context_id
    from public.incident_documents idoc
    where idoc.document_id = p_document_id
  ) ctx;

  if v_count <> 1 then
    raise exception 'DISPATCH_DOCUMENT_CONTEXT_INVALID';
  end if;

  select p.company_id
  into v_company_id
  from public.projects p
  where p.id = v_project_id;

  if not found then
    raise exception 'PROJECT_NOT_FOUND';
  end if;

  if v_context_type = 'GUIDE' then
    if not app_private.has_project_permission(
      v_project_id,
      'dispatch.modify'
    ) then
      raise exception 'GUIDE_DOCUMENT_PERMISSION_DENIED';
    end if;
  elsif not app_private.has_project_permission(
    v_project_id,
    'dispatch.register_incident'
  ) then
    raise exception 'INCIDENT_DOCUMENT_PERMISSION_DENIED';
  end if;

  return query
  select
    v_project_id,
    v_company_id,
    v_context_type,
    v_context_id;
end;
$$;

alter function app_private.resolve_dispatch_document_mutation(uuid)
owner to postgres;

revoke all
on function app_private.resolve_dispatch_document_mutation(uuid)
from public, anon, authenticated;

-- ============================================================
-- 10. FINALIZE A PHYSICALLY REGISTERED STORAGE OBJECT
-- ============================================================

create function public.finalize_document_upload(
  p_document_id uuid,
  p_version_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, storage, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_version public.document_versions%rowtype;
  v_context record;
  v_storage_metadata jsonb;
  v_storage_size_text text;
  v_storage_mime_type text;
  v_action text;
begin
  if v_actor is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select dv.*
  into v_version
  from public.document_versions dv
  where dv.id = p_version_id
    and dv.document_id = p_document_id
  for update;

  if not found then
    raise exception 'DOCUMENT_VERSION_NOT_FOUND';
  end if;

  if v_version.upload_status <> 'PENDING' then
    raise exception 'DOCUMENT_UPLOAD_NOT_PENDING';
  end if;

  if now() > v_version.upload_expires_at then
    raise exception 'DOCUMENT_UPLOAD_EXPIRED';
  end if;

  select resolved.*
  into v_context
  from app_private.resolve_dispatch_document_mutation(
    p_document_id
  ) resolved;

  select o.metadata
  into v_storage_metadata
  from storage.objects o
  where o.bucket_id = v_version.storage_bucket
    and o.name = v_version.storage_path;

  if not found then
    raise exception 'DOCUMENT_STORAGE_OBJECT_MISSING';
  end if;

  -- PostgreSQL can verify the Storage metadata row, expected path, size and
  -- MIME. It does not claim to inspect bytes or independently verify sha256.
  v_storage_size_text := coalesce(
    v_storage_metadata ->> 'size',
    v_storage_metadata ->> 'contentLength'
  );
  v_storage_mime_type := lower(
    coalesce(
      v_storage_metadata ->> 'mimetype',
      v_storage_metadata ->> 'contentType',
      ''
    )
  );

  if coalesce(v_storage_size_text, '') !~ '^[0-9]+$'
     or v_storage_size_text::bigint <> v_version.file_size then
    raise exception 'DOCUMENT_STORAGE_SIZE_MISMATCH';
  end if;

  if v_storage_mime_type <> lower(v_version.mime_type) then
    raise exception 'DOCUMENT_STORAGE_MIME_MISMATCH';
  end if;

  update public.document_versions
  set is_current = false
  where document_id = p_document_id
    and is_current = true;

  update public.document_versions
  set upload_status = 'UPLOADED',
      uploaded_at = now(),
      uploaded_by = v_actor,
      is_current = true,
      failed_at = null,
      failed_by = null,
      failure_reason = null
  where id = p_version_id;

  v_action := case v_context.context_type
    when 'GUIDE' then 'GUIDE_DOCUMENT_UPLOADED'
    else 'INCIDENT_DOCUMENT_UPLOADED'
  end;

  insert into public.audit_events (
    actor_user_id,
    company_id,
    project_id,
    entity_type,
    entity_id,
    action,
    new_values
  )
  values (
    v_actor,
    v_context.company_id,
    v_context.project_id,
    'document',
    p_document_id,
    v_action,
    jsonb_build_object(
      'context_type', v_context.context_type,
      'context_id', v_context.context_id,
      'document_id', p_document_id,
      'version_id', p_version_id,
      'version', v_version.version,
      'storage_bucket', v_version.storage_bucket,
      'storage_path', v_version.storage_path,
      'mime_type', v_version.mime_type,
      'file_size', v_version.file_size
    )
  );

  return p_version_id;
end;
$$;

alter function public.finalize_document_upload(uuid, uuid)
owner to postgres;

revoke all
on function public.finalize_document_upload(uuid, uuid)
from public, anon;

grant execute
on function public.finalize_document_upload(uuid, uuid)
to authenticated, service_role;

-- ============================================================
-- 11. FAIL A PENDING UPLOAD WITHOUT ERASING HISTORY
-- ============================================================

create function public.fail_document_upload(
  p_document_id uuid,
  p_version_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_version public.document_versions%rowtype;
  v_context record;
  v_reason text := nullif(btrim(p_reason), '');
  v_action text;
begin
  if v_actor is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if v_reason is null
     or char_length(v_reason) > 500 then
    raise exception 'DOCUMENT_UPLOAD_FAILURE_REASON_INVALID';
  end if;

  select dv.*
  into v_version
  from public.document_versions dv
  where dv.id = p_version_id
    and dv.document_id = p_document_id
  for update;

  if not found then
    raise exception 'DOCUMENT_VERSION_NOT_FOUND';
  end if;

  if v_version.upload_status <> 'PENDING' then
    raise exception 'DOCUMENT_UPLOAD_NOT_PENDING';
  end if;

  select resolved.*
  into v_context
  from app_private.resolve_dispatch_document_mutation(
    p_document_id
  ) resolved;

  update public.document_versions
  set upload_status = 'FAILED',
      failed_at = now(),
      failed_by = v_actor,
      failure_reason = v_reason,
      uploaded_at = null,
      is_current = false
  where id = p_version_id;

  v_action := case v_context.context_type
    when 'GUIDE' then 'GUIDE_DOCUMENT_UPLOAD_FAILED'
    else 'INCIDENT_DOCUMENT_UPLOAD_FAILED'
  end;

  insert into public.audit_events (
    actor_user_id,
    company_id,
    project_id,
    entity_type,
    entity_id,
    action,
    new_values,
    comment
  )
  values (
    v_actor,
    v_context.company_id,
    v_context.project_id,
    'document',
    p_document_id,
    v_action,
    jsonb_build_object(
      'context_type', v_context.context_type,
      'context_id', v_context.context_id,
      'document_id', p_document_id,
      'version_id', p_version_id,
      'version', v_version.version,
      'reason', v_reason
    ),
    v_reason
  );

  return p_version_id;
end;
$$;

alter function public.fail_document_upload(uuid, uuid, text)
owner to postgres;

revoke all
on function public.fail_document_upload(uuid, uuid, text)
from public, anon;

grant execute
on function public.fail_document_upload(uuid, uuid, text)
to authenticated, service_role;

-- ============================================================
-- 12. TABLE GRANTS — BROWSER READS ONLY
-- ============================================================

revoke all privileges
on table
  public.documents,
  public.document_versions,
  public.incident_documents
from public, anon, authenticated;

grant select
on table
  public.documents,
  public.document_versions,
  public.incident_documents
to authenticated;

grant all privileges
on table
  public.documents,
  public.document_versions,
  public.incident_documents
to service_role;

-- guide_documents remains SELECT-only for authenticated as established by
-- Migration 054. All document mutations occur through SECURITY DEFINER RPCs.

-- ============================================================
-- 13. FINAL SAFETY ASSERTIONS
-- ============================================================

do $$
declare
  v_table text;
  v_privilege text;
  v_definition text;
begin
  if to_regprocedure(
    'public.prepare_guide_document_upload(uuid,text,text,bigint,text,uuid)'
  ) is null
     or to_regprocedure(
       'public.prepare_incident_document_upload(uuid,text,text,bigint,text,uuid)'
     ) is null
     or to_regprocedure(
       'public.finalize_document_upload(uuid,uuid)'
     ) is null
     or to_regprocedure(
       'public.fail_document_upload(uuid,uuid,text)'
     ) is null then
    raise exception 'DISPATCH_DOCUMENT_CANONICAL_RPC_MISSING';
  end if;

  if not exists (
    select 1
    from storage.buckets b
    where b.id = 'private-documents'
      and b.public = false
      and b.file_size_limit = 10485760
      and b.allowed_mime_types @> array[
        'image/jpeg',
        'image/png',
        'image/webp',
        'application/pdf'
      ]::text[]
      and cardinality(b.allowed_mime_types) = 4
  ) then
    raise exception 'PRIVATE_DOCUMENTS_BUCKET_LIMIT_NOT_ALIGNED';
  end if;

  foreach v_table in array array[
    'documents',
    'document_versions',
    'incident_documents'
  ]
  loop
    if not has_table_privilege(
      'authenticated',
      format('public.%I', v_table),
      'SELECT'
    ) then
      raise exception 'DOCUMENT_AUTHENTICATED_SELECT_MISSING: %', v_table;
    end if;

    foreach v_privilege in array array[
      'INSERT',
      'UPDATE',
      'DELETE',
      'TRUNCATE',
      'REFERENCES',
      'TRIGGER'
    ]
    loop
      if has_table_privilege(
        'authenticated',
        format('public.%I', v_table),
        v_privilege
      ) then
        raise exception
          'DOCUMENT_AUTHENTICATED_MUTATION_PRIVILEGE_REMAINS: %.%',
          v_table,
          v_privilege;
      end if;
    end loop;

    foreach v_privilege in array array[
      'SELECT',
      'INSERT',
      'UPDATE',
      'DELETE',
      'TRUNCATE',
      'REFERENCES',
      'TRIGGER'
    ]
    loop
      if has_table_privilege(
        'anon',
        format('public.%I', v_table),
        v_privilege
      ) then
        raise exception 'DOCUMENT_ANON_PRIVILEGE_REMAINS: %.%',
          v_table,
          v_privilege;
      end if;

      if not has_table_privilege(
        'service_role',
        format('public.%I', v_table),
        v_privilege
      ) then
        raise exception 'DOCUMENT_SERVICE_ROLE_PRIVILEGE_MISSING: %.%',
          v_table,
          v_privilege;
      end if;
    end loop;
  end loop;

  if exists (
    select 1
    from (
      values
        ('prepare_guide_document_upload(uuid,text,text,bigint,text,uuid)'),
        ('prepare_incident_document_upload(uuid,text,text,bigint,text,uuid)'),
        ('finalize_document_upload(uuid,uuid)'),
        ('fail_document_upload(uuid,uuid,text)')
    ) expected(signature)
    where not has_function_privilege(
      'authenticated',
      'public.' || expected.signature,
      'EXECUTE'
    )
       or has_function_privilege(
         'anon',
         'public.' || expected.signature,
         'EXECUTE'
       )
  ) then
    raise exception 'DISPATCH_DOCUMENT_RPC_GRANT_NOT_ALIGNED';
  end if;

  if not exists (
    select 1
    from pg_policies p
    where p.schemaname = 'public'
      and p.tablename = 'incident_documents'
      and p.policyname = 'incident_documents_select'
      and p.cmd = 'SELECT'
      and 'authenticated'::name = any(p.roles)
      and position('dispatch.view' in coalesce(p.qual, '')) > 0
      and position('can_read_document' in coalesce(p.qual, '')) > 0
  )
  or not exists (
    select 1
    from pg_policies p
    where p.schemaname = 'public'
      and p.tablename = 'incident_documents'
      and p.policyname = 'platform_admin_read_incident_documents'
      and position('is_platform_admin' in coalesce(p.qual, '')) > 0
  ) then
    raise exception 'INCIDENT_DOCUMENT_READ_POLICY_NOT_ALIGNED';
  end if;

  if not exists (
    select 1
    from pg_policies p
    where p.schemaname = 'public'
      and p.tablename = 'guide_documents'
      and p.policyname = 'guide_documents_select'
      and position('dispatch.view' in coalesce(p.qual, '')) > 0
      and position('can_read_document' in coalesce(p.qual, '')) > 0
  ) then
    raise exception 'GUIDE_DOCUMENT_READ_POLICY_LOST';
  end if;

  if not exists (
    select 1
    from pg_policies p
    where p.schemaname = 'public'
      and p.tablename = 'documents'
      and p.policyname = 'documents_select'
      and p.cmd = 'SELECT'
      and position('can_read_document' in coalesce(p.qual, '')) > 0
  )
  or not exists (
    select 1
    from pg_policies p
    where p.schemaname = 'public'
      and p.tablename = 'document_versions'
      and p.policyname = 'document_versions_select'
      and p.cmd = 'SELECT'
      and position('can_read_document' in coalesce(p.qual, '')) > 0
  ) then
    raise exception 'DOCUMENT_SELECT_POLICY_LOST';
  end if;

  if exists (
    select 1
    from pg_policies p
    where p.schemaname = 'storage'
      and p.tablename = 'objects'
      and p.cmd in ('INSERT', 'UPDATE', 'ALL')
      and position(
        'private-documents' in
        coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '')
      ) > 0
      and (
        'anon'::name = any(p.roles)
        or 'authenticated'::name = any(p.roles)
        or 'public'::name = any(p.roles)
      )
  ) then
    raise exception 'PRIVATE_DOCUMENTS_BROWSER_WRITE_POLICY_PRESENT';
  end if;

  if exists (
    select 1
    from (
      values
        ('documents'),
        ('document_versions'),
        ('guide_documents'),
        ('incident_documents')
    ) expected(table_name)
    where not exists (
      select 1
      from pg_policies p
      where p.schemaname = 'public'
        and p.tablename = expected.table_name
        and p.cmd = 'SELECT'
        and position('is_platform_admin' in coalesce(p.qual, '')) > 0
    )
  ) then
    raise exception 'DISPATCH_DOCUMENT_PLATFORM_ADMIN_READ_POLICY_LOST';
  end if;

  select pg_get_functiondef(
    'app_private.can_read_document(uuid)'::regprocedure
  )
  into v_definition;

  if position('guide_documents' in v_definition) = 0
     or position('incident_documents' in v_definition) = 0
     or position('dispatch.view' in v_definition) = 0
     or position('document.view' in v_definition) = 0
     or position('is_platform_admin' in v_definition) = 0 then
    raise exception 'DOCUMENT_READ_HELPER_NOT_RELATION_AWARE';
  end if;

  select pg_get_functiondef(
    'app_private.can_read_storage_object(text,text)'::regprocedure
  )
  into v_definition;

  if position('UPLOADED' in v_definition) = 0
     or position('can_read_document' in v_definition) = 0 then
    raise exception 'DOCUMENT_STORAGE_READ_HELPER_NOT_ALIGNED';
  end if;

  if exists (
    select 1
    from (
      values
        ('documents'),
        ('document_versions'),
        ('guide_documents'),
        ('incident_documents')
    ) expected(table_name)
    where not exists (
      select 1
      from pg_class c
      join pg_namespace n
        on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = expected.table_name
        and c.relrowsecurity = true
    )
  ) then
    raise exception 'DISPATCH_DOCUMENT_RLS_LOST';
  end if;
end;
$$;

-- ============================================================
-- 14. STORAGE / SERVER ACTION CONTRACT
-- ============================================================

-- Future Server Action flow (not implemented here):
--   1. authenticate the browser request;
--   2. call prepare_guide_document_upload(...) or
--      prepare_incident_document_upload(...) with the user session;
--   3. use a server-only service-role client to call
--      createSignedUploadUrl(storage_path, { upsert: false });
--   4. return only path/token metadata required by uploadToSignedUrl(...);
--   5. after upload, validate the object with the service-role client;
--   6. call finalize_document_upload(...) with the user session.
--
-- Download flow:
--   1. authenticate in the Server Action;
--   2. require app_private.can_read_document(document_id);
--   3. resolve the current UPLOADED version;
--   4. create a short-lived signed download URL with service role;
--   5. never expose the service-role credential.
--
-- PostgreSQL finalization verifies the storage.objects registration, path,
-- expected size and MIME. It does not inspect file bytes or claim sha256
-- verification. Signed URLs and tokens are never stored or audited.
--
-- PENDING versions abandoned before upload remain visible as expired metadata.
-- A permitted actor/Server Action must call fail_document_upload(...), after
-- which retry calls prepare_* with p_document_id and creates version N+1.
-- No history is overwritten or silently deleted. Automated cleanup is deferred.

-- ============================================================
-- 15. QA PLAN — RUN ONLY AFTER MANUAL EXECUTION
-- ============================================================

-- Run live QA with reversible domain rows and cleanup of Storage objects:
--   * guide prepare accepts JPEG, PNG, WebP and PDF up to 10 MiB;
--   * reject arbitrary MIME, zero size and size > 10 MiB atomically;
--   * sanitized original filename is metadata only and path contains UUIDs;
--   * dispatch.modify can prepare guide upload; view-only users cannot;
--   * dispatch.register_incident can prepare evidence; other-project evidence
--     and users without that permission are rejected;
--   * PLATFORM_ADMIN without an operational permission cannot mutate;
--   * anon cannot SELECT sensitive tables or execute any RPC;
--   * signed upload URL expires and uses upsert=false;
--   * finalize rejects missing object, wrong size, wrong MIME, expired version
--     and any non-PENDING version;
--   * successful finalize produces one current UPLOADED version and the
--     correct GUIDE_DOCUMENT_UPLOADED / INCIDENT_DOCUMENT_UPLOADED audit;
--   * failed upload records bounded reason and the correct FAILED audit;
--   * retry after FAILED creates version N+1 and a new immutable path;
--   * can_read_document and can_read_storage_object enforce dispatch.view;
--   * member without dispatch.view reads zero Dispatch documents;
--   * PLATFORM_ADMIN global reads remain independent;
--   * prepared/uploaded/failed audits contain no signed URL or token;
--   * documents, versions and typed links remain SELECT-only in the browser;
--   * rollback DB rows and delete any QA Storage object with service role;
--   * compare document/version/link/audit/object counts before and after.

commit;
