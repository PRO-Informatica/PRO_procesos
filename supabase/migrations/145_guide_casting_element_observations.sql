-- Optional resident notes use the existing guide details JSON; no historical data is changed.
begin;
do $$
declare
 definition text:=pg_get_functiondef('app_private.save_guide_details(uuid,jsonb)'::regprocedure);
 fields_needle text:='''operator'',''observations'')';
 limit_needle text:='case when item.key=''observations'' then 4000 else 500 end';
begin
 if (length(definition)-length(replace(definition,fields_needle,'')))/length(fields_needle)<>1
   or (length(definition)-length(replace(definition,limit_needle,'')))/length(limit_needle)<>1 then
   raise exception 'GUIDE_CASTING_OBSERVATIONS_PREREQUISITE_CHANGED';
 end if;
 definition:=replace(definition,fields_needle,'''operator'',''observations'',''castingElementObservations'')');
 definition:=replace(definition,limit_needle,
   'case when item.key in (''observations'',''castingElementObservations'') then 4000 else 500 end');
 -- Keep the existing project permission, audit and atomic save checks intact.
 execute definition;
end;
$$;
notify pgrst,'reload schema';
commit;
