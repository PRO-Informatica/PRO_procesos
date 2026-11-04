-- DEV only. Actual authenticated imports and guide creation, entirely rolled back.
begin;
do $$
declare
  v_dispatch public.dispatches%rowtype;
  v_company uuid;
  v_unit text;
  v_prefix text := 'QA-118-'||gen_random_uuid()::text;
  v_product uuid;
  v_linear uuid;
  v_each uuid;
  v_empty uuid;
  v_guide uuid;
  v_rows jsonb;
  v_lines jsonb;
  v_result jsonb;
begin
  select d.* into strict v_dispatch from public.dispatches d
  join public.projects p on p.id=d.project_id and p.status='ACTIVE'
  join public.companies c on c.id=p.company_id and c.status='ACTIVE'
  join public.platform_admins a on a.user_id=d.created_by and a.active
  where d.status='IN_EXECUTION' order by d.created_at desc limit 1;
  select p.company_id,pr.unit_code into v_company,v_unit
  from public.projects p join public.programming pr on pr.project_id=p.id where pr.id=v_dispatch.programming_id;
  perform set_config('request.jwt.claim.sub',v_dispatch.created_by::text,true);
  if app_private.normalize_service_catalog_unit(' u ')<>'UN'
     or app_private.normalize_service_catalog_unit('m')<>'M'
     or app_private.normalize_service_catalog_unit('m³')<>'M3' then
    raise exception 'QA_SUPPLIER_UNIT_NORMALIZATION_FAILED';
  end if;
  v_rows := jsonb_build_array(
    jsonb_build_object('code',v_prefix,'description','Corte lineal','observations','Por metro','unit_code','m','price','22.12'),
    jsonb_build_object('code',v_prefix,'description','Corte mínimo','observations','Por unidad','unit_code','U','price','18.76'),
    jsonb_build_object('code',v_prefix,'description','Sin unidad','observations','Manual','unit_code',null,'price','0'));
  execute 'set local role authenticated';
  v_result := public.platform_import_project_price_catalog(v_company,v_dispatch.project_id,'SERVICE','UPDATE','qa-118.xlsx',v_rows);
  perform public.platform_import_project_price_catalog(v_company,v_dispatch.project_id,'PRODUCT','UPDATE','qa-118.xlsx',
    jsonb_build_array(jsonb_build_object('code',v_prefix,'reference','QA.118','price','100')));
  begin
    perform public.platform_import_project_price_catalog(v_company,v_dispatch.project_id,'SERVICE','REPLACE','qa-118.xlsx',
      jsonb_build_array(jsonb_build_object('code',v_prefix,'description','Invalid','unit_code','galón','price','1')));
    raise exception 'QA_UNKNOWN_UNIT_ACCEPTED';
  exception when raise_exception then if sqlerrm<>'CATALOG_ROWS_INVALID' then raise; end if; end;
  execute 'reset role';
  if v_result->>'inserted_count'<>'3' then raise exception 'QA_UNIT_IMPORT_FAILED'; end if;
  select id into strict v_product from public.project_product_prices where project_id=v_dispatch.project_id and code=v_prefix;
  select id into strict v_linear from public.project_service_prices where project_id=v_dispatch.project_id and code=v_prefix and unit_code='M' and price=22.12;
  select id into strict v_each from public.project_service_prices where project_id=v_dispatch.project_id and code=v_prefix and unit_code='UN' and price=18.76;
  select id into strict v_empty from public.project_service_prices where project_id=v_dispatch.project_id and code=v_prefix and unit_code is null;
  raise notice 'PASS: authenticated import accepts U as UN, m as M, and empty UM without changing prices or observation identities';
  v_lines := jsonb_build_array(
    jsonb_build_object('catalog_type','PRODUCT','catalog_item_id',v_product,'quantity',10,'unit_code',v_unit),
    jsonb_build_object('catalog_type','SERVICE','catalog_item_id',v_linear,'quantity',10,'unit_code','M'),
    jsonb_build_object('catalog_type','SERVICE','catalog_item_id',v_each,'quantity',1,'unit_code','U'),
    jsonb_build_object('catalog_type','SERVICE','catalog_item_id',v_empty,'quantity',1,'unit_code','UN'));
  begin
    perform app_private.resolve_dispatch_guide_lines(v_dispatch.project_id,v_unit,jsonb_set(v_lines,'{0,unit_code}','"M"'));
    raise exception 'QA_LINEAR_PRODUCT_UNIT_ALLOWED';
  exception when raise_exception then if sqlerrm<>'INVALID_OR_INACTIVE_UNIT_OF_MEASURE' then raise; end if; end;
  begin
    perform app_private.resolve_dispatch_guide_lines(v_dispatch.project_id,v_unit,jsonb_set(v_lines,'{1,unit_code}','"M3"'));
    raise exception 'QA_LINEAR_TO_CUBIC_CONVERSION_ALLOWED';
  exception when raise_exception then if sqlerrm<>'DISPATCH_SERVICE_UNIT_MISMATCH' then raise; end if; end;
  begin
    perform app_private.resolve_dispatch_guide_lines(v_dispatch.project_id,v_unit,jsonb_set(v_lines,'{3,unit_code}','null'));
    raise exception 'QA_GUIDE_UNIT_OMITTED';
  exception when raise_exception then if sqlerrm<>'INVALID_OR_INACTIVE_UNIT_OF_MEASURE' then raise; end if; end;
  execute 'set local role authenticated';
  v_result := public.create_dispatch_guide_with_lines(v_dispatch.id,v_dispatch.version,v_prefix,current_date,v_lines);
  execute 'reset role';
  v_guide := (v_result->>'guide_id')::uuid;
  if not exists(select 1 from public.dispatch_guide_lines where guide_id=v_guide and service_price_id=v_linear and unit_code='M' and quantity=10 and unit_price=22.12 and estimated_subtotal=221.2 and product_description='Corte lineal')
     or not exists(select 1 from public.dispatch_guide_lines where guide_id=v_guide and service_price_id=v_each and unit_code='UN' and unit_price=18.76)
     or not exists(select 1 from public.dispatch_guide_lines where guide_id=v_guide and service_price_id=v_empty and unit_code='UN' and unit_price=0) then
    raise exception 'QA_GUIDE_SUPPLIER_UNITS_FAILED';
  end if;
  raise notice 'PASS: real guide stores M and UN with exact price, quantity and description, never observations; products remain restricted';
end;
$$;
rollback;
