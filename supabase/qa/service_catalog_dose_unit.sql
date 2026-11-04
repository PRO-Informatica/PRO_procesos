-- DEV QA for 113. Real authenticated import/guide RPCs; all writes roll back.
begin;

do $$
declare
  v_dispatch public.dispatches%rowtype;
  v_actor uuid;
  v_company uuid;
  v_unit text;
  v_prefix text := 'QA-113-' || gen_random_uuid()::text;
  v_product uuid;
  v_dose uuid;
  v_second_dose uuid;
  v_tube uuid;
  v_guide uuid;
  v_result jsonb;
  v_rows jsonb;
  v_lines jsonb;
begin
  select dispatch.* into strict v_dispatch from public.dispatches dispatch
  join public.projects project on project.id=dispatch.project_id and project.status='ACTIVE'
  join public.companies company on company.id=project.company_id and company.status='ACTIVE'
  join public.platform_admins admin on admin.user_id=dispatch.created_by and admin.active
  where dispatch.status='IN_EXECUTION' order by dispatch.created_at desc limit 1;
  v_actor := v_dispatch.created_by;
  select project.company_id, programming.unit_code into v_company,v_unit
  from public.projects project join public.programming programming on programming.project_id=project.id
  where programming.id=v_dispatch.programming_id;
  perform set_config('request.jwt.claim.sub',v_actor::text,true);

  if app_private.normalize_service_catalog_unit(' dosis / m³ ') <> 'DOSIS/M3'
     or app_private.normalize_service_catalog_unit('Unidad') <> 'UN'
     or app_private.normalize_service_catalog_unit('dosis/m3') = 'M3'
     or app_private.normalize_service_catalog_unit('LITROS') is not null
     or app_private.normalize_service_catalog_unit(null) is not null then
    raise exception 'QA_SERVICE_UNIT_NORMALIZATION_FAILED';
  end if;
  v_rows := jsonb_build_array(
    jsonb_build_object('code',v_prefix||'-1','description','Dosis extra de retardante','unit_code','dosis/m3','price','10.92'),
    jsonb_build_object('code',v_prefix||'-2','description','Dosis para mantener trabajabilidad','unit_code','dosis/m³','price','95.20'),
    jsonb_build_object('code',v_prefix||'-3','description','Tubo adicional','unit_code','Unidad','price','12.60')
  );
  execute 'set local role authenticated';
  perform public.platform_import_project_price_catalog(v_company,v_dispatch.project_id,'SERVICE','UPDATE','qa-113.xlsx',v_rows);
  perform public.platform_import_project_price_catalog(v_company,v_dispatch.project_id,'PRODUCT','UPDATE','qa-113.xlsx',
    jsonb_build_array(jsonb_build_object('code',v_prefix,'reference','QA.113','price','100')));
  execute 'reset role';
  select id into strict v_product from public.project_product_prices where project_id=v_dispatch.project_id and code=v_prefix;
  select id into strict v_dose from public.project_service_prices where project_id=v_dispatch.project_id and code=v_prefix||'-1' and unit_code='DOSIS/M3' and price=10.92;
  select id into strict v_second_dose from public.project_service_prices where project_id=v_dispatch.project_id and code=v_prefix||'-2' and unit_code='DOSIS/M3' and price=95.20;
  select id into strict v_tube from public.project_service_prices where project_id=v_dispatch.project_id and code=v_prefix||'-3' and unit_code='UN' and price=12.60;
  raise notice 'PASS: server imports dosis/m3, dosis/m³ and Unidad with exact unchanged prices';

  v_lines := jsonb_build_array(
    jsonb_build_object('catalog_type','PRODUCT','catalog_item_id',v_product,'quantity',10,'unit_code',v_unit),
    jsonb_build_object('catalog_type','SERVICE','catalog_item_id',v_dose,'quantity',2,'unit_code',' dosis / m³ '),
    jsonb_build_object('catalog_type','SERVICE','catalog_item_id',v_second_dose,'quantity',3,'unit_code','DOSIS/M3'),
    jsonb_build_object('catalog_type','SERVICE','catalog_item_id',v_tube,'quantity',1,'unit_code','Unidad')
  );
  execute 'set local role authenticated';
  v_result := public.create_dispatch_guide_with_lines(v_dispatch.id,v_dispatch.version,v_prefix,current_date,v_lines);
  execute 'reset role';
  v_guide := (v_result->>'guide_id')::uuid;
  if (select quantity from public.dispatch_guides where id=v_guide) <> 10
     or (select count(*) from public.dispatch_guide_lines where guide_id=v_guide and unit_code='DOSIS/M3') <> 2
     or (select sum(estimated_subtotal) from public.dispatch_guide_lines where guide_id=v_guide and catalog_type='SERVICE') <> 320.04
     or not exists(select 1 from public.dispatch_guide_lines where guide_id=v_guide and service_price_id=v_dose and product_description='Dosis extra de retardante' and unit_code='DOSIS/M3' and unit_price=10.92 and estimated_subtotal=21.84)
     or not exists(select 1 from public.dispatch_guide_lines where guide_id=v_guide and service_price_id=v_tube and unit_code='UN' and estimated_subtotal=12.60) then
    raise exception 'QA_DOSE_GUIDE_SNAPSHOT_OR_TOTAL_FAILED';
  end if;
  raise notice 'PASS: guides keep DOSIS/M3 distinct from M3, default descriptions and isolate physical product volume';

  select version into v_dispatch.version from public.dispatches where id=v_dispatch.id;
  execute 'set local role authenticated';
  begin
    perform public.create_dispatch_guide_with_lines(v_dispatch.id,v_dispatch.version,v_prefix||'-bad-product',current_date,
      jsonb_set(v_lines,'{0,unit_code}','"DOSIS/M3"'::jsonb));
    raise exception 'QA_PRODUCT_DOSE_UNIT_ALLOWED';
  exception when raise_exception then if sqlerrm <> 'INVALID_OR_INACTIVE_UNIT_OF_MEASURE' then raise; end if; end;
  begin
    perform public.create_dispatch_guide_with_lines(v_dispatch.id,v_dispatch.version,v_prefix||'-bad-service',current_date,
      jsonb_set(v_lines,'{1,unit_code}','"M3"'::jsonb));
    raise exception 'QA_DOSE_CONVERTED_TO_M3';
  exception when raise_exception then if sqlerrm <> 'DISPATCH_SERVICE_UNIT_MISMATCH' then raise; end if; end;
  execute 'reset role';
  raise notice 'PASS: product lines reject DOSIS/M3, and services cannot substitute M3 for DOSIS/M3';
end;
$$;

rollback;
