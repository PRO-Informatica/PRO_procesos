begin;

create or replace function app_private.guard_programming_future_schedule()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_timezone text;
  v_today date;
  v_scheduled_date date;
  v_edit_source text := current_setting('app.programming_edit_source', true);
  v_confirmation_source text := current_setting('app.programming_confirmation_source', true);
begin
  if new.scheduled_at is null or not isfinite(new.scheduled_at) then
    raise exception 'PROGRAMMING_SCHEDULE_REQUIRED';
  end if;

  select coalesce(nullif(btrim(project.timezone), ''), 'America/Guatemala')
  into v_timezone
  from public.projects project
  where project.id = new.project_id;

  if not found then raise exception 'PROJECT_NOT_FOUND'; end if;

  -- Both creation flows accept historical dates. Changes to existing dates
  -- still follow the authorized editing and legacy pending-confirmation rules.
  if tg_op = 'UPDATE' and new.scheduled_at is distinct from old.scheduled_at then
    v_today := (clock_timestamp() at time zone v_timezone)::date;
    v_scheduled_date := (new.scheduled_at at time zone v_timezone)::date;

    if v_scheduled_date < v_today
       and v_confirmation_source is distinct from 'APPROVED_MIXTO_WORKBOOK'
       and v_edit_source is distinct from 'AUTHORIZED_EDIT' then
      raise exception 'PROGRAMMING_SCHEDULE_DATE_IN_PAST';
    end if;

    if old.status = 'PENDING_CONFIRMATION'
       and v_edit_source is distinct from 'AUTHORIZED_EDIT'
       and (old.scheduled_at at time zone v_timezone)::date <= v_today then
      raise exception 'PROGRAMMING_EDIT_WINDOW_CLOSED';
    end if;
  end if;

  return new;
end;
$$;

commit;
