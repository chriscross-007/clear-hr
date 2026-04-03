-- Migration: seed default absence types on org creation

-- Function to insert the three default absence types for a given org
create or replace function seed_default_absence_types(org_id uuid)
returns void
language plpgsql
as $$
begin
  insert into public.absence_types
    (organisation_id, name, is_paid, requires_tracking, deducts_from_entitlement, requires_approval, is_default)
  values
    (org_id, 'Annual Leave',        true, true,  true,  true,  true),
    (org_id, 'Sick',                true, false, false, false, true),
    (org_id, 'Compassionate Leave', true, false, false, false, true)
  on conflict do nothing;
end;
$$;

-- Trigger function that calls the seed on new org insert
create or replace function trigger_seed_default_absence_types()
returns trigger
language plpgsql
as $$
begin
  perform seed_default_absence_types(NEW.id);
  return NEW;
end;
$$;

-- Attach trigger to organisations table
create trigger seed_absence_types_on_org_insert
  after insert on public.organisations
  for each row
  execute function trigger_seed_default_absence_types();

-- Backfill: seed defaults for any existing orgs that don't have them yet
insert into public.absence_types
  (organisation_id, name, is_paid, requires_tracking, deducts_from_entitlement, requires_approval, is_default)
select
  o.id, v.name, v.is_paid, v.requires_tracking, v.deducts_from_entitlement, v.requires_approval, true
from public.organisations o
cross join (
  values
    ('Annual Leave',        true, true,  true,  true),
    ('Sick',                true, false, false, false),
    ('Compassionate Leave', true, false, false, false)
) as v(name, is_paid, requires_tracking, deducts_from_entitlement, requires_approval)
where not exists (
  select 1 from public.absence_types at
  where at.organisation_id = o.id and at.name = v.name and at.is_default = true
);
