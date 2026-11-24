begin;

-- Keep role and assignment IDs for the administration history. Inactive roles
-- are rejected by the assignment RPC and ignored by project permissions.
with retired_roles as (
  update public.roles
  set active = false
  where scope = 'PROJECT' and active
    and code in ('FINAL_AUTHORIZER', 'SUPERVISOR')
  returning id, code
)
insert into public.audit_events (
  company_id, project_id, entity_type, entity_id, action, old_values, new_values
)
select membership.company_id, membership.project_id, 'project_member_role', assignment.id,
  'PROJECT_ROLE_RETIRED',
  jsonb_build_object('role_id', role.id, 'role_code', role.code, 'role_active', true),
  jsonb_build_object('role_id', role.id, 'role_code', role.code, 'role_active', false)
from retired_roles role
join public.project_member_roles assignment on assignment.role_id = role.id and assignment.revoked_at is null
join public.project_members membership on membership.id = assignment.project_member_id;

commit;
