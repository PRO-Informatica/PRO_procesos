begin;

create function public.add_dispatches_to_batch(
  p_batch_id uuid,
  p_dispatch_ids uuid[]
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_dispatch_id uuid;
  v_added integer := 0;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_dispatch_ids is null
    or cardinality(p_dispatch_ids) = 0
    or cardinality(p_dispatch_ids) > 200
    or array_position(p_dispatch_ids, null) is not null
  then
    raise exception 'DISPATCH_SELECTION_INVALID';
  end if;
  if (
    select count(distinct selected.id)
    from unnest(p_dispatch_ids) selected(id)
  ) <> cardinality(p_dispatch_ids) then
    raise exception 'DISPATCH_SELECTION_DUPLICATED';
  end if;

  foreach v_dispatch_id in array p_dispatch_ids loop
    perform public.add_dispatch_to_batch(p_batch_id, v_dispatch_id);
    v_added := v_added + 1;
  end loop;

  return v_added;
end;
$$;

comment on function public.add_dispatches_to_batch(uuid, uuid[]) is
  'Adds one or more eligible dispatches to a batch atomically, reusing add_dispatch_to_batch validations and auditing.';

alter function public.add_dispatches_to_batch(uuid, uuid[]) owner to postgres;
revoke all on function public.add_dispatches_to_batch(uuid, uuid[]) from public, anon;
grant execute on function public.add_dispatches_to_batch(uuid, uuid[]) to authenticated, service_role;

commit;
