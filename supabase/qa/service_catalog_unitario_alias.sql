-- DEV only: authenticated Excel-equivalent payloads and guide resolution; all rolled back.
begin;
do $$
declare
  v_actor uuid;
  v_company uuid;
  v_project uuid := gen_random_uuid();
  v_rows jsonb;
  v_result jsonb;
  v_product uuid;
  v_service uuid;
  v_ids jsonb;
  v_lines jsonb;
begin
  select a.user_id into strict v_actor from public.platform_admins a
  join public.profiles p on p.id=a.user_id where a.active and p.active order by a.user_id limit 1;
  select id into strict v_company from public.companies where status='ACTIVE' order by id limit 1;
  insert into public.projects(id,company_id,name,code,address,status)
  values(v_project,v_company,'Unitario alias QA',v_project::text,'QA only','ACTIVE');
  perform set_config('request.jwt.claim.sub',v_actor::text,true);
  v_rows := '[
    {"code":"SERV1010","description":"Recargo por suspensión de obra","unit_code":"Unitario","price":"1200.36"},
    {"code":"SERV1011","description":"Recargo por traslado de concreto","observations":"Carga mínima","unit_code":" unitario ","price":"200.2"},
    {"code":"SERV1018","description":"Recargo por suspensión de bomba en falso","unit_code":"UNITARIO","price":"724.36"},
    {"code":"SERV1019","description":"Recargo por suspensión de colocación en falso","unit_code":"Unitario","price":"724.36"}
  ]';
  execute 'set local role authenticated';
  v_result := public.platform_import_project_price_catalog(v_company,v_project,'SERVICE','UPDATE','qa-119.xlsx',v_rows);
  perform public.platform_import_project_price_catalog(v_company,v_project,'PRODUCT','UPDATE','qa-119.xlsx',
    '[{"code":"P","reference":"QA.119","price":"100"}]');
  execute 'reset role';
  if v_result->>'inserted_count'<>'4'
     or (select count(*) from public.project_service_prices where project_id=v_project and unit_code='UN')<>4
     or not exists(select 1 from public.project_service_prices where project_id=v_project and code='SERV1010' and price=1200.36)
     or not exists(select 1 from public.project_service_prices where project_id=v_project and code='SERV1011' and price=200.2 and observations='Carga mínima') then
    raise exception 'QA_UNITARIO_IMPORT_FAILED';
  end if;
  select jsonb_agg(to_jsonb(t)-'updated_at' order by id) into v_ids from public.project_service_prices t where project_id=v_project;
  execute 'set local role authenticated';
  v_result := public.platform_import_project_price_catalog(v_company,v_project,'SERVICE','UPDATE','qa-119.xlsx',v_rows);
  execute 'reset role';
  if v_result->>'updated_count'<>'4' or v_result->>'inserted_count'<>'0'
     or v_ids is distinct from (select jsonb_agg(to_jsonb(t)-'updated_at' order by id) from public.project_service_prices t where project_id=v_project) then
    raise exception 'QA_UNITARIO_IDENTITY_CHANGED';
  end if;
  select id into strict v_product from public.project_product_prices where project_id=v_project;
  select id into strict v_service from public.project_service_prices where project_id=v_project and code='SERV1010';
  v_lines := jsonb_build_array(
    jsonb_build_object('catalog_type','PRODUCT','catalog_item_id',v_product,'quantity',10,'unit_code','M3'),
    jsonb_build_object('catalog_type','SERVICE','catalog_item_id',v_service,'quantity',1,'unit_code','Unitario'));
  v_result := app_private.resolve_dispatch_guide_lines(v_project,'M3',v_lines);
  if v_result->1->>'unit_code'<>'UN' or (v_result->1->>'unit_price')::numeric<>1200.36 then
    raise exception 'QA_UNITARIO_GUIDE_FAILED';
  end if;
  begin
    perform app_private.resolve_dispatch_guide_lines(v_project,'M3',jsonb_set(v_lines,'{0,unit_code}','"Unitario"'));
    raise exception 'QA_UNITARIO_PRODUCT_ALLOWED';
  exception when raise_exception then if sqlerrm<>'INVALID_OR_INACTIVE_UNIT_OF_MEASURE' then raise; end if; end;
  raise notice 'PASS: Unitario imports and resolves as UN; IDs, descriptions, observations and prices preserved; products unchanged';
end;
$$;
rollback;
