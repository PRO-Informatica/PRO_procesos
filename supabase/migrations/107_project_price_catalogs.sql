begin;

do $$
begin
  if to_regclass('public.projects') is null
     or to_regclass('public.audit_events') is null
     or to_regprocedure('app_private.is_platform_admin()') is null then
    raise exception 'Missing project catalog prerequisites';
  end if;
end;
$$;

create table public.project_product_prices (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  code text not null,
  reference text not null,
  price numeric(18,4) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_product_prices_code_valid
    check (code = btrim(code) and char_length(code) between 1 and 120
      and code !~ '[[:cntrl:]]'),
  constraint project_product_prices_reference_valid
    check (reference = btrim(reference) and char_length(reference) between 1 and 160
      and reference !~ '[[:cntrl:]]'),
  constraint project_product_prices_price_valid check (price >= 0),
  constraint project_product_prices_project_code_reference_key
    unique (project_id, code, reference)
);

create table public.project_service_prices (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  code text not null,
  price numeric(18,4) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_service_prices_code_valid
    check (code = btrim(code) and char_length(code) between 1 and 120
      and code !~ '[[:cntrl:]]'),
  constraint project_service_prices_price_valid check (price >= 0),
  constraint project_service_prices_project_code_key unique (project_id, code)
);

create index project_product_prices_project_code_idx
  on public.project_product_prices(project_id, code);
create index project_service_prices_project_code_idx
  on public.project_service_prices(project_id, code);

create function app_private.touch_project_price_catalog_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

alter function app_private.touch_project_price_catalog_updated_at() owner to postgres;
revoke all on function app_private.touch_project_price_catalog_updated_at()
  from public, anon, authenticated, service_role;

create trigger project_product_prices_updated_at
before update on public.project_product_prices
for each row execute function app_private.touch_project_price_catalog_updated_at();

create trigger project_service_prices_updated_at
before update on public.project_service_prices
for each row execute function app_private.touch_project_price_catalog_updated_at();

alter table public.project_product_prices enable row level security;
alter table public.project_product_prices force row level security;
alter table public.project_service_prices enable row level security;
alter table public.project_service_prices force row level security;

revoke all on table public.project_product_prices from public, anon, authenticated;
revoke all on table public.project_service_prices from public, anon, authenticated;
grant select on table public.project_product_prices to authenticated;
grant select on table public.project_service_prices to authenticated;
grant all on table public.project_product_prices to service_role;
grant all on table public.project_service_prices to service_role;

create policy project_product_prices_platform_admin_select
on public.project_product_prices
for select to authenticated
using (app_private.is_platform_admin());

create policy project_service_prices_platform_admin_select
on public.project_service_prices
for select to authenticated
using (app_private.is_platform_admin());

create or replace function public.platform_import_project_price_catalog(
  p_company_id uuid,
  p_project_id uuid,
  p_catalog_type text,
  p_mode text,
  p_file_name text,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_catalog_type text := upper(btrim(coalesce(p_catalog_type, '')));
  v_mode text := upper(btrim(coalesce(p_mode, '')));
  v_file_name text := btrim(coalesce(p_file_name, ''));
  v_rows jsonb;
  v_row_count integer;
  v_updated_count integer := 0;
  v_inserted_count integer := 0;
  v_total_count integer := 0;
  v_action text;
begin
  if v_actor is null or not app_private.is_platform_admin() then
    raise exception 'PERMISSION_DENIED';
  end if;

  perform 1
  from public.projects
  where id = p_project_id and company_id = p_company_id
  for update;
  if not found then
    raise exception 'PROJECT_NOT_FOUND';
  end if;

  if v_catalog_type not in ('PRODUCT', 'SERVICE') then
    raise exception 'CATALOG_TYPE_INVALID';
  end if;
  if v_mode not in ('REPLACE', 'UPDATE') then
    raise exception 'IMPORT_MODE_INVALID';
  end if;
  if char_length(v_file_name) not between 1 and 255
     or v_file_name ~ '[[:cntrl:]/\\]' then
    raise exception 'FILE_NAME_INVALID';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array'
     or jsonb_array_length(p_rows) not between 1 and 10000 then
    raise exception 'CATALOG_ROWS_INVALID';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_rows) item
    where jsonb_typeof(item) is distinct from 'object'
  ) then
    raise exception 'CATALOG_ROWS_INVALID';
  end if;

  if v_catalog_type = 'PRODUCT' then
    if exists (
      select 1
      from jsonb_array_elements(p_rows) item
      where jsonb_typeof(item->'code') is distinct from 'string'
         or jsonb_typeof(item->'reference') is distinct from 'string'
         or jsonb_typeof(item->'price') is distinct from 'string'
         or char_length(btrim(item->>'code')) not between 1 and 120
         or char_length(btrim(item->>'reference')) not between 1 and 160
         or btrim(item->>'code') ~ '[[:cntrl:]]'
         or btrim(item->>'reference') ~ '[[:cntrl:]]'
         or btrim(item->>'price') !~ '^(0|[1-9][0-9]{0,13})(\.[0-9]{1,4})?$'
    ) then
      raise exception 'CATALOG_ROWS_INVALID';
    end if;

    select jsonb_agg(jsonb_build_object(
      'code', btrim(item->>'code'),
      'reference', btrim(item->>'reference'),
      'price', btrim(item->>'price')
    ))
    into v_rows
    from jsonb_array_elements(p_rows) item;

    if exists (
      select 1
      from jsonb_to_recordset(v_rows) as row_data(code text, reference text, price text)
      group by row_data.code, row_data.reference
      having count(*) > 1
    ) then
      raise exception 'CATALOG_DUPLICATE_KEYS';
    end if;

    select count(*)::integer into v_row_count
    from jsonb_to_recordset(v_rows) as row_data(code text, reference text, price text);

    if v_mode = 'REPLACE' then
      delete from public.project_product_prices where project_id = p_project_id;
      v_inserted_count := v_row_count;
    else
      select count(*)::integer into v_updated_count
      from jsonb_to_recordset(v_rows) as row_data(code text, reference text, price text)
      join public.project_product_prices existing
        on existing.project_id = p_project_id
       and existing.code = row_data.code
       and existing.reference = row_data.reference;
      v_inserted_count := v_row_count - v_updated_count;
    end if;

    insert into public.project_product_prices(project_id, code, reference, price)
    select p_project_id, row_data.code, row_data.reference, row_data.price::numeric(18,4)
    from jsonb_to_recordset(v_rows) as row_data(code text, reference text, price text)
    on conflict (project_id, code, reference)
    do update set price = excluded.price;

    select count(*)::integer into v_total_count
    from public.project_product_prices where project_id = p_project_id;
    v_action := 'PROJECT_PRODUCT_PRICE_CATALOG_' ||
      case when v_mode = 'REPLACE' then 'REPLACED' else 'UPDATED' end;
  else
    if exists (
      select 1
      from jsonb_array_elements(p_rows) item
      where jsonb_typeof(item->'code') is distinct from 'string'
         or jsonb_typeof(item->'price') is distinct from 'string'
         or char_length(btrim(item->>'code')) not between 1 and 120
         or btrim(item->>'code') ~ '[[:cntrl:]]'
         or btrim(item->>'price') !~ '^(0|[1-9][0-9]{0,13})(\.[0-9]{1,4})?$'
    ) then
      raise exception 'CATALOG_ROWS_INVALID';
    end if;

    select jsonb_agg(jsonb_build_object(
      'code', btrim(item->>'code'),
      'price', btrim(item->>'price')
    ))
    into v_rows
    from jsonb_array_elements(p_rows) item;

    if exists (
      select 1
      from jsonb_to_recordset(v_rows) as row_data(code text, price text)
      group by row_data.code
      having count(*) > 1
    ) then
      raise exception 'CATALOG_DUPLICATE_KEYS';
    end if;

    select count(*)::integer into v_row_count
    from jsonb_to_recordset(v_rows) as row_data(code text, price text);

    if v_mode = 'REPLACE' then
      delete from public.project_service_prices where project_id = p_project_id;
      v_inserted_count := v_row_count;
    else
      select count(*)::integer into v_updated_count
      from jsonb_to_recordset(v_rows) as row_data(code text, price text)
      join public.project_service_prices existing
        on existing.project_id = p_project_id
       and existing.code = row_data.code;
      v_inserted_count := v_row_count - v_updated_count;
    end if;

    insert into public.project_service_prices(project_id, code, price)
    select p_project_id, row_data.code, row_data.price::numeric(18,4)
    from jsonb_to_recordset(v_rows) as row_data(code text, price text)
    on conflict (project_id, code)
    do update set price = excluded.price;

    select count(*)::integer into v_total_count
    from public.project_service_prices where project_id = p_project_id;
    v_action := 'PROJECT_SERVICE_PRICE_CATALOG_' ||
      case when v_mode = 'REPLACE' then 'REPLACED' else 'UPDATED' end;
  end if;

  insert into public.audit_events(
    actor_user_id, company_id, project_id, entity_type,
    entity_id, action, new_values
  ) values (
    v_actor, p_company_id, p_project_id, 'project_price_catalog',
    p_project_id, v_action,
    jsonb_build_object(
      'catalog_type', v_catalog_type,
      'mode', v_mode,
      'file_name', v_file_name,
      'received_count', v_row_count,
      'inserted_count', v_inserted_count,
      'updated_count', v_updated_count,
      'total_count', v_total_count
    )
  );

  return jsonb_build_object(
    'inserted_count', v_inserted_count,
    'updated_count', v_updated_count,
    'total_count', v_total_count
  );
end;
$$;

alter function public.platform_import_project_price_catalog(
  uuid,uuid,text,text,text,jsonb
) owner to postgres;
revoke all on function public.platform_import_project_price_catalog(
  uuid,uuid,text,text,text,jsonb
) from public, anon;
grant execute on function public.platform_import_project_price_catalog(
  uuid,uuid,text,text,text,jsonb
) to authenticated, service_role;

do $$
begin
  if to_regclass('public.project_product_prices') is null
     or to_regclass('public.project_service_prices') is null
     or to_regprocedure('public.platform_import_project_price_catalog(uuid,uuid,text,text,text,jsonb)') is null then
    raise exception 'Project price catalog migration postcondition failed';
  end if;
end;
$$;

commit;
