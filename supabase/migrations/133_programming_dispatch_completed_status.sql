-- Operational dispatch completion is distinct from financial programming closure.
-- Commit this enum migration before using the new value in migration 134.
begin;
alter type public.programming_status add value if not exists 'DISPATCH_COMPLETED' after 'IN_EXECUTION';
commit;
