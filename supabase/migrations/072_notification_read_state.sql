-- 072_notification_read_state.sql
-- Registered after successful manual execution in Supabase.
--
-- Persists read state for the operational notification feed. Notifications
-- remain derived from current domain data; this table stores only per-user
-- acknowledgement keys. The reserved __ALL__ key acts as the "read through"
-- cursor used by the Mark all as read action.

begin;

do $$
begin
  if to_regclass('public.projects') is null
     or to_regclass('public.profiles') is null
     or to_regprocedure(
       'app_private.has_project_permission(uuid,text)'
     ) is null then
    raise exception 'NOTIFICATION_READ_STATE_REQUIRED_CONTRACT_MISSING';
  end if;

  if to_regclass('public.notification_reads') is not null then
    raise exception 'NOTIFICATION_READ_STATE_ALREADY_EXISTS';
  end if;
end;
$$;

create table public.notification_reads (
  project_id uuid not null,
  user_id uuid not null,
  notification_key text not null,
  read_at timestamptz not null default now(),
  constraint notification_reads_pk
    primary key (project_id, user_id, notification_key),
  constraint notification_reads_project_fk
    foreign key (project_id)
    references public.projects(id)
    on delete cascade,
  constraint notification_reads_user_fk
    foreign key (user_id)
    references public.profiles(id)
    on delete cascade,
  constraint notification_reads_key_ck
    check (
      char_length(notification_key) between 1 and 240
      and notification_key = btrim(notification_key)
    )
);

alter table public.notification_reads owner to postgres;

create index notification_reads_user_project_read_at_idx
on public.notification_reads(user_id, project_id, read_at desc);

alter table public.notification_reads enable row level security;
alter table public.notification_reads force row level security;

-- Read state is private to the authenticated user. Project permission checks
-- prevent keeping or probing state for projects outside the operational scope.
create policy notification_reads_select
on public.notification_reads
for select
to authenticated
using (
  user_id = auth.uid()
  and (
    app_private.has_project_permission(project_id, 'programming.view')
    or app_private.has_project_permission(project_id, 'dispatch.view')
    or app_private.has_project_permission(project_id, 'batch.view')
    or app_private.has_project_permission(project_id, 'invoice.view')
    or app_private.has_project_permission(project_id, 'document.view')
  )
);

create policy notification_reads_insert
on public.notification_reads
for insert
to authenticated
with check (
  user_id = auth.uid()
  and (
    app_private.has_project_permission(project_id, 'programming.view')
    or app_private.has_project_permission(project_id, 'dispatch.view')
    or app_private.has_project_permission(project_id, 'batch.view')
    or app_private.has_project_permission(project_id, 'invoice.view')
    or app_private.has_project_permission(project_id, 'document.view')
  )
);

create policy notification_reads_update
on public.notification_reads
for update
to authenticated
using (user_id = auth.uid())
with check (
  user_id = auth.uid()
  and (
    app_private.has_project_permission(project_id, 'programming.view')
    or app_private.has_project_permission(project_id, 'dispatch.view')
    or app_private.has_project_permission(project_id, 'batch.view')
    or app_private.has_project_permission(project_id, 'invoice.view')
    or app_private.has_project_permission(project_id, 'document.view')
  )
);

revoke all on table public.notification_reads from public, anon;
grant select, insert, update on table public.notification_reads
to authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = 'notification_reads'
      and relation.relrowsecurity
      and relation.relforcerowsecurity
  )
  or has_table_privilege(
       'anon', 'public.notification_reads', 'SELECT'
     )
  or not has_table_privilege(
       'authenticated', 'public.notification_reads', 'SELECT'
     )
  or not has_table_privilege(
       'authenticated', 'public.notification_reads', 'INSERT'
     )
  or not has_table_privilege(
       'authenticated', 'public.notification_reads', 'UPDATE'
     ) then
    raise exception 'NOTIFICATION_READ_STATE_SECURITY_NOT_ALIGNED';
  end if;
end;
$$;

commit;

-- Live QA after manual execution:
--   * a user can read and upsert only their own keys in an accessible Project;
--   * another user cannot see or mutate those keys;
--   * a Project outside the user's permissions is rejected by RLS;
--   * __ALL__ stores the timestamp for "Marcar todas como leídas";
--   * domain notifications remain derived and are never duplicated here.
