-- Follow-up from the DEV OCR edit regression: an unpriced product has no
-- catalog_reference yet. Keep its transcribed description on quantity edits.
begin;
do $$
declare
  definition text:=pg_get_functiondef('app_private.resolve_dispatch_guide_lines(uuid,text,jsonb,uuid)'::regprocedure);
  needle text:='''product_description'', v_existing.catalog_reference,';
  replacement text:='''product_description'', coalesce(v_existing.catalog_reference, v_existing.product_description),';
begin
  if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then
    raise exception 'OCR_RESOLVER_PREREQUISITE_CHANGED';
  end if;
  execute replace(definition,needle,replacement);
end;
$$;
notify pgrst,'reload schema';
commit;
