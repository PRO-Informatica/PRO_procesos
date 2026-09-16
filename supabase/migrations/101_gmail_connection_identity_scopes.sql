-- 101_gmail_connection_identity_scopes.sql
-- Keep Gmail API access plus the minimum OIDC scopes required to verify identity.

begin;

do $$
declare
  v_definition text;
  v_normalized_definition text;
  v_expected_definition constant text :=
    'check(granted_scopes@>array[''openid''::text,''email''::text,''profile''::text,''https://www.googleapis.com/auth/gmail.readonly''::text,''https://www.googleapis.com/auth/gmail.send''::text])';
begin
  if to_regclass('public.gmail_connections') is null then
    raise exception 'GMAIL_CONNECTIONS_TABLE_MISSING';
  end if;

  select pg_get_constraintdef(c.oid, true)
    into v_definition
  from pg_constraint c
  where c.conrelid = 'public.gmail_connections'::regclass
    and c.conname = 'gmail_connections_scopes_ck'
    and c.contype = 'c';

  if v_definition is null then
    raise exception 'GMAIL_CONNECTIONS_SCOPES_CONSTRAINT_MISSING';
  end if;

  v_normalized_definition := lower(
    regexp_replace(v_definition, '[[:space:]"]', '', 'g')
  );

  if v_normalized_definition <> v_expected_definition then
    raise exception 'GMAIL_CONNECTIONS_SCOPES_CONSTRAINT_UNEXPECTED: %',
      v_definition;
  end if;
end;
$$;

alter table public.gmail_connections
  drop constraint gmail_connections_scopes_ck;

alter table public.gmail_connections
  add constraint gmail_connections_scopes_ck
  check (
    granted_scopes @> array[
      'openid',
      'email',
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.send'
    ]::text[]
  );

commit;
