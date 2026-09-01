-- One-time cleanup for the reversible QA_ORDER45 / QA_FLOW_ORDER45 scenario.
-- This is a QA utility, not a migration.

begin;

set local session_replication_role = replica;

do $$
declare
  v_programming_ids uuid[] := array[
    'e72f471f-99f3-4211-a829-905063c0eef2'::uuid
  ];
  v_dispatch_ids uuid[] := array[
    'aea1f3da-1ecd-49c1-a62a-998754d67002'::uuid,
    '7c59a85c-80c3-4fa3-aa78-e96767c37411'::uuid,
    '605b761c-a1cd-4c09-a7ed-5939ea485b00'::uuid,
    '2157ac10-4fe7-4f90-b094-bb64a9b09725'::uuid,
    '40306c33-6bd3-4c8e-b0e5-d403eb8cb0b2'::uuid
  ];
  v_guide_ids uuid[] := array[
    '2a7fff35-dcd7-4609-baf4-1b10094a8fc2'::uuid,
    'e7b534d3-c11a-43d7-b2b5-1d1800cb2fc6'::uuid,
    'df4cc5e0-f5c5-4a16-bc29-24a26bcb2dd0'::uuid,
    '640192ad-3498-4d12-a321-3cda5b60c3ec'::uuid,
    '9f745e9b-10aa-4cb8-ab30-2777157f3c30'::uuid
  ];
  v_user_ids uuid[] := array[
    'f49c141d-0133-403a-9774-bf83460a7381'::uuid,
    '9e1a14a5-a24d-499f-9a39-6fb624ca9eb7'::uuid,
    'd6f40818-3845-4ae2-8fe1-77037d2c7bfd'::uuid,
    '97aaba4d-c7fa-4f70-ac74-313af4e61172'::uuid,
    '4bba4b13-dc93-4341-8af9-b101f5d7ad0f'::uuid
  ];
begin
  delete from public.dispatch_guide_revision_lines
  where revision_id in (
    select id from public.dispatch_guide_revisions
    where dispatch_id = any(v_dispatch_ids)
       or guide_id = any(v_guide_ids)
  );

  delete from public.dispatch_guide_revisions
  where dispatch_id = any(v_dispatch_ids)
     or guide_id = any(v_guide_ids);

  delete from public.dispatch_guide_lines
  where guide_id = any(v_guide_ids);
  delete from public.dispatch_guides where id = any(v_guide_ids);
  delete from public.dispatches where id = any(v_dispatch_ids);

  delete from public.programming_revision_lines
  where programming_id = any(v_programming_ids);
  delete from public.programming_revisions
  where programming_id = any(v_programming_ids);
  delete from public.programming_lines
  where programming_id = any(v_programming_ids);
  delete from public.programming
  where id = any(v_programming_ids);

  delete from public.audit_events
  where actor_user_id = any(v_user_ids)
     or entity_id = any(v_programming_ids)
     or entity_id = any(v_dispatch_ids)
     or entity_id = any(v_guide_ids);

  delete from public.project_member_roles
  where project_member_id in (
    select id from public.project_members where user_id = any(v_user_ids)
  );
  delete from public.project_members where user_id = any(v_user_ids);

  delete from public.company_member_roles
  where company_member_id in (
    select id from public.company_members where user_id = any(v_user_ids)
  );
  delete from public.company_members where user_id = any(v_user_ids);

  delete from public.profiles where id = any(v_user_ids);
  delete from auth.users where id = any(v_user_ids);

  if exists (
    select 1 from public.programming
    where id = any(v_programming_ids) or notes = 'QA_ORDER45_PROGRAMMING'
  ) or exists (
    select 1 from public.dispatches where id = any(v_dispatch_ids)
  ) or exists (
    select 1 from public.dispatch_guides
    where id = any(v_guide_ids) or guide_number like 'QA_ORDER45_%'
       or guide_number like 'QA_ORDER46_%'
  ) or exists (
    select 1 from auth.users where id = any(v_user_ids)
  ) then
    raise exception 'QA_ORDER45_CLEANUP_INCOMPLETE';
  end if;
end;
$$;

commit;
