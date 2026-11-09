-- Unknown historical information stays NULL. Existing reviewed values remain intact.
begin;
alter table public.dispatch_guides
  alter column laboratory_applied drop not null,
  alter column laboratory_applied drop default,
  alter column details drop not null,
  alter column details drop default;
comment on column public.dispatch_guides.laboratory_applied is 'Resident confirmation: true/false when reviewed, NULL when not recorded on historical guides.';
comment on column public.dispatch_guides.details is 'Editable source information; NULL when not recorded on historical guides. Never inferred on release.';
notify pgrst,'reload schema';
commit;
