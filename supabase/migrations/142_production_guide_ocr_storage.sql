-- Production captures use a separate private staging bucket. Existing files stay intact.
begin;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('vision-ocr-prod','vision-ocr-prod',false,10485760,array['image/jpeg','image/png','image/webp'])
on conflict(id) do nothing;
do $$ begin
 if not exists(select 1 from storage.buckets where id='vision-ocr-prod' and not public
   and file_size_limit=10485760 and allowed_mime_types @> array['image/jpeg','image/png','image/webp']) then
   raise exception 'PRODUCTION_OCR_BUCKET_CONFIGURATION_MISMATCH';
 end if;
end $$;
-- Only the service client can stage/read originals. The reviewed capture flow
-- supplies signed upload tokens and checks user, project and dispatch permissions.
notify pgrst,'reload schema';
commit;
