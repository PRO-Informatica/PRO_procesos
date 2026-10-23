-- DEV only. Authenticated imports use disposable projects; every change rolls back.
begin;

do $$
declare
  v_actor uuid;
  v_company uuid;
  v_project uuid := gen_random_uuid();
  v_other_project uuid := gen_random_uuid();
  v_row jsonb;
  v_rows jsonb;
  v_result jsonb;
  v_product uuid;
  v_service uuid;
  v_lines jsonb;
begin
  select admin.user_id into strict v_actor from public.platform_admins admin
  join public.profiles profile on profile.id=admin.user_id
  where admin.active and profile.active order by admin.user_id limit 1;
  select id into strict v_company from public.companies where status='ACTIVE' order by id limit 1;
  insert into public.projects(id,company_id,name,code,address,status) values
    (v_project,v_company,'Optional UM QA',v_project::text,'QA only','ACTIVE'),
    (v_other_project,v_company,'Other UM QA',v_other_project::text,'QA only','ACTIVE');
  perform set_config('request.jwt.claim.sub',v_actor::text,true);
  v_rows := '[
    {"code":"NULL","description":"Curador rojo","unit_code":null,"price":"509.04"},
    {"code":"EMPTY","description":"Curador blanco","unit_code":"","price":"333.2"},
    {"code":"SPACES","description":"Sin unidad","unit_code":"  \t  ","price":"0"},
    {"code":"OMITTED","description":"Sin unidad","price":"0"},
    {"code":"M3","description":"Bomba","unit_code":"m³","price":"80.64"},
    {"code":"DOSE","description":"Dosis","unit_code":"dosis/m3","price":"10.92"}
  ]'::jsonb || jsonb_build_array(jsonb_build_object('code','NBSP','description','Sin unidad','unit_code',chr(160),'price','0'));
  execute 'set local role authenticated';
  v_result := public.platform_import_project_price_catalog(v_company,v_project,'SERVICE','UPDATE','qa-116.xlsx',v_rows);
  perform public.platform_import_project_price_catalog(v_company,v_other_project,'SERVICE','UPDATE','qa-116.xlsx',
    '[{"code":"NULL","description":"Otro proyecto","unit_code":"UN","price":"9"}]');
  perform public.platform_import_project_price_catalog(v_company,v_project,'PRODUCT','UPDATE','qa-116.xlsx',
    '[{"code":"PRODUCT","reference":"QA.116","price":"0"}]');
  execute 'reset role';
  if v_result->>'inserted_count'<>'7'
     or (select count(*) from public.project_service_prices where project_id=v_project and unit_code is null)<>5
     or not exists(select 1 from public.project_service_prices where project_id=v_project and code='M3' and unit_code='M3' and price=80.64)
     or not exists(select 1 from public.project_service_prices where project_id=v_project and code='DOSE' and unit_code='DOSIS/M3' and price=10.92) then
    raise exception 'QA_OPTIONAL_UM_IMPORT_FAILED';
  end if;
  raise notice 'PASS: null, missing, blank and whitespace units persist as NULL; known units and prices are unchanged';

  execute 'set local role authenticated';
  for v_row in select value from jsonb_array_elements('[true,123,["M3"],{"code":"M3"},"LITROS"]'::jsonb) loop
    begin
      perform public.platform_import_project_price_catalog(v_company,v_project,'SERVICE','REPLACE','qa-116.xlsx',
        jsonb_build_array(jsonb_build_object('code','BAD','description','Invalid','unit_code',v_row,'price','1')));
      raise exception 'QA_INVALID_UNIT_ALLOWED';
    exception when raise_exception then if sqlerrm<>'CATALOG_ROWS_INVALID' then raise; end if; end;
  end loop;
  begin
    perform public.platform_import_project_price_catalog(v_company,v_project,'SERVICE','REPLACE','qa-116.xlsx',v_rows||v_rows);
    raise exception 'QA_DUPLICATES_ALLOWED';
  exception when raise_exception then if sqlerrm<>'CATALOG_DUPLICATE_KEYS' then raise; end if; end;
  begin
    perform public.platform_import_project_price_catalog(gen_random_uuid(),v_project,'SERVICE','UPDATE','qa-116.xlsx',v_rows);
    raise exception 'QA_COMPANY_SCOPE_LOST';
  exception when raise_exception then if sqlerrm<>'PROJECT_NOT_FOUND' then raise; end if; end;
  execute 'reset role';
  if (select count(*) from public.project_service_prices where project_id=v_project)<>7 then
    raise exception 'QA_FAILED_REPLACE_CHANGED_DATA';
  end if;
  raise notice 'PASS: invalid units/types, duplicates and incorrect company remain rejected atomically';

  execute 'set local role authenticated';
  perform public.platform_import_project_price_catalog(v_company,v_project,'SERVICE','UPDATE','qa-116.xlsx',
    '[{"code":"M3","description":"Unidad eliminada del catálogo","unit_code":null,"price":"0"}]');
  begin
    perform public.search_project_dispatch_catalog(v_project,'SERVICE','M3',50);
    raise exception 'QA_SEARCH_PERMISSION_BYPASS';
  exception when raise_exception then if sqlerrm<>'PERMISSION_DENIED' then raise; end if; end;
  execute 'reset role';
  if not exists(select 1 from public.project_service_prices where project_id=v_project and code='M3' and unit_code is null and price=0)
     or not exists(select 1 from public.project_service_prices where project_id=v_other_project and code='NULL' and unit_code='UN' and price=9) then
    raise exception 'QA_SEARCH_OR_PROJECT_ISOLATION_FAILED';
  end if;
  select id into strict v_product from public.project_product_prices where project_id=v_project and code='PRODUCT';
  select id into strict v_service from public.project_service_prices where project_id=v_project and code='M3';
  v_lines := jsonb_build_array(
    jsonb_build_object('catalog_type','PRODUCT','catalog_item_id',v_product,'quantity',10,'unit_code','M3'),
    jsonb_build_object('catalog_type','SERVICE','catalog_item_id',v_service,'quantity',1,'unit_code','UN')
  );
  v_result := app_private.resolve_dispatch_guide_lines(v_project,'M3',v_lines);
  if v_result->1->>'unit_code'<>'UN' or (v_result->1->>'unit_price')::numeric<>0 then
    raise exception 'QA_MANUAL_GUIDE_UNIT_FAILED';
  end if;
  begin
    perform app_private.resolve_dispatch_guide_lines(v_project,'M3',jsonb_set(v_lines,'{1,unit_code}','null'::jsonb));
    raise exception 'QA_GUIDE_WITHOUT_UNIT_ALLOWED';
  exception when raise_exception then if sqlerrm<>'INVALID_OR_INACTIVE_UNIT_OF_MEASURE' then raise; end if; end;
  raise notice 'PASS: no default unit is invented, search permissions remain enforced and guides require a valid manual unit';

  execute 'set local role authenticated';
  perform public.platform_import_project_price_catalog(v_company,v_project,'SERVICE','REPLACE','qa-116.xlsx',
    '[{"code":"ONLY","description":"Solo este servicio","unit_code":null,"price":"1"}]');
  execute 'reset role';
  if (select count(*) from public.project_service_prices where project_id=v_project)<>1
     or not exists(select 1 from public.project_service_prices where project_id=v_other_project and code='NULL' and unit_code='UN')
     or not exists(select 1 from public.project_product_prices where id=v_product and price=0) then
    raise exception 'QA_REPLACE_CATALOG_SCOPE_FAILED';
  end if;
  perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
  execute 'set local role authenticated';
  begin
    perform public.platform_import_project_price_catalog(v_company,v_project,'SERVICE','UPDATE','qa-116.xlsx',v_rows);
    raise exception 'QA_NON_ADMIN_ALLOWED';
  exception when raise_exception then if sqlerrm<>'PERMISSION_DENIED' then raise; end if; end;
  execute 'reset role';
  raise notice 'PASS: UPDATE/REPLACE remain scoped; product prices and authorization are preserved';
end;
$$;

rollback;
