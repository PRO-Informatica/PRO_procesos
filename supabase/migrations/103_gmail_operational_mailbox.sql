-- 103_gmail_operational_mailbox.sql
-- Server-only send idempotency plus the minimum RBAC permissions for Gmail.

begin;

do $$
begin
  if to_regclass('auth.users') is null
     or to_regclass('public.projects') is null
     or to_regclass('public.roles') is null
     or to_regclass('public.permissions') is null
     or to_regclass('public.role_permissions') is null
     or to_regclass('public.gmail_connections') is null then
    raise exception 'GMAIL_MAILBOX_PREREQUISITES_MISSING';
  end if;

  if to_regtype('public.gmail_send_intent_status') is not null
     or to_regtype('public.gmail_send_intent_kind') is not null
     or to_regclass('public.gmail_send_intents') is not null then
    raise exception 'GMAIL_SEND_INTENT_MODEL_ALREADY_EXISTS';
  end if;

  if not exists (
    select 1 from public.roles
    where code = 'RESIDENT' and active
  ) then
    raise exception 'ACTIVE_RESIDENT_ROLE_MISSING';
  end if;

  if exists (
    select 1
    from public.permissions
    where code in ('gmail.mailbox.view', 'gmail.mail.send')
      and (
        not active
        or description is distinct from case code
          when 'gmail.mailbox.view' then 'Consultar correo operacional'
          when 'gmail.mail.send' then 'Enviar correo operacional'
        end
      )
  ) then
    raise exception 'EXISTING_GMAIL_PERMISSION_DIFFERS';
  end if;
end;
$$;

insert into public.permissions(code, description, active)
values
  ('gmail.mailbox.view', 'Consultar correo operacional', true),
  ('gmail.mail.send', 'Enviar correo operacional', true)
on conflict (code) do nothing;

insert into public.role_permissions(role_id, permission_id)
select role.id, permission.id
from public.roles role
cross join public.permissions permission
where role.code = 'RESIDENT'
  and role.active
  and permission.code in ('gmail.mailbox.view', 'gmail.mail.send')
  and permission.active
on conflict do nothing;

create type public.gmail_send_intent_status as enum (
  'PENDING',
  'SENDING',
  'SENT',
  'FAILED',
  'UNKNOWN'
);

create type public.gmail_send_intent_kind as enum ('NEW_MESSAGE', 'REPLY');

create function app_private.normalize_gmail_recipients(value text[])
returns text[]
language sql
immutable
strict
set search_path = pg_catalog
as $$
  select coalesce(
    array_agg(distinct lower(btrim(recipient)) order by lower(btrim(recipient))),
    '{}'::text[]
  )
  from unnest(value) recipient
  where recipient ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
    and nullif(btrim(recipient), '') is not null;
$$;

alter function app_private.normalize_gmail_recipients(text[]) owner to postgres;
revoke all on function app_private.normalize_gmail_recipients(text[])
  from public, anon, authenticated;
grant execute on function app_private.normalize_gmail_recipients(text[])
  to service_role;

create table public.gmail_send_intents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete restrict,
  idempotency_key uuid not null,
  kind public.gmail_send_intent_kind not null,
  recipients text[] not null,
  subject text not null,
  content_hash text not null,
  status public.gmail_send_intent_status not null default 'PENDING',
  gmail_message_id text,
  gmail_thread_id text,
  error_code text,
  sending_at timestamptz,
  sent_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint gmail_send_intents_user_key_uq unique (user_id, idempotency_key),
  constraint gmail_send_intents_recipients_ck check (
    cardinality(recipients) between 1 and 20
    and recipients = app_private.normalize_gmail_recipients(recipients)
  ),
  constraint gmail_send_intents_subject_ck check (
    char_length(subject) between 1 and 200
    and subject !~ E'[\\r\\n]'
  ),
  constraint gmail_send_intents_content_hash_ck check (
    content_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint gmail_send_intents_google_ids_ck check (
    (gmail_message_id is null or nullif(btrim(gmail_message_id), '') is not null)
    and (gmail_thread_id is null or nullif(btrim(gmail_thread_id), '') is not null)
  ),
  constraint gmail_send_intents_error_code_ck check (
    error_code is null or error_code ~ '^[A-Z0-9_]{3,64}$'
  ),
  constraint gmail_send_intents_state_ck check (
    (status = 'PENDING'
      and sending_at is null and sent_at is null and failed_at is null
      and gmail_message_id is null and gmail_thread_id is null and error_code is null)
    or
    (status = 'SENDING'
      and sending_at is not null and sent_at is null and failed_at is null
      and gmail_message_id is null and error_code is null)
    or
    (status = 'SENT'
      and sending_at is not null and sent_at is not null and failed_at is null
      and gmail_message_id is not null and gmail_thread_id is not null
      and error_code is null)
    or
    (status = 'FAILED'
      and failed_at is not null and sent_at is null and gmail_message_id is null
      and error_code is not null)
    or
    (status = 'UNKNOWN'
      and sending_at is not null and sent_at is null and failed_at is null
      and gmail_message_id is null and error_code is not null)
  )
);

create index idx_gmail_send_intents_owner_created
  on public.gmail_send_intents(user_id, created_at desc);
create index idx_gmail_send_intents_project_created
  on public.gmail_send_intents(project_id, created_at desc);
create index idx_gmail_send_intents_status
  on public.gmail_send_intents(status, updated_at desc);

create function app_private.guard_gmail_send_intent()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
begin
  if tg_op = 'UPDATE' and (
    new.id,
    new.user_id,
    new.project_id,
    new.idempotency_key,
    new.kind,
    new.recipients,
    new.subject,
    new.content_hash,
    new.created_at
  ) is distinct from (
    old.id,
    old.user_id,
    old.project_id,
    old.idempotency_key,
    old.kind,
    old.recipients,
    old.subject,
    old.content_hash,
    old.created_at
  ) then
    raise exception 'GMAIL_SEND_INTENT_IDENTITY_IMMUTABLE';
  end if;

  new.recipients := app_private.normalize_gmail_recipients(new.recipients);
  new.updated_at := case when tg_op = 'UPDATE' then now() else new.updated_at end;
  return new;
end;
$$;

alter function app_private.guard_gmail_send_intent() owner to postgres;
revoke all on function app_private.guard_gmail_send_intent()
  from public, anon, authenticated, service_role;

create trigger gmail_send_intents_guard
before insert or update on public.gmail_send_intents
for each row execute function app_private.guard_gmail_send_intent();

alter table public.gmail_send_intents enable row level security;
alter table public.gmail_send_intents force row level security;

revoke all on table public.gmail_send_intents
  from public, anon, authenticated;
grant select, insert, update on table public.gmail_send_intents
  to service_role;

comment on table public.gmail_send_intents is
  'Server-only idempotency ledger for Gmail sends. It contains no token, message body, attachment, or raw Gmail response.';

commit;
