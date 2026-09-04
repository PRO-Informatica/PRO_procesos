-- 087_grant_invoice_review_to_purchasing.sql
-- APPLIED SUCCESSFULLY — EXECUTED ON 2026-09-04.
--
-- Purchasing owns the operational Batch/Invoice flow. Grant the existing
-- invoice.review permission so it can request reinvoicing when reconciliation
-- finishes WITH_DIFFERENCES. No other role or permission is changed.

begin;

do $$
declare
  v_role_id uuid;
  v_permission_id uuid;
begin
  select r.id into strict v_role_id
  from public.roles r
  where r.code = 'PURCHASING'
    and r.active;

  select p.id into strict v_permission_id
  from public.permissions p
  where p.code = 'invoice.review'
    and p.active;

  insert into public.role_permissions(role_id, permission_id)
  values (v_role_id, v_permission_id)
  on conflict do nothing;

  if not exists (
    select 1
    from public.role_permissions assignment
    where assignment.role_id = v_role_id
      and assignment.permission_id = v_permission_id
  ) then
    raise exception 'PURCHASING_INVOICE_REVIEW_GRANT_FAILED';
  end if;
exception
  when no_data_found then
    raise exception 'PURCHASING_OR_INVOICE_REVIEW_NOT_FOUND';
  when too_many_rows then
    raise exception 'PURCHASING_OR_INVOICE_REVIEW_NOT_UNIQUE';
end;
$$;

commit;

-- Live QA after execution:
--   * PURCHASING retains invoice.create and invoice.match;
--   * PURCHASING also resolves invoice.review;
--   * WITH_DIFFERENCES exposes the reinvoicing action;
--   * request_dispatch_reinvoicing keeps enforcing invoice.review.
