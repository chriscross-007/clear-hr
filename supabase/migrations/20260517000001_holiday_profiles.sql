-- CLE-194 — Holiday Profiles (Phase 2).
--
-- Lifts the per-member `holiday_*` cog and the org-level
-- `default_holiday_*` cascade into a single multi-profile entity. Each
-- member points at exactly one Holiday Profile (`members.holiday_profile_id`,
-- auto-seeded to the org's Default on insert via trigger).
--
-- Existing periods are unchanged — they already snapshot their 7 values
-- at creation time (`holiday_periods.holiday_*` columns). Future periods
-- snapshot from the member's profile instead of the now-dropped cog.
--
-- Test-data only. No per-member cog values are preserved; every member
-- is re-pointed to a freshly-created Default profile carrying the
-- starting values agreed with Chris: Fixed / Days / allowance=20 /
-- earned_factor=0 / toil=0 / max_carry=0 / min_carry=0.

-- ---------------------------------------------------------------------------
-- 1. holiday_profiles
-- ---------------------------------------------------------------------------

create table public.holiday_profiles (
  id                          uuid primary key default gen_random_uuid(),
  organisation_id             uuid not null references public.organisations(id) on delete cascade,
  name                        text not null,
  is_default                  boolean not null default false,
  sort_order                  int not null default 0,
  holiday_type                text not null default 'fixed'
                                check (holiday_type in ('fixed', 'earned')),
  holiday_units               text not null default 'days'
                                check (holiday_units in ('days', 'hours')),
  holiday_earned_factor       numeric(10,3) not null default 0,
  holiday_allowance           numeric(10,3) not null default 20,
  holiday_toil_hours_per_day  numeric(10,3) not null default 0,
  holiday_max_carry_forward   numeric(10,3) not null default 0
                                check (holiday_max_carry_forward >= 0),
  holiday_min_carry_forward   numeric(10,3) not null default 0
                                check (holiday_min_carry_forward <= 0),
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  constraint uq_holiday_profiles_org_name unique (organisation_id, name)
);

create index idx_holiday_profiles_organisation_id
  on public.holiday_profiles(organisation_id);

create unique index uq_holiday_profiles_one_default_per_org
  on public.holiday_profiles(organisation_id)
  where is_default = true;

create trigger set_holiday_profiles_updated_at
  before update on public.holiday_profiles
  for each row execute function handle_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Seed: one Default profile per existing org with the agreed starting values
-- ---------------------------------------------------------------------------

insert into public.holiday_profiles (
  organisation_id, name, is_default, sort_order,
  holiday_type, holiday_units, holiday_earned_factor,
  holiday_allowance, holiday_toil_hours_per_day,
  holiday_max_carry_forward, holiday_min_carry_forward
)
select id, 'Default', true, 0,
       'fixed', 'days', 0,
       20, 0,
       0, 0
from public.organisations;

-- ---------------------------------------------------------------------------
-- 3. members.holiday_profile_id — point every member at the Default
-- ---------------------------------------------------------------------------

alter table public.members
  add column holiday_profile_id uuid references public.holiday_profiles(id) on delete set null;

update public.members m
set holiday_profile_id = hp.id
from public.holiday_profiles hp
where hp.organisation_id = m.organisation_id and hp.is_default = true;

create index idx_members_holiday_profile_id
  on public.members(holiday_profile_id);

-- ---------------------------------------------------------------------------
-- 4. Drop the per-member cog columns. Values are now resolved via the
--    profile, then snapshotted onto each holiday_periods row at creation.
-- ---------------------------------------------------------------------------

alter table public.members
  drop column holiday_type,
  drop column holiday_units,
  drop column holiday_earned_factor,
  drop column holiday_allowance,
  drop column holiday_toil_hours_per_day,
  drop column holiday_max_carry_forward,
  drop column holiday_min_carry_forward;

-- ---------------------------------------------------------------------------
-- 5. Drop the org-level Default Cascade columns. The Default Holiday
--    Profile is now the single source of starting values for new members.
-- ---------------------------------------------------------------------------

alter table public.organisations
  drop column default_holiday_type,
  drop column default_holiday_units,
  drop column default_holiday_earned_factor,
  drop column default_holiday_allowance,
  drop column default_holiday_toil_hours_per_day,
  drop column default_holiday_max_carry_forward,
  drop column default_holiday_min_carry_forward;

-- ---------------------------------------------------------------------------
-- 6. Trigger: seed a Default Holiday Profile when a new org is created
-- ---------------------------------------------------------------------------

create or replace function public.trigger_seed_default_holiday_profile()
returns trigger
language plpgsql
security definer
as $$
begin
  insert into public.holiday_profiles (
    organisation_id, name, is_default, sort_order,
    holiday_type, holiday_units, holiday_earned_factor,
    holiday_allowance, holiday_toil_hours_per_day,
    holiday_max_carry_forward, holiday_min_carry_forward
  )
  values (
    NEW.id, 'Default', true, 0,
    'fixed', 'days', 0,
    20, 0,
    0, 0
  )
  on conflict (organisation_id, name) do nothing;
  return NEW;
end $$;

create trigger seed_default_holiday_profile_on_org_insert
  after insert on public.organisations
  for each row execute function public.trigger_seed_default_holiday_profile();

-- ---------------------------------------------------------------------------
-- 7. Trigger: assign new members to their org's Default Holiday Profile
-- ---------------------------------------------------------------------------

create or replace function public.trigger_assign_holiday_profile()
returns trigger
language plpgsql
security definer
as $$
declare def_id uuid;
begin
  if NEW.holiday_profile_id is not null then
    return NEW;
  end if;
  select id into def_id from public.holiday_profiles
    where organisation_id = NEW.organisation_id and is_default = true
    limit 1;
  NEW.holiday_profile_id := def_id;
  return NEW;
end $$;

create trigger assign_holiday_profile_on_member_insert
  before insert on public.members
  for each row execute function public.trigger_assign_holiday_profile();

-- ---------------------------------------------------------------------------
-- 8. RLS — read for all org members, write for owners only, Default
--    profile non-deletable.
-- ---------------------------------------------------------------------------

alter table public.holiday_profiles enable row level security;

create policy holiday_profiles_select on public.holiday_profiles
  for select to authenticated
  using (
    organisation_id in (
      select organisation_id from public.members where user_id = auth.uid()
    )
  );

create policy holiday_profiles_insert on public.holiday_profiles
  for insert to authenticated
  with check (
    organisation_id in (
      select organisation_id from public.members
      where user_id = auth.uid() and role = 'owner'
    )
  );

create policy holiday_profiles_update on public.holiday_profiles
  for update to authenticated
  using (
    organisation_id in (
      select organisation_id from public.members
      where user_id = auth.uid() and role = 'owner'
    )
  )
  with check (
    organisation_id in (
      select organisation_id from public.members
      where user_id = auth.uid() and role = 'owner'
    )
  );

create policy holiday_profiles_delete on public.holiday_profiles
  for delete to authenticated
  using (
    is_default = false
    and organisation_id in (
      select organisation_id from public.members
      where user_id = auth.uid() and role = 'owner'
    )
  );

comment on table public.holiday_profiles is
  'CLE-194 — named sets of holiday parameters (type, units, allowance etc.). Multiple per org; one is_default per org (auto-seeded on org create and assigned to new members). Replaces members.holiday_* + organisations.default_holiday_*.';
