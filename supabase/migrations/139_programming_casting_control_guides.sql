-- Feature vision-ocr. Apply to DEV first; no operational records are removed.
begin;
alter table public.programming add column casting_element text
 check(casting_element in ('PILES','COLUMNS','PILES_AND_COLUMNS'));
alter table public.programming_revisions add column casting_element text
 check(casting_element in ('PILES','COLUMNS','PILES_AND_COLUMNS'));
alter table public.dispatch_guides drop constraint dispatch_guides_casting_element_check;
alter table public.dispatch_guides add constraint dispatch_guides_casting_element_check
 check(casting_element in ('PILES','COLUMNS','PILES_AND_COLUMNS'));
comment on column public.programming.casting_element is 'Casting element from approved workbook, used as an editable default on new guides.';
comment on column public.dispatch_guides.casting_element is 'Resident-reviewed PILES, COLUMNS or PILES_AND_COLUMNS; NULL on legacy guides.';

create function app_private.normalize_casting_element(value text) returns text
language sql immutable set search_path=pg_catalog as $$
 select case
 when upper(btrim(value)) in ('PILES','COLUMNS','PILES_AND_COLUMNS') then upper(btrim(value))
 when upper(value) ~ '\mPILOT(ES|E)?\M' and upper(value) ~ '\mCOLUMNAS?\M' then 'PILES_AND_COLUMNS'
 when upper(value) ~ '\mPILOT(ES|E)?\M' then 'PILES'
 when upper(value) ~ '\mCOLUMNAS?\M' then 'COLUMNS' end;
$$;
revoke all on function app_private.normalize_casting_element(text) from public,anon,authenticated,service_role;
-- Recover only the element explicitly recorded by the old Excel importer.
update public.programming set casting_element=app_private.normalize_casting_element(
 substring(notes from '(?im)^Elemento a fundir:[ \t]*([^\r\n]+)'))
 where app_private.normalize_casting_element(substring(notes from '(?im)^Elemento a fundir:[ \t]*([^\r\n]+)')) is not null;

create function pg_temp.patch_control_guide_function(signature text, needle text, replacement text, occurrences integer default 1) returns void
language plpgsql as $$
declare definition text:=pg_get_functiondef(signature::regprocedure);
begin
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>occurrences then
   raise exception 'CONTROL_GUIDE_PREREQUISITE_CHANGED: %',signature;
 end if;
 execute replace(definition,needle,replacement);
end;
$$;
select pg_temp.patch_control_guide_function('app_private.save_guide_resident(uuid,text,boolean)',
 '(''COLUMNS'',''PILES'')','(''COLUMNS'',''PILES'',''PILES_AND_COLUMNS'')');
select pg_temp.patch_control_guide_function('public.commit_vision_ocr_guide(uuid,integer,text)',
 '(''COLUMNS'',''PILES'')','(''COLUMNS'',''PILES'',''PILES_AND_COLUMNS'')');
select pg_temp.patch_control_guide_function('app_private.save_guide_details(uuid,jsonb)',
 '(''customerName'',''projectName''','(''documentType'',''customerName'',''projectName''');
select pg_temp.patch_control_guide_function('app_private.save_guide_details(uuid,jsonb)',
 ' select * into g from public.dispatch_guides',
 ' if coalesce(p_details->>''documentType'',''DISPATCH_GUIDE'') not in (''DISPATCH_GUIDE'',''MIXTO_OPERATION'',''PANEXUS_OPERATION'') then
   raise exception ''GUIDE_DETAILS_INVALID'';
 end if;
 select * into g from public.dispatch_guides');
select pg_temp.patch_control_guide_function('public.commit_vision_ocr_guide(uuid,integer,text)',
 '  payload:=capture.review_payload;',
 '  payload:=capture.review_payload;
  if coalesce(payload->''details''->>''documentType'',''DISPATCH_GUIDE'') not in (''DISPATCH_GUIDE'',''MIXTO_OPERATION'',''PANEXUS_OPERATION'') then
    raise exception ''GUIDE_DETAILS_INVALID'';
  end if;');

-- Preserve all RPC signatures. Creation through older/manual clients can still
-- obtain the default from the explicit notes line, without inferring other data.
select pg_temp.patch_control_guide_function('public.create_programming_with_details(uuid,uuid,timestamptz,jsonb,text,text,text[])',
 'requested_quantity, unit_code, status, notes, delivery_modes',
 'requested_quantity, unit_code, status, notes, delivery_modes, casting_element');
select pg_temp.patch_control_guide_function('public.create_programming_with_details(uuid,uuid,timestamptz,jsonb,text,text,text[])',
 'app_private.normalize_programming_delivery_modes(p_delivery_modes)
  ) returning id',
 'app_private.normalize_programming_delivery_modes(p_delivery_modes),
    coalesce(app_private.normalize_casting_element(nullif(current_setting(''app.programming_casting_element'',true),'''')),
      app_private.normalize_casting_element(substring(p_notes from ''(?im)^Elemento a fundir:[ \t]*([^\r\n]+)'')))
  ) returning id');
select pg_temp.patch_control_guide_function('app_private.snapshot_programming(uuid,uuid,text,text)',
 'unit_code, placement_group, requires_pumping', 'unit_code, casting_element, placement_group, requires_pumping');
select pg_temp.patch_control_guide_function('app_private.snapshot_programming(uuid,uuid,text,text)',
 'v_programming.confirmed_quantity, v_programming.unit_code,',
 'v_programming.confirmed_quantity, v_programming.unit_code, v_programming.casting_element,');
-- Carry the structured workbook value into creation before its immutable
-- snapshot. This transaction-local value carries metadata only; all existing
-- authentication and authorization checks remain in place.
select pg_temp.patch_control_guide_function('public.create_programming_batch(uuid,jsonb)',
 '    v_id := public.create_programming_with_details(',
 '    if nullif(v_item.value->>''casting_element'','''') is not null and v_item.value->>''casting_element'' not in (''PILES'',''COLUMNS'',''PILES_AND_COLUMNS'') then
      raise exception ''PROGRAMMING_CASTING_ELEMENT_INVALID'';
    end if;
    perform set_config(''app.programming_casting_element'',coalesce(v_item.value->>''casting_element'',''''),true);
    v_id := public.create_programming_with_details(');
select pg_temp.patch_control_guide_function('public.create_programming_batch(uuid,jsonb)',
 '    perform app_private.confirm_programming_core(',
 '    perform set_config(''app.programming_casting_element'','''',true);
    perform app_private.confirm_programming_core(');
notify pgrst,'reload schema';
commit;
