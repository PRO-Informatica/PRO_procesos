-- DEV only. All imports, disposable projects and guide changes roll back.
begin;

do $$
declare
  v_dispatch public.dispatches%rowtype;
  v_actor uuid;
  v_company uuid;
  v_unit text;
  v_project uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_prefix text := 'QA-117-' || gen_random_uuid()::text;
  v_rows jsonb;
  v_result jsonb;
  v_before jsonb;
  v_product uuid;
  v_first uuid;
  v_second uuid;
  v_guide uuid;
  v_lines jsonb;
begin
  select d.* into strict v_dispatch from public.dispatches d
  join public.projects p on p.id=d.project_id and p.status='ACTIVE'
  join public.companies c on c.id=p.company_id and c.status='ACTIVE'
  join public.platform_admins a on a.user_id=d.created_by and a.active
  where d.status='IN_EXECUTION' order by d.created_at desc limit 1;
  v_actor := v_dispatch.created_by;
  select p.company_id,pr.unit_code into v_company,v_unit
  from public.projects p join public.programming pr on pr.project_id=p.id where pr.id=v_dispatch.programming_id;
  perform set_config('request.jwt.claim.sub',v_actor::text,true);
  insert into public.projects(id,company_id,name,code,address,status) values
    (v_project,v_company,'Service variants QA',v_project::text,'QA only','ACTIVE'),
    (v_other,v_company,'Other variants QA',v_other::text,'QA only','ACTIVE');
  v_rows := '[
    {"code":"86180185","description":"Dosis extra","observations":"Una dosis","unit_code":"M3","price":"10.92"},
    {"code":"86180185","description":"Dosis extra","observations":"Doble dosis","unit_code":"M3","price":"21.84"},
    {"code":"86180185","description":"Dosis extra","observations":"Por unidad","unit_code":"UN","price":"1"},
    {"code":"86180185","description":"Dosis extra","observations":null,"unit_code":null,"price":"0"}
  ]';
  execute 'set local role authenticated';
  v_result := public.platform_import_project_price_catalog(v_company,v_project,'SERVICE','UPDATE','qa-117.xlsx',v_rows);
  perform public.platform_import_project_price_catalog(v_company,v_other,'SERVICE','UPDATE','qa-117.xlsx',v_rows);
  execute 'reset role';
  if v_result->>'inserted_count'<>'4' or (select count(*) from public.project_service_prices where project_id=v_project)<>4 then
    raise exception 'QA_VARIANTS_NOT_PRESERVED';
  end if;
  select jsonb_agg(jsonb_build_object('id',id,'observations',observations) order by id)
  into v_before from public.project_service_prices where project_id=v_project;
  execute 'set local role authenticated';
  v_result := public.platform_import_project_price_catalog(v_company,v_project,'SERVICE','UPDATE','qa-117.xlsx',v_rows);
  execute 'reset role';
  if v_result->>'inserted_count'<>'0' or v_result->>'updated_count'<>'4'
     or v_before is distinct from (select jsonb_agg(jsonb_build_object('id',id,'observations',observations) order by id) from public.project_service_prices where project_id=v_project) then
    raise exception 'QA_VARIANT_UPDATE_NOT_IDEMPOTENT';
  end if;
  raise notice 'PASS: same code, description and UM preserve different observations and prices; repeat UPDATE preserves IDs';

  execute 'set local role authenticated';
  begin
    perform public.platform_import_project_price_catalog(v_company,v_project,'SERVICE','REPLACE','qa-117.xlsx',v_rows||v_rows);
    raise exception 'QA_EXACT_VARIANT_DUPLICATE_ALLOWED';
  exception when raise_exception then if sqlerrm<>'CATALOG_DUPLICATE_KEYS' then raise; end if; end;
  begin
    perform public.platform_import_project_price_catalog(v_company,v_project,'SERVICE','REPLACE','qa-117.xlsx',
      '[{"code":"N","description":"Same","unit_code":null,"price":"0"},{"code":"N","description":"Other","observations":" ","unit_code":"M3","price":"1"}]');
    raise exception 'QA_NULL_VARIANT_DUPLICATE_ALLOWED';
  exception when raise_exception then if sqlerrm<>'CATALOG_DUPLICATE_KEYS' then raise; end if; end;
  begin
    perform public.platform_import_project_price_catalog(v_company,v_project,'SERVICE','REPLACE','qa-117.xlsx',
      '[{"code":"T","description":"Same","observations":"Una dosis","unit_code":null,"price":"0"},{"code":"T","description":"Other","observations":"  Una dosis  ","unit_code":"M3","price":"1"}]');
    raise exception 'QA_TRIMMED_OBSERVATIONS_DUPLICATE_ALLOWED';
  exception when raise_exception then if sqlerrm<>'CATALOG_DUPLICATE_KEYS' then raise; end if; end;
  begin
    perform public.platform_import_project_price_catalog(v_company,v_project,'SERVICE','UPDATE','qa-117.xlsx',
      jsonb_build_array(jsonb_build_object('code','BAD','description','Same','observations',repeat('x',501),'price','0')));
    raise exception 'QA_INVALID_OBSERVATIONS_ALLOWED';
  exception when raise_exception then if sqlerrm<>'CATALOG_ROWS_INVALID' then raise; end if; end;
  begin
    perform public.platform_import_project_price_catalog(v_company,v_project,'PRODUCT','UPDATE','qa-117.xlsx',
      '[{"code":"P","reference":"CON.1","price":"1"},{"code":"P","reference":"CON.1","price":"2"}]');
    raise exception 'QA_PRODUCT_DUPLICATE_ALLOWED';
  exception when raise_exception then if sqlerrm<>'CATALOG_DUPLICATE_KEYS' then raise; end if; end;
  execute 'reset role';
  if (select count(*) from public.project_service_prices where project_id=v_project)<>4 then
    raise exception 'QA_FAILED_REPLACE_CHANGED_DATA';
  end if;
  begin
    insert into public.project_service_prices(project_id,code,description,unit_code,price)
    values(v_project,'86180185','Dosis extra',null,99);
    raise exception 'QA_DATABASE_DUPLICATE_ALLOWED';
  exception when unique_violation then null; end;
  raise notice 'PASS: duplicate/empty/trimmed observations and invalid metadata rejected atomically; products unchanged';

  execute 'set local role authenticated';
  perform public.platform_import_project_price_catalog(v_company,v_dispatch.project_id,'PRODUCT','UPDATE','qa-117.xlsx',
    jsonb_build_array(jsonb_build_object('code',v_prefix,'reference','QA.117','price','100')));
  perform public.platform_import_project_price_catalog(v_company,v_dispatch.project_id,'SERVICE','UPDATE','qa-117.xlsx',
    jsonb_build_array(
      jsonb_build_object('code',v_prefix,'description','Dosis extra','observations',v_prefix||'-Una dosis','unit_code','M3','price','10.92'),
      jsonb_build_object('code',v_prefix,'description','Dosis extra','observations',v_prefix||'-Doble dosis','unit_code','M3','price','21.84')));
  v_result := public.search_project_dispatch_catalog(v_dispatch.project_id,'SERVICE',v_prefix,50);
  execute 'reset role';
  if jsonb_array_length(v_result->'items')<>2
     or (select count(distinct item->>'id') from jsonb_array_elements(v_result->'items') item)<>2
     or (select count(distinct item->>'observations') from jsonb_array_elements(v_result->'items') item)<>2 then
    raise exception 'QA_PICKER_COLLAPSED_VARIANTS';
  end if;
  select id into strict v_product from public.project_product_prices where project_id=v_dispatch.project_id and code=v_prefix;
  execute 'set local role authenticated';
  v_result := public.search_project_dispatch_catalog(v_dispatch.project_id,'SERVICE',v_prefix||'-Doble dosis',50);
  execute 'reset role';
  if jsonb_array_length(v_result->'items')<>1 or v_result->'items'->0->>'observations'<>v_prefix||'-Doble dosis' then
    raise exception 'QA_OBSERVATIONS_SEARCH_FAILED';
  end if;
  select id into strict v_first from public.project_service_prices where project_id=v_dispatch.project_id and code=v_prefix and observations=v_prefix||'-Una dosis';
  select id into strict v_second from public.project_service_prices where project_id=v_dispatch.project_id and code=v_prefix and observations=v_prefix||'-Doble dosis';
  v_lines := jsonb_build_array(
    jsonb_build_object('catalog_type','PRODUCT','catalog_item_id',v_product,'quantity',10,'unit_code',v_unit),
    jsonb_build_object('catalog_type','SERVICE','catalog_item_id',v_first,'quantity',1,'unit_code','M3'),
    jsonb_build_object('catalog_type','SERVICE','catalog_item_id',v_second,'quantity',1,'unit_code','M3'));
  execute 'set local role authenticated';
  v_result := public.create_dispatch_guide_with_lines(v_dispatch.id,v_dispatch.version,v_prefix,current_date,v_lines);
  execute 'reset role';
  v_guide := (v_result->>'guide_id')::uuid;
  if (select count(*) from public.dispatch_guide_lines where guide_id=v_guide and catalog_type='SERVICE')<>2
     or not exists(select 1 from public.dispatch_guide_lines where guide_id=v_guide and service_price_id=v_first and unit_price=10.92 and product_description='Dosis extra')
     or not exists(select 1 from public.dispatch_guide_lines where guide_id=v_guide and service_price_id=v_second and unit_price=21.84 and product_description='Dosis extra') then
    raise exception 'QA_GUIDE_VARIANT_SNAPSHOT_FAILED';
  end if;
  execute 'set local role authenticated';
  v_result := public.platform_import_project_price_catalog(v_company,v_dispatch.project_id,'SERVICE','UPDATE','qa-117.xlsx',
    jsonb_build_array(jsonb_build_object('code',v_prefix,'description','Descripción actualizada','observations',v_prefix||'-Una dosis','unit_code','UN','price','99')));
  execute 'reset role';
  if v_result->>'updated_count'<>'1' or v_result->>'inserted_count'<>'0'
     or not exists(select 1 from public.project_service_prices where id=v_first and price=99 and description='Descripción actualizada' and unit_code='UN')
     or not exists(select 1 from public.project_service_prices where id=v_second and price=21.84)
     or not exists(select 1 from public.dispatch_guide_lines where guide_id=v_guide and service_price_id=v_first and unit_price=10.92 and product_description='Dosis extra' and unit_code='M3') then
    raise exception 'QA_VARIANT_PRICE_OR_HISTORY_CHANGED';
  end if;
  raise notice 'PASS: picker exposes/searches observations; guide receives description/UM/price, never observations; updates preserve history';

  execute 'set local role authenticated';
  perform public.platform_import_project_price_catalog(v_company,v_project,'SERVICE','REPLACE','qa-117.xlsx',v_rows);
  execute 'reset role';
  if (select count(*) from public.project_service_prices where project_id=v_project)<>4
     or (select count(*) from public.project_service_prices where project_id=v_other)<>4 then
    raise exception 'QA_VARIANT_REPLACE_SCOPE_FAILED';
  end if;
  raise notice 'PASS: REPLACE preserves every input variant and remains isolated to its project';
end;
$$;

rollback;
