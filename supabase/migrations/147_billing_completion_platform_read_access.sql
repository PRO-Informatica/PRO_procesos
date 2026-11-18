begin;

-- Match the existing platform-administrator SELECT policies without granting
-- operational permissions or changing the financial completion calculation.
create or replace function public.get_dispatch_billing_completion(p_project_ids uuid[])
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, app_private
as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_project_ids is null or cardinality(p_project_ids)>1000
    or array_position(p_project_ids,null) is not null then raise exception 'PROJECT_IDS_INVALID'; end if;
  if not app_private.is_platform_admin() and exists (
    select 1 from unnest(p_project_ids) project_id where not (
      app_private.has_project_permission(project_id,'batch.view')
      or app_private.has_project_permission(project_id,'dispatch.view')
      or app_private.has_project_permission(project_id,'programming.view')
    )
  ) then raise exception 'PERMISSION_DENIED'; end if;
  return coalesce((select jsonb_object_agg(d.id::text,app_private.dispatch_billing_complete(d.id))
    from public.dispatches d where d.project_id=any(p_project_ids)), '{}'::jsonb);
end;
$$;

alter function public.get_dispatch_billing_completion(uuid[]) owner to postgres;
revoke all on function public.get_dispatch_billing_completion(uuid[]) from public,anon;
grant execute on function public.get_dispatch_billing_completion(uuid[]) to authenticated,service_role;

notify pgrst, 'reload schema';
commit;
