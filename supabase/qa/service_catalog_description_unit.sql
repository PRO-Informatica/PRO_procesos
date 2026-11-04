-- DEV integration QA for 112. All fixtures, imports and guide changes roll back.
begin;

create function pg_temp.reject_service_import_audit()
returns trigger language plpgsql as $$
begin
  if current_setting('qa.reject_service_import', true) = 'on'
     and new.action like 'PROJECT_SERVICE_PRICE_CATALOG_%' then
    raise exception 'QA_SERVICE_IMPORT_FAILURE';
  end if;
  return new;
end;
$$;
create trigger qa_reject_service_import_audit before insert on public.audit_events
for each row execute function pg_temp.reject_service_import_audit();

do $$
declare
  v_actor uuid;
  v_company uuid;
  v_project uuid := gen_random_uuid();
  v_other_project uuid := gen_random_uuid();
  v_dispatch public.dispatches%rowtype;
  v_programmed_unit text;
  v_product uuid;
  v_service uuid;
  v_other_service uuid;
  v_service_code text := 'QA-' || gen_random_uuid()::text;
  v_product_code text := 'QA-' || gen_random_uuid()::text;
  v_rows jsonb;
  v_result jsonb;
  v_lines jsonb;
  v_guide uuid;
  v_version integer;
  v_line public.dispatch_guide_lines%rowtype;
begin
  select dispatch.* into strict v_dispatch from public.dispatches dispatch
  join public.projects project on project.id=dispatch.project_id
  join public.companies company on company.id=project.company_id
  where dispatch.status='IN_EXECUTION' and project.status='ACTIVE' and company.status='ACTIVE'
  order by dispatch.created_at desc limit 1;
  select admin.user_id into strict v_actor from public.platform_admins admin
  join public.profiles profile on profile.id=admin.user_id
  where admin.user_id=v_dispatch.created_by and admin.active and profile.active;
  select project.company_id, programming.unit_code into v_company,v_programmed_unit
  from public.projects project join public.programming programming on programming.project_id=project.id
  where programming.id=v_dispatch.programming_id;
  insert into public.projects(id,company_id,name,code,address,status) values
    (v_project,v_company,'Services QA',v_project::text,'QA address','ACTIVE'),
    (v_other_project,v_company,'Other services QA',v_other_project::text,'QA address','ACTIVE');

  perform set_config('request.jwt.claim.sub',v_actor::text,true);
  execute 'set local role authenticated';
  v_rows := jsonb_build_array(jsonb_build_object('code',v_service_code,'description','Bomba y operador','unit_code','M3','price','80.64'));
  perform public.platform_import_project_price_catalog(v_company,v_project,'SERVICE','UPDATE','qa.xlsx',v_rows);
  perform public.platform_import_project_price_catalog(v_company,v_other_project,'SERVICE','UPDATE','qa.xlsx',v_rows);
  execute 'reset role';
  if (select count(*) from public.project_service_prices where code=v_service_code) <> 2
     or not exists(select 1 from public.project_service_prices where project_id=v_project and description='Bomba y operador' and unit_code='M3' and price=80.64) then
    raise exception 'QA_SERVICE_IMPORT_FAILED';
  end if;
  raise notice 'PASS: imports preserve metadata, decimal prices and per-project identity';

  execute 'set local role authenticated';
  v_result := public.search_project_dispatch_catalog(v_dispatch.project_id,'SERVICE',v_service_code,50);
  if jsonb_array_length(v_result->'items') <> 0 then raise exception 'QA_PROJECT_CATALOG_LEAK'; end if;
  begin
    perform public.platform_import_project_price_catalog(gen_random_uuid(),v_project,'SERVICE','UPDATE','qa.xlsx',v_rows);
    raise exception 'QA_WRONG_COMPANY_ALLOWED';
  exception when raise_exception then if sqlerrm<>'PROJECT_NOT_FOUND' then raise; end if; end;

  begin
    perform public.platform_import_project_price_catalog(v_company,v_project,'SERVICE','REPLACE','qa.xlsx',v_rows || v_rows);
    raise exception 'QA_DUPLICATE_ALLOWED';
  exception when raise_exception then if sqlerrm<>'CATALOG_DUPLICATE_KEYS' then raise; end if; end;
  begin
    perform public.platform_import_project_price_catalog(v_company,v_project,'SERVICE','REPLACE','qa.xlsx',jsonb_build_array(jsonb_build_object('code','bad','description','Bomba','unit_code','LITROS','price','1')));
    raise exception 'QA_BAD_UNIT_ALLOWED';
  exception when raise_exception then if sqlerrm<>'CATALOG_ROWS_INVALID' then raise; end if; end;
  begin
    perform public.platform_import_project_price_catalog(v_company,v_project,'SERVICE','REPLACE','qa.xlsx','[{"code":"bad","price":"1"}]'::jsonb);
    raise exception 'QA_MISSING_METADATA_ALLOWED';
  exception when raise_exception then if sqlerrm<>'CATALOG_ROWS_INVALID' then raise; end if; end;
  execute 'reset role';

  perform set_config('qa.reject_service_import','on',true);
  execute 'set local role authenticated';
  begin
    perform public.platform_import_project_price_catalog(v_company,v_project,'SERVICE','REPLACE','qa.xlsx','[{"code":"REPLACEMENT","description":"Combo","unit_code":"COMBO","price":"99"}]'::jsonb);
    raise exception 'QA_EXPECTED_IMPORT_FAILURE';
  exception when raise_exception then if sqlerrm<>'QA_SERVICE_IMPORT_FAILURE' then raise; end if; end;
  execute 'reset role';
  perform set_config('qa.reject_service_import','off',true);
  if not exists(select 1 from public.project_service_prices where project_id=v_project and code=v_service_code and price=80.64)
     or exists(select 1 from public.project_service_prices where project_id=v_project and code='REPLACEMENT') then
    raise exception 'QA_REPLACE_ROLLBACK_FAILED';
  end if;
  raise notice 'PASS: duplicates, invalid metadata and wrong company rejected; failed replacement is atomic';

  -- Import into the operational project for a genuine create/update guide RPC.
  execute 'set local role authenticated';
  perform public.platform_import_project_price_catalog(v_company,v_dispatch.project_id,'SERVICE','UPDATE','qa.xlsx',v_rows);
  perform public.platform_import_project_price_catalog(v_company,v_dispatch.project_id,'PRODUCT','UPDATE','qa.xlsx',jsonb_build_array(jsonb_build_object('code',v_product_code,'reference','QA.112','price','10')));
  execute 'reset role';
  select id into strict v_service from public.project_service_prices where project_id=v_dispatch.project_id and code=v_service_code;
  select id into strict v_other_service from public.project_service_prices where project_id=v_other_project and code=v_service_code;
  select id into strict v_product from public.project_product_prices where project_id=v_dispatch.project_id and code=v_product_code;
  v_lines := jsonb_build_array(
    jsonb_build_object('quantity',10,'unit_code',v_programmed_unit,'catalog_type','PRODUCT','catalog_item_id',v_product),
    jsonb_build_object('quantity',2,'unit_code','M3','catalog_type','SERVICE','catalog_item_id',v_service)
  );
  execute 'set local role authenticated';
  v_result := public.create_dispatch_guide_with_lines(v_dispatch.id,v_dispatch.version,'QA-'||gen_random_uuid()::text,current_date,v_lines);
  execute 'reset role';
  v_guide := (v_result->>'guide_id')::uuid;
  v_version := (v_result->>'dispatch_version')::integer;
  select * into strict v_line from public.dispatch_guide_lines where guide_id=v_guide and catalog_type='SERVICE';
  if v_line.product_description <> 'Bomba y operador' or v_line.unit_code <> 'M3'
     or v_line.unit_price <> 80.64 or v_line.estimated_subtotal <> 161.28
     or (select quantity from public.dispatch_guides where id=v_guide) <> 10 then
    raise exception 'QA_GUIDE_SERVICE_SNAPSHOT_FAILED';
  end if;
  raise notice 'PASS: backend defaults description, validates UM, snapshots price and excludes service from physical volume';

  execute 'set local role authenticated';
  v_result := public.search_project_dispatch_catalog(v_dispatch.project_id,'SERVICE','Bomba y operador',100);
  if not exists(select 1 from jsonb_array_elements(v_result->'items') item where item->>'id'=v_service::text and item->>'description'='Bomba y operador' and item->>'unit_code'='M3')
     or exists(select 1 from jsonb_array_elements(v_result->'items') item where item->>'id'=v_other_service::text) then
    raise exception 'QA_SEARCH_METADATA_OR_ISOLATION_FAILED';
  end if;
  begin
    perform public.create_dispatch_guide_with_lines(v_dispatch.id,v_version,'QA-'||gen_random_uuid()::text,current_date,jsonb_set(v_lines,'{1,catalog_item_id}',to_jsonb(v_other_service)));
    raise exception 'QA_FOREIGN_SERVICE_ALLOWED';
  exception when raise_exception then if sqlerrm<>'DISPATCH_CATALOG_ITEM_NOT_FOUND' then raise; end if; end;
  begin
    perform public.create_dispatch_guide_with_lines(v_dispatch.id,v_version,'QA-'||gen_random_uuid()::text,current_date,jsonb_set(v_lines,'{1,unit_code}','"KM"'::jsonb));
    raise exception 'QA_MISMATCH_UNIT_ALLOWED';
  exception when raise_exception then if sqlerrm<>'DISPATCH_SERVICE_UNIT_MISMATCH' then raise; end if; end;
  -- Changing the catalog must not rewrite the line when changing quantity.
  perform public.platform_import_project_price_catalog(v_company,v_dispatch.project_id,'SERVICE','UPDATE','qa.xlsx',jsonb_build_array(jsonb_build_object('code',v_service_code,'description','Descripción nueva','unit_code','COMBO','price','999')));
  execute 'reset role';
  if not exists(select 1 from public.project_product_prices where id=v_product and price=10) then raise exception 'QA_PRODUCT_CATALOG_CHANGED'; end if;
  select jsonb_agg(jsonb_build_object('line_id',id,'quantity',case when catalog_type='SERVICE' then 3 else quantity end,'unit_code',unit_code,'catalog_type',catalog_type,'catalog_item_id',coalesce(product_price_id,service_price_id),'product_description',product_description) order by position)
    into v_lines from public.dispatch_guide_lines where guide_id=v_guide;
  execute 'set local role authenticated';
  perform public.update_dispatch_guide_with_lines(v_guide,v_version,'QA-'||v_guide::text,current_date,v_lines);
  execute 'reset role';
  select * into strict v_line from public.dispatch_guide_lines where guide_id=v_guide and catalog_type='SERVICE';
  if v_line.product_description <> 'Bomba y operador' or v_line.unit_code <> 'M3' or v_line.unit_price <> 80.64 or v_line.estimated_subtotal <> 241.92 then
    raise exception 'QA_SERVICE_HISTORY_CHANGED';
  end if;
  raise notice 'PASS: search includes description/UM; foreign projects and mismatched UM rejected; quantity edits preserve historical price and metadata';

  -- Commercial units are allowed only on service lines.
  execute 'set local role authenticated';
  select version into v_version from public.dispatches where id=v_dispatch.id;
  perform public.create_dispatch_guide_with_lines(v_dispatch.id,v_version,'QA-'||gen_random_uuid()::text,current_date,
    jsonb_build_array(jsonb_build_object('quantity',1,'unit_code',v_programmed_unit,'catalog_type','PRODUCT','catalog_item_id',v_product),
      jsonb_build_object('quantity',1,'unit_code','COMBO','catalog_type','SERVICE','catalog_item_id',v_service)));
  execute 'reset role';

  perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
  execute 'set local role authenticated';
  begin
    perform public.platform_import_project_price_catalog(v_company,v_project,'SERVICE','UPDATE','qa.xlsx',v_rows);
    raise exception 'QA_UNAUTHORIZED_IMPORT_ALLOWED';
  exception when raise_exception then if sqlerrm<>'PERMISSION_DENIED' then raise; end if; end;
  begin
    perform public.search_project_dispatch_catalog(v_dispatch.project_id,'SERVICE','',50);
    raise exception 'QA_UNAUTHORIZED_SEARCH_ALLOWED';
  exception when raise_exception then if sqlerrm<>'PERMISSION_DENIED' then raise; end if; end;
  execute 'reset role';
  raise notice 'PASS: service commercial units work through the real guide RPC; unauthorized imports and catalog searches are blocked';
end;
$$;

rollback;
