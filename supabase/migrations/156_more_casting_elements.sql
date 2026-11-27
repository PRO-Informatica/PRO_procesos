-- Adds casting elements: Losa, Gradas, Capiteles, Cisterna, Contrapiso, Base - relleno.
-- Only widens the accepted values; no existing records are changed.
begin;
alter table public.programming drop constraint programming_casting_element_check;
alter table public.programming add constraint programming_casting_element_check
 check(casting_element in ('PILES','COLUMNS','PILES_AND_COLUMNS','SLAB','STAIRS','CAPITALS','CISTERN','SUBFLOOR','BASE_FILL'));
alter table public.programming_revisions drop constraint programming_revisions_casting_element_check;
alter table public.programming_revisions add constraint programming_revisions_casting_element_check
 check(casting_element in ('PILES','COLUMNS','PILES_AND_COLUMNS','SLAB','STAIRS','CAPITALS','CISTERN','SUBFLOOR','BASE_FILL'));
alter table public.dispatch_guides drop constraint dispatch_guides_casting_element_check;
alter table public.dispatch_guides add constraint dispatch_guides_casting_element_check
 check(casting_element in ('PILES','COLUMNS','PILES_AND_COLUMNS','SLAB','STAIRS','CAPITALS','CISTERN','SUBFLOOR','BASE_FILL'));

create function pg_temp.patch_casting_function(signature text, needle text, replacement text) returns void
language plpgsql as $$
declare definition text:=pg_get_functiondef(signature::regprocedure);
begin
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then
   raise exception 'CASTING_ELEMENT_PREREQUISITE_CHANGED: %',signature;
 end if;
 execute replace(definition,needle,replacement);
end;
$$;
select pg_temp.patch_casting_function('app_private.normalize_casting_element(text)',
 'in (''PILES'',''COLUMNS'',''PILES_AND_COLUMNS'')',
 'in (''PILES'',''COLUMNS'',''PILES_AND_COLUMNS'',''SLAB'',''STAIRS'',''CAPITALS'',''CISTERN'',''SUBFLOOR'',''BASE_FILL'')');
select pg_temp.patch_casting_function('app_private.save_guide_resident(uuid,text,boolean)',
 'not in (''COLUMNS'',''PILES'',''PILES_AND_COLUMNS'')',
 'not in (''COLUMNS'',''PILES'',''PILES_AND_COLUMNS'',''SLAB'',''STAIRS'',''CAPITALS'',''CISTERN'',''SUBFLOOR'',''BASE_FILL'')');
select pg_temp.patch_casting_function('public.commit_vision_ocr_guide(uuid,integer,text)',
 'not in (''COLUMNS'',''PILES'',''PILES_AND_COLUMNS'')',
 'not in (''COLUMNS'',''PILES'',''PILES_AND_COLUMNS'',''SLAB'',''STAIRS'',''CAPITALS'',''CISTERN'',''SUBFLOOR'',''BASE_FILL'')');
select pg_temp.patch_casting_function('public.create_programming_batch(uuid,jsonb)',
 'not in (''PILES'',''COLUMNS'',''PILES_AND_COLUMNS'')',
 'not in (''PILES'',''COLUMNS'',''PILES_AND_COLUMNS'',''SLAB'',''STAIRS'',''CAPITALS'',''CISTERN'',''SUBFLOOR'',''BASE_FILL'')');
comment on column public.dispatch_guides.casting_element is 'Resident-reviewed casting element (PILES, COLUMNS, PILES_AND_COLUMNS, SLAB, STAIRS, CAPITALS, CISTERN, SUBFLOOR, BASE_FILL); NULL on legacy guides.';
notify pgrst,'reload schema';
commit;
