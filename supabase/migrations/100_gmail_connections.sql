-- 100_gmail_connections.sql
-- Server-only Gmail OAuth credentials and single-use OAuth state records.

begin;

do $$
begin
  if to_regclass('auth.users') is null
     or to_regclass('public.audit_events') is null
     or to_regnamespace('app_private') is null then
    raise exception 'GMAIL_CONNECTION_PREREQUISITES_MISSING';
  end if;
  if to_regtype('public.gmail_connection_status') is not null
     or to_regclass('public.gmail_connections') is not null
     or to_regclass('public.gmail_oauth_states') is not null then
    raise exception 'GMAIL_CONNECTION_MODEL_ALREADY_EXISTS';
  end if;
end;
$$;

create type public.gmail_connection_status as enum (
  'CONNECTED',
  'REAUTH_REQUIRED',
  'DISCONNECTED'
);

create table public.gmail_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  google_user_id text not null,
  email text not null,
  encrypted_refresh_token text,
  encryption_iv text,
  encryption_auth_tag text,
  encryption_key_version integer not null default 1,
  granted_scopes text[] not null default '{}'::text[],
  status public.gmail_connection_status not null default 'CONNECTED',
  connected_at timestamptz not null default now(),
  last_token_refresh_at timestamptz,
  last_sync_at timestamptz,
  reauth_required_at timestamptz,
  disconnected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint gmail_connections_user_uq unique (user_id),
  constraint gmail_connections_google_user_id_ck
    check (nullif(btrim(google_user_id), '') is not null),
  constraint gmail_connections_email_normalized_ck
    check (
      email = lower(btrim(email))
      and email ~ '^[^[:space:]@]+@pro[.]com[.]gt$'
    ),
  constraint gmail_connections_encryption_key_version_ck
    check (encryption_key_version > 0),
  constraint gmail_connections_scopes_ck
    check (
      granted_scopes @> array[
        'openid',
        'email',
        'profile',
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/gmail.send'
      ]::text[]
    ),
  constraint gmail_connections_token_parts_ck
    check (
      (encrypted_refresh_token is not null
       and encryption_iv is not null
       and encryption_auth_tag is not null)
      or
      (encrypted_refresh_token is null
       and encryption_iv is null
       and encryption_auth_tag is null)
    ),
  constraint gmail_connections_status_ck
    check (
      (status = 'CONNECTED'
       and encrypted_refresh_token is not null
       and reauth_required_at is null
       and disconnected_at is null)
      or
      (status = 'REAUTH_REQUIRED'
       and encrypted_refresh_token is null
       and reauth_required_at is not null
       and disconnected_at is null)
      or
      (status = 'DISCONNECTED'
       and encrypted_refresh_token is null
       and reauth_required_at is null
       and disconnected_at is not null)
    ),
  constraint gmail_connections_dates_ck
    check (
      created_at <= connected_at
      and (last_token_refresh_at is null or last_token_refresh_at >= connected_at)
      and (last_sync_at is null or last_sync_at >= connected_at)
      and (reauth_required_at is null or reauth_required_at >= connected_at)
      and (disconnected_at is null or disconnected_at >= connected_at)
    )
);

create unique index gmail_connections_google_user_uq
  on public.gmail_connections(google_user_id)
  where google_user_id is not null;
create index idx_gmail_connections_status
  on public.gmail_connections(status, updated_at desc);

create table public.gmail_oauth_states (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  state_hash text not null unique,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint gmail_oauth_states_hash_ck
    check (state_hash ~ '^[0-9a-f]{64}$'),
  constraint gmail_oauth_states_expiry_ck
    check (
      expires_at > created_at
      and expires_at <= created_at + interval '15 minutes'
    ),
  constraint gmail_oauth_states_consumed_ck
    check (consumed_at is null or consumed_at >= created_at)
);

create index idx_gmail_oauth_states_expiry
  on public.gmail_oauth_states(expires_at)
  where consumed_at is null;
create index idx_gmail_oauth_states_user
  on public.gmail_oauth_states(user_id, created_at desc);

create function app_private.guard_gmail_connection()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
begin
  if tg_op = 'UPDATE' and (new.id, new.user_id) is distinct from (old.id, old.user_id) then
    raise exception 'GMAIL_CONNECTION_IDENTITY_IMMUTABLE';
  end if;
  new.google_user_id := btrim(new.google_user_id);
  new.email := lower(btrim(new.email));
  new.granted_scopes := array(
    select distinct scope
    from unnest(new.granted_scopes) scope
    where nullif(btrim(scope), '') is not null
    order by scope
  );
  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;
  return new;
end;
$$;

alter function app_private.guard_gmail_connection() owner to postgres;
revoke all on function app_private.guard_gmail_connection()
  from public, anon, authenticated, service_role;

create trigger gmail_connections_guard
before insert or update on public.gmail_connections
for each row execute function app_private.guard_gmail_connection();

create function app_private.audit_gmail_connection()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_action text;
begin
  if tg_op = 'INSERT' then
    v_action := 'GMAIL_CONNECTION_CREATED';
  elsif new.status is distinct from old.status then
    v_action := case new.status
      when 'CONNECTED' then 'GMAIL_CONNECTION_CONNECTED'
      when 'REAUTH_REQUIRED' then 'GMAIL_CONNECTION_REAUTH_REQUIRED'
      when 'DISCONNECTED' then 'GMAIL_CONNECTION_DISCONNECTED'
    end;
  else
    return new;
  end if;

  insert into public.audit_events(
    actor_user_id, entity_type, entity_id, action, old_values, new_values
  ) values (
    new.user_id,
    'gmail_connection',
    new.id,
    v_action,
    case when tg_op = 'UPDATE' then jsonb_build_object('status', old.status) end,
    jsonb_build_object('status', new.status)
  );
  return new;
end;
$$;

alter function app_private.audit_gmail_connection() owner to postgres;
revoke all on function app_private.audit_gmail_connection()
  from public, anon, authenticated, service_role;

create trigger gmail_connections_audit
after insert or update on public.gmail_connections
for each row execute function app_private.audit_gmail_connection();

alter table public.gmail_connections enable row level security;
alter table public.gmail_connections force row level security;
alter table public.gmail_oauth_states enable row level security;
alter table public.gmail_oauth_states force row level security;

revoke all on table public.gmail_connections
  from public, anon, authenticated;
revoke all on table public.gmail_oauth_states
  from public, anon, authenticated;
grant select, insert, update, delete on table public.gmail_connections
  to service_role;
grant select, insert, update, delete on table public.gmail_oauth_states
  to service_role;

comment on table public.gmail_connections is
  'Server-only Gmail OAuth connections. Token material is AES-256-GCM ciphertext and is never client-readable.';
comment on table public.gmail_oauth_states is
  'Single-use SHA-256 hashes for Gmail OAuth state verification.';

commit;
