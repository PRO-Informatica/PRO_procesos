-- 044_platform_admin_user_access_management.sql
-- Registered after successful manual execution in Supabase.
-- Platform master administration for user profiles, memberships and roles.
-- Repository schema record; do not re-run against the already updated project.
-- Password operations remain in Supabase Auth Admin server-side code.
-- Validated read-only against the real Supabase schema on 2026-08-28.

begin;

do $$
begin
  if to_regprocedure('app_private.is_platform_admin()') is null then
    raise exception 'Missing required helper app_private.is_platform_admin()';
  end if;

  if to_regclass('public.profiles') is null
    or to_regclass('public.companies') is null
    or to_regclass('public.projects') is null
    or to_regclass('public.company_members') is null
    or to_regclass('public.company_member_roles') is null
    or to_regclass('public.project_members') is null
    or to_regclass('public.project_member_roles') is null
    or to_regclass('public.roles') is null
    or to_regclass('public.audit_events') is null then
    raise exception 'Missing one or more required platform administration tables';
  end if;

  if to_regtype('public.company_status') is null
    or to_regtype('public.project_status') is null
    or to_regtype('public.role_scope') is null then
    raise exception 'Missing one or more required platform administration enums';
  end if;

  if to_regclass('public.company_members_company_user_uq') is null
    or to_regclass('public.project_members_project_user_uq') is null
    or to_regclass('public.uq_active_company_member_role') is null
    or to_regclass('public.uq_active_project_member_role') is null then
    raise exception 'Missing one or more required membership/role unique indexes';
  end if;

  if exists (
    select 1
    from (
      values
        ('profiles', 'id'),
        ('profiles', 'full_name'),
        ('profiles', 'active'),
        ('profiles', 'updated_at'),
        ('companies', 'id'),
        ('companies', 'status'),
        ('projects', 'id'),
        ('projects', 'company_id'),
        ('projects', 'status'),
        ('company_members', 'id'),
        ('company_members', 'company_id'),
        ('company_members', 'user_id'),
        ('company_members', 'active'),
        ('company_members', 'created_by'),
        ('company_members', 'disabled_at'),
        ('company_members', 'disabled_by'),
        ('company_member_roles', 'id'),
        ('company_member_roles', 'company_member_id'),
        ('company_member_roles', 'role_id'),
        ('company_member_roles', 'role_scope'),
        ('company_member_roles', 'assigned_by'),
        ('company_member_roles', 'revoked_at'),
        ('company_member_roles', 'revoked_by'),
        ('project_members', 'id'),
        ('project_members', 'company_id'),
        ('project_members', 'project_id'),
        ('project_members', 'user_id'),
        ('project_members', 'active'),
        ('project_members', 'created_by'),
        ('project_members', 'disabled_at'),
        ('project_members', 'disabled_by'),
        ('project_member_roles', 'id'),
        ('project_member_roles', 'project_member_id'),
        ('project_member_roles', 'role_id'),
        ('project_member_roles', 'role_scope'),
        ('project_member_roles', 'assigned_by'),
        ('project_member_roles', 'revoked_at'),
        ('project_member_roles', 'revoked_by'),
        ('roles', 'id'),
        ('roles', 'code'),
        ('roles', 'scope'),
        ('roles', 'active'),
        ('audit_events', 'actor_user_id'),
        ('audit_events', 'company_id'),
        ('audit_events', 'project_id'),
        ('audit_events', 'entity_type'),
        ('audit_events', 'entity_id'),
        ('audit_events', 'action'),
        ('audit_events', 'old_values'),
        ('audit_events', 'new_values')
    ) as required_column(table_name, column_name)
    where not exists (
      select 1
      from information_schema.columns c
      where c.table_schema = 'public'
        and c.table_name = required_column.table_name
        and c.column_name = required_column.column_name
    )
  ) then
    raise exception 'Missing one or more required platform administration columns';
  end if;
end;
$$;

-- ============================================================
-- 1. UPDATE USER PROFILE
-- ============================================================

create or replace function public.platform_update_user_profile(
  p_user_id uuid,
  p_full_name text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := auth.uid();
  v_old_full_name text;
  v_full_name text := nullif(trim(p_full_name), '');
begin
  if not app_private.is_platform_admin() then
    raise exception 'PERMISSION_DENIED';
  end if;

  if v_full_name is null then
    raise exception 'FULL_NAME_REQUIRED';
  end if;

  if char_length(v_full_name) < 2 or char_length(v_full_name) > 160 then
    raise exception 'INVALID_FULL_NAME_LENGTH';
  end if;

  select p.full_name
  into v_old_full_name
  from public.profiles p
  where p.id = p_user_id
  for update;

  if not found then
    raise exception 'USER_NOT_FOUND';
  end if;

  if v_old_full_name is not distinct from v_full_name then
    return;
  end if;

  update public.profiles
  set
    full_name = v_full_name,
    updated_at = now()
  where id = p_user_id;

  insert into public.audit_events (
    actor_user_id,
    entity_type,
    entity_id,
    action,
    old_values,
    new_values
  )
  values (
    v_actor,
    'profile',
    p_user_id,
    'USER_PROFILE_UPDATED',
    jsonb_build_object('full_name', v_old_full_name),
    jsonb_build_object('full_name', v_full_name)
  );
end;
$$;

-- ============================================================
-- 2. CREATE / REACTIVATE / DISABLE COMPANY MEMBERSHIP
-- ============================================================

create or replace function public.platform_set_company_membership(
  p_company_id uuid,
  p_user_id uuid,
  p_active boolean
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := auth.uid();
  v_company_status text;
  v_membership_id uuid;
  v_current_active boolean;
  v_action text;
  v_revoked_company_roles integer := 0;
  v_revoked_project_roles integer := 0;
  v_disabled_projects integer := 0;
begin
  if not app_private.is_platform_admin() then
    raise exception 'PERMISSION_DENIED';
  end if;

  if p_active is null then
    raise exception 'MEMBERSHIP_STATE_REQUIRED';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'company_membership:' || p_company_id::text || ':' || p_user_id::text,
      0
    )
  );

  select c.status::text
  into v_company_status
  from public.companies c
  where c.id = p_company_id
  for share;

  if not found then
    raise exception 'COMPANY_NOT_FOUND';
  end if;

  if p_active and v_company_status <> 'ACTIVE' then
    raise exception 'COMPANY_NOT_ACTIVE';
  end if;

  select cm.id, cm.active
  into v_membership_id, v_current_active
  from public.company_members cm
  where cm.company_id = p_company_id
    and cm.user_id = p_user_id
  for update;

  if p_active then
    perform 1
    from public.profiles p
    where p.id = p_user_id
      and p.active = true
    for share;

    if not found then
      raise exception 'USER_NOT_ACTIVE';
    end if;

    if v_membership_id is null then
      begin
        insert into public.company_members (
          company_id,
          user_id,
          active,
          created_by
        )
        values (
          p_company_id,
          p_user_id,
          true,
          v_actor
        )
        returning id into v_membership_id;

        v_action := 'COMPANY_MEMBERSHIP_CREATED';
      exception
        when unique_violation then
          select cm.id, cm.active
          into v_membership_id, v_current_active
          from public.company_members cm
          where cm.company_id = p_company_id
            and cm.user_id = p_user_id
          for update;

          if not found then
            raise;
          end if;

          if v_current_active then
            return v_membership_id;
          end if;

          update public.company_members
          set
            active = true,
            disabled_at = null,
            disabled_by = null
          where id = v_membership_id;

          v_action := 'COMPANY_MEMBERSHIP_REACTIVATED';
      end;
    elsif v_current_active then
      return v_membership_id;
    else
      update public.company_members
      set
        active = true,
        disabled_at = null,
        disabled_by = null
      where id = v_membership_id;

      v_action := 'COMPANY_MEMBERSHIP_REACTIVATED';
    end if;

    insert into public.audit_events (
      actor_user_id,
      company_id,
      entity_type,
      entity_id,
      action,
      new_values
    )
    values (
      v_actor,
      p_company_id,
      'company_member',
      v_membership_id,
      v_action,
      jsonb_build_object(
        'target_user_id', p_user_id,
        'membership_id', v_membership_id,
        'active', true
      )
    );

    return v_membership_id;
  end if;

  if v_membership_id is null then
    raise exception 'COMPANY_MEMBERSHIP_NOT_FOUND';
  end if;

  if not v_current_active then
    return v_membership_id;
  end if;

  with changed as (
    update public.company_member_roles cmr
    set
      revoked_at = now(),
      revoked_by = v_actor
    where cmr.company_member_id = v_membership_id
      and cmr.revoked_at is null
    returning 1
  )
  select count(*)::integer into v_revoked_company_roles from changed;

  with changed as (
    update public.project_member_roles pmr
    set
      revoked_at = now(),
      revoked_by = v_actor
    where pmr.project_member_id in (
      select pm.id
      from public.project_members pm
      where pm.company_id = p_company_id
        and pm.user_id = p_user_id
        and pm.active = true
    )
      and pmr.revoked_at is null
    returning 1
  )
  select count(*)::integer into v_revoked_project_roles from changed;

  with changed as (
    update public.project_members pm
    set
      active = false,
      disabled_at = now(),
      disabled_by = v_actor
    where pm.company_id = p_company_id
      and pm.user_id = p_user_id
      and pm.active = true
    returning 1
  )
  select count(*)::integer into v_disabled_projects from changed;

  update public.company_members
  set
    active = false,
    disabled_at = now(),
    disabled_by = v_actor
  where id = v_membership_id;

  insert into public.audit_events (
    actor_user_id,
    company_id,
    entity_type,
    entity_id,
    action,
    old_values,
    new_values
  )
  values (
    v_actor,
    p_company_id,
    'company_member',
    v_membership_id,
    'COMPANY_MEMBERSHIP_DISABLED',
    jsonb_build_object('active', true),
    jsonb_build_object(
      'target_user_id', p_user_id,
      'membership_id', v_membership_id,
      'active', false,
      'revoked_company_roles', v_revoked_company_roles,
      'disabled_project_memberships', v_disabled_projects,
      'revoked_project_roles', v_revoked_project_roles
    )
  );

  return v_membership_id;
end;
$$;

-- ============================================================
-- 3. ASSIGN / REVOKE COMPANY ROLE
-- ============================================================

create or replace function public.platform_assign_company_role(
  p_company_member_id uuid,
  p_role_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := auth.uid();
  v_company_id uuid;
  v_user_id uuid;
  v_role_code text;
  v_assignment_id uuid;
begin
  if not app_private.is_platform_admin() then
    raise exception 'PERMISSION_DENIED';
  end if;

  select cm.company_id, cm.user_id
  into v_company_id, v_user_id
  from public.company_members cm
  join public.profiles p on p.id = cm.user_id
  join public.companies c on c.id = cm.company_id
  where cm.id = p_company_member_id
    and cm.active = true
    and p.active = true
    and c.status = 'ACTIVE'::public.company_status
  for share of c, p
  for update of cm;

  if not found then
    raise exception 'COMPANY_MEMBER_NOT_ACTIVE';
  end if;

  select r.code
  into v_role_code
  from public.roles r
  where r.id = p_role_id
    and r.scope = 'COMPANY'::public.role_scope
    and r.active = true
  for share;

  if not found then
    raise exception 'INVALID_COMPANY_ROLE';
  end if;

  select cmr.id
  into v_assignment_id
  from public.company_member_roles cmr
  where cmr.company_member_id = p_company_member_id
    and cmr.role_id = p_role_id
    and cmr.revoked_at is null;

  if found then
    return v_assignment_id;
  end if;

  begin
    insert into public.company_member_roles (
      company_member_id,
      role_id,
      role_scope,
      assigned_by
    )
    values (
      p_company_member_id,
      p_role_id,
      'COMPANY'::public.role_scope,
      v_actor
    )
    returning id into v_assignment_id;
  exception
    when unique_violation then
      select cmr.id
      into v_assignment_id
      from public.company_member_roles cmr
      where cmr.company_member_id = p_company_member_id
        and cmr.role_id = p_role_id
        and cmr.revoked_at is null;

      if not found then
        raise;
      end if;

      return v_assignment_id;
  end;

  insert into public.audit_events (
    actor_user_id,
    company_id,
    entity_type,
    entity_id,
    action,
    new_values
  )
  values (
    v_actor,
    v_company_id,
    'company_member_role',
    v_assignment_id,
    'COMPANY_ROLE_ASSIGNED',
    jsonb_build_object(
      'target_user_id', v_user_id,
      'membership_id', p_company_member_id,
      'role_id', p_role_id,
      'role_code', v_role_code,
      'assigned_by_platform_admin', true
    )
  );

  return v_assignment_id;
end;
$$;

create or replace function public.platform_revoke_company_role(
  p_assignment_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := auth.uid();
  v_company_id uuid;
  v_company_member_id uuid;
  v_user_id uuid;
  v_role_id uuid;
  v_role_code text;
  v_revoked_at timestamptz;
begin
  if not app_private.is_platform_admin() then
    raise exception 'PERMISSION_DENIED';
  end if;

  select cm.company_id, cm.id, cm.user_id, cmr.role_id, r.code, cmr.revoked_at
  into v_company_id, v_company_member_id, v_user_id, v_role_id, v_role_code, v_revoked_at
  from public.company_member_roles cmr
  join public.company_members cm on cm.id = cmr.company_member_id
  join public.roles r on r.id = cmr.role_id
  where cmr.id = p_assignment_id
  for update of cmr;

  if not found then
    raise exception 'ROLE_ASSIGNMENT_NOT_FOUND';
  end if;

  if v_revoked_at is not null then
    return;
  end if;

  update public.company_member_roles
  set
    revoked_at = now(),
    revoked_by = v_actor
  where id = p_assignment_id;

  insert into public.audit_events (
    actor_user_id,
    company_id,
    entity_type,
    entity_id,
    action,
    old_values,
    new_values
  )
  values (
    v_actor,
    v_company_id,
    'company_member_role',
    p_assignment_id,
    'COMPANY_ROLE_REVOKED',
    jsonb_build_object(
      'target_user_id', v_user_id,
      'membership_id', v_company_member_id,
      'role_id', v_role_id,
      'role_code', v_role_code
    ),
    jsonb_build_object(
      'revoked', true,
      'revoked_by_platform_admin', true
    )
  );
end;
$$;

-- ============================================================
-- 4. CREATE / REACTIVATE / DISABLE PROJECT MEMBERSHIP
-- ============================================================

create or replace function public.platform_set_project_membership(
  p_company_id uuid,
  p_project_id uuid,
  p_user_id uuid,
  p_active boolean
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := auth.uid();
  v_project_company_id uuid;
  v_project_status text;
  v_company_status text;
  v_company_membership_id uuid;
  v_company_membership_active boolean;
  v_project_membership_id uuid;
  v_project_membership_active boolean;
  v_action text;
  v_company_action text;
  v_revoked_roles integer := 0;
begin
  if not app_private.is_platform_admin() then
    raise exception 'PERMISSION_DENIED';
  end if;

  if p_active is null then
    raise exception 'MEMBERSHIP_STATE_REQUIRED';
  end if;

  -- The company lock is always acquired before the project lock.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'company_membership:' || p_company_id::text || ':' || p_user_id::text,
      0
    )
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'project_membership:' || p_project_id::text || ':' || p_user_id::text,
      0
    )
  );

  select p.company_id, p.status::text, c.status::text
  into v_project_company_id, v_project_status, v_company_status
  from public.projects p
  join public.companies c on c.id = p.company_id
  where p.id = p_project_id
  for share of c, p;

  if not found then
    raise exception 'PROJECT_NOT_FOUND';
  end if;

  if v_project_company_id is distinct from p_company_id then
    raise exception 'PROJECT_COMPANY_MISMATCH';
  end if;

  if p_active then
    if v_company_status <> 'ACTIVE' then
      raise exception 'COMPANY_NOT_ACTIVE';
    end if;

    if v_project_status <> 'ACTIVE' then
      raise exception 'PROJECT_NOT_ACTIVE';
    end if;

    perform 1
    from public.profiles p
    where p.id = p_user_id
      and p.active = true
    for share;

    if not found then
      raise exception 'USER_NOT_ACTIVE';
    end if;

    select cm.id, cm.active
    into v_company_membership_id, v_company_membership_active
    from public.company_members cm
    where cm.company_id = p_company_id
      and cm.user_id = p_user_id
    for update;

    if v_company_membership_id is null then
      begin
        insert into public.company_members (
          company_id,
          user_id,
          active,
          created_by
        )
        values (
          p_company_id,
          p_user_id,
          true,
          v_actor
        )
        returning id into v_company_membership_id;

        v_company_action := 'COMPANY_MEMBERSHIP_CREATED';
      exception
        when unique_violation then
          select cm.id, cm.active
          into v_company_membership_id, v_company_membership_active
          from public.company_members cm
          where cm.company_id = p_company_id
            and cm.user_id = p_user_id
          for update;

          if not found then
            raise;
          end if;

          if not v_company_membership_active then
            update public.company_members
            set
              active = true,
              disabled_at = null,
              disabled_by = null
            where id = v_company_membership_id;

            v_company_action := 'COMPANY_MEMBERSHIP_REACTIVATED';
          end if;
      end;
    elsif not v_company_membership_active then
      update public.company_members
      set
        active = true,
        disabled_at = null,
        disabled_by = null
      where id = v_company_membership_id;

      v_company_action := 'COMPANY_MEMBERSHIP_REACTIVATED';
    end if;

    select pm.id, pm.active
    into v_project_membership_id, v_project_membership_active
    from public.project_members pm
    where pm.project_id = p_project_id
      and pm.user_id = p_user_id
    for update;

    if v_company_action is not null then
      insert into public.audit_events (
        actor_user_id,
        company_id,
        entity_type,
        entity_id,
        action,
        new_values
      )
      values (
        v_actor,
        p_company_id,
        'company_member',
        v_company_membership_id,
        v_company_action,
        jsonb_build_object(
          'target_user_id', p_user_id,
          'membership_id', v_company_membership_id,
          'active', true,
          'source', 'PROJECT_ASSIGNMENT'
        )
      );
    end if;

    if v_project_membership_id is null then
      begin
        insert into public.project_members (
          company_id,
          project_id,
          user_id,
          active,
          created_by
        )
        values (
          p_company_id,
          p_project_id,
          p_user_id,
          true,
          v_actor
        )
        returning id into v_project_membership_id;

        v_action := 'PROJECT_MEMBERSHIP_CREATED';
      exception
        when unique_violation then
          select pm.id, pm.active
          into v_project_membership_id, v_project_membership_active
          from public.project_members pm
          where pm.project_id = p_project_id
            and pm.user_id = p_user_id
          for update;

          if not found then
            raise;
          end if;

          if v_project_membership_active then
            return v_project_membership_id;
          end if;

          update public.project_members
          set
            active = true,
            disabled_at = null,
            disabled_by = null
          where id = v_project_membership_id;

          v_action := 'PROJECT_MEMBERSHIP_REACTIVATED';
      end;
    elsif v_project_membership_active then
      return v_project_membership_id;
    else
      update public.project_members
      set
        active = true,
        disabled_at = null,
        disabled_by = null
      where id = v_project_membership_id;

      v_action := 'PROJECT_MEMBERSHIP_REACTIVATED';
    end if;

    insert into public.audit_events (
      actor_user_id,
      company_id,
      project_id,
      entity_type,
      entity_id,
      action,
      new_values
    )
    values (
      v_actor,
      p_company_id,
      p_project_id,
      'project_member',
      v_project_membership_id,
      v_action,
      jsonb_build_object(
        'target_user_id', p_user_id,
        'membership_id', v_project_membership_id,
        'active', true
      )
    );

    return v_project_membership_id;
  end if;

  select pm.id, pm.active
  into v_project_membership_id, v_project_membership_active
  from public.project_members pm
  where pm.project_id = p_project_id
    and pm.user_id = p_user_id
  for update;

  if v_project_membership_id is null then
    raise exception 'PROJECT_MEMBERSHIP_NOT_FOUND';
  end if;

  if not v_project_membership_active then
    return v_project_membership_id;
  end if;

  with changed as (
    update public.project_member_roles pmr
    set
      revoked_at = now(),
      revoked_by = v_actor
    where pmr.project_member_id = v_project_membership_id
      and pmr.revoked_at is null
    returning 1
  )
  select count(*)::integer into v_revoked_roles from changed;

  update public.project_members
  set
    active = false,
    disabled_at = now(),
    disabled_by = v_actor
  where id = v_project_membership_id;

  insert into public.audit_events (
    actor_user_id,
    company_id,
    project_id,
    entity_type,
    entity_id,
    action,
    old_values,
    new_values
  )
  values (
    v_actor,
    p_company_id,
    p_project_id,
    'project_member',
    v_project_membership_id,
    'PROJECT_MEMBERSHIP_DISABLED',
    jsonb_build_object('active', true),
    jsonb_build_object(
      'target_user_id', p_user_id,
      'membership_id', v_project_membership_id,
      'active', false,
      'revoked_project_roles', v_revoked_roles
    )
  );

  return v_project_membership_id;
end;
$$;

-- ============================================================
-- 5. ASSIGN / REVOKE PROJECT ROLE
-- ============================================================

create or replace function public.platform_assign_project_role(
  p_project_member_id uuid,
  p_role_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := auth.uid();
  v_company_id uuid;
  v_project_id uuid;
  v_user_id uuid;
  v_role_code text;
  v_assignment_id uuid;
begin
  if not app_private.is_platform_admin() then
    raise exception 'PERMISSION_DENIED';
  end if;

  select pm.company_id, pm.project_id, pm.user_id
  into v_company_id, v_project_id, v_user_id
  from public.project_members pm
  where pm.id = p_project_member_id;

  if not found then
    raise exception 'PROJECT_MEMBER_NOT_FOUND';
  end if;

  -- Match the lock order used by membership administration.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'company_membership:' || v_company_id::text || ':' || v_user_id::text,
      0
    )
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'project_membership:' || v_project_id::text || ':' || v_user_id::text,
      0
    )
  );

  perform 1
  from public.company_members cm
  join public.profiles p on p.id = cm.user_id
  join public.companies c on c.id = cm.company_id
  where cm.company_id = v_company_id
    and cm.user_id = v_user_id
    and cm.active = true
    and p.active = true
    and c.status = 'ACTIVE'::public.company_status
  for share of c, p
  for update of cm;

  if not found then
    raise exception 'COMPANY_MEMBER_NOT_ACTIVE';
  end if;

  select pm.company_id, pm.project_id, pm.user_id
  into v_company_id, v_project_id, v_user_id
  from public.project_members pm
  join public.projects pr on pr.id = pm.project_id
  where pm.id = p_project_member_id
    and pm.active = true
    and pr.company_id = v_company_id
    and pr.status = 'ACTIVE'::public.project_status
  for share of pr
  for update of pm;

  if not found then
    raise exception 'PROJECT_MEMBER_NOT_ACTIVE';
  end if;

  select r.code
  into v_role_code
  from public.roles r
  where r.id = p_role_id
    and r.scope = 'PROJECT'::public.role_scope
    and r.active = true
  for share;

  if not found then
    raise exception 'INVALID_PROJECT_ROLE';
  end if;

  select pmr.id
  into v_assignment_id
  from public.project_member_roles pmr
  where pmr.project_member_id = p_project_member_id
    and pmr.role_id = p_role_id
    and pmr.revoked_at is null;

  if found then
    return v_assignment_id;
  end if;

  begin
    insert into public.project_member_roles (
      project_member_id,
      role_id,
      role_scope,
      assigned_by
    )
    values (
      p_project_member_id,
      p_role_id,
      'PROJECT'::public.role_scope,
      v_actor
    )
    returning id into v_assignment_id;
  exception
    when unique_violation then
      select pmr.id
      into v_assignment_id
      from public.project_member_roles pmr
      where pmr.project_member_id = p_project_member_id
        and pmr.role_id = p_role_id
        and pmr.revoked_at is null;

      if not found then
        raise;
      end if;

      return v_assignment_id;
  end;

  insert into public.audit_events (
    actor_user_id,
    company_id,
    project_id,
    entity_type,
    entity_id,
    action,
    new_values
  )
  values (
    v_actor,
    v_company_id,
    v_project_id,
    'project_member_role',
    v_assignment_id,
    'PROJECT_ROLE_ASSIGNED',
    jsonb_build_object(
      'target_user_id', v_user_id,
      'membership_id', p_project_member_id,
      'role_id', p_role_id,
      'role_code', v_role_code,
      'assigned_by_platform_admin', true
    )
  );

  return v_assignment_id;
end;
$$;

create or replace function public.platform_revoke_project_role(
  p_assignment_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := auth.uid();
  v_company_id uuid;
  v_project_id uuid;
  v_project_member_id uuid;
  v_user_id uuid;
  v_role_id uuid;
  v_role_code text;
  v_revoked_at timestamptz;
begin
  if not app_private.is_platform_admin() then
    raise exception 'PERMISSION_DENIED';
  end if;

  select pm.company_id, pm.project_id, pm.id, pm.user_id, pmr.role_id, r.code, pmr.revoked_at
  into v_company_id, v_project_id, v_project_member_id, v_user_id, v_role_id, v_role_code, v_revoked_at
  from public.project_member_roles pmr
  join public.project_members pm on pm.id = pmr.project_member_id
  join public.roles r on r.id = pmr.role_id
  where pmr.id = p_assignment_id
  for update of pmr;

  if not found then
    raise exception 'ROLE_ASSIGNMENT_NOT_FOUND';
  end if;

  if v_revoked_at is not null then
    return;
  end if;

  update public.project_member_roles
  set
    revoked_at = now(),
    revoked_by = v_actor
  where id = p_assignment_id;

  insert into public.audit_events (
    actor_user_id,
    company_id,
    project_id,
    entity_type,
    entity_id,
    action,
    old_values,
    new_values
  )
  values (
    v_actor,
    v_company_id,
    v_project_id,
    'project_member_role',
    p_assignment_id,
    'PROJECT_ROLE_REVOKED',
    jsonb_build_object(
      'target_user_id', v_user_id,
      'membership_id', v_project_member_id,
      'role_id', v_role_id,
      'role_code', v_role_code
    ),
    jsonb_build_object(
      'revoked', true,
      'revoked_by_platform_admin', true
    )
  );
end;
$$;

-- ============================================================
-- 6. OWNERSHIP AND EXECUTION GRANTS
-- ============================================================

alter function public.platform_update_user_profile(uuid, text) owner to postgres;
alter function public.platform_set_company_membership(uuid, uuid, boolean) owner to postgres;
alter function public.platform_assign_company_role(uuid, uuid) owner to postgres;
alter function public.platform_revoke_company_role(uuid) owner to postgres;
alter function public.platform_set_project_membership(uuid, uuid, uuid, boolean) owner to postgres;
alter function public.platform_assign_project_role(uuid, uuid) owner to postgres;
alter function public.platform_revoke_project_role(uuid) owner to postgres;

revoke all on function public.platform_update_user_profile(uuid, text) from public, anon, authenticated;
revoke all on function public.platform_set_company_membership(uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function public.platform_assign_company_role(uuid, uuid) from public, anon, authenticated;
revoke all on function public.platform_revoke_company_role(uuid) from public, anon, authenticated;
revoke all on function public.platform_set_project_membership(uuid, uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function public.platform_assign_project_role(uuid, uuid) from public, anon, authenticated;
revoke all on function public.platform_revoke_project_role(uuid) from public, anon, authenticated;

grant execute on function public.platform_update_user_profile(uuid, text) to authenticated;
grant execute on function public.platform_set_company_membership(uuid, uuid, boolean) to authenticated;
grant execute on function public.platform_assign_company_role(uuid, uuid) to authenticated;
grant execute on function public.platform_revoke_company_role(uuid) to authenticated;
grant execute on function public.platform_set_project_membership(uuid, uuid, uuid, boolean) to authenticated;
grant execute on function public.platform_assign_project_role(uuid, uuid) to authenticated;
grant execute on function public.platform_revoke_project_role(uuid) to authenticated;

commit;
