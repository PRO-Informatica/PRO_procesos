-- Resolve the actual dispatch finalizer within the existing authorized report scope.
-- Preserve creator labels, fallback labels, function ownership and grants.
begin;

create or replace function public.get_report_actor_labels(p_project_ids uuid[])
returns table(profile_id uuid, display_label text)
language sql
stable
security definer
set search_path = pg_catalog, public, app_private, auth
as $$
  with actor_ids as (
    select programming.created_by profile_id
    from public.programming programming
    where programming.project_id = any(coalesce(p_project_ids, array[]::uuid[]))
      and app_private.has_project_permission(
        programming.project_id,
        'dispatch.view'
      )
    union
    select dispatch.created_by profile_id
    from public.dispatches dispatch
    where dispatch.project_id = any(coalesce(p_project_ids, array[]::uuid[]))
      and app_private.has_project_permission(
        dispatch.project_id,
        'dispatch.view'
      )
    union
    select dispatch.completed_by profile_id
    from public.dispatches dispatch
    where dispatch.project_id = any(coalesce(p_project_ids, array[]::uuid[]))
      and dispatch.status = 'COMPLETED'
      and dispatch.completed_by is not null
      and app_private.has_project_permission(
        dispatch.project_id,
        'dispatch.view'
      )
  )
  select actor.profile_id,
    coalesce(
      nullif(btrim(profile.full_name), ''),
      nullif(btrim(auth_user.email), ''),
      'Usuario no disponible'
    )
  from actor_ids actor
  left join public.profiles profile on profile.id = actor.profile_id
  left join auth.users auth_user on auth_user.id = actor.profile_id;
$$;

notify pgrst, 'reload schema';
commit;
