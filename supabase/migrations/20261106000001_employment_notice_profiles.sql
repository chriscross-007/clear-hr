-- CLE-239 — Employment Notice Profiles (contractual notice).
--
-- Spec: Spec Vault → specs/Employee Records/Employment Notice Profiles.md
--
-- Named profiles (e.g. "Standard", "Senior Staff") holding the notice a
-- member must give and the notice the organisation must give, in weeks
-- or months, plus optional probation figures. Each member points at
-- one profile via members.employment_notice_profile_id, set to the
-- org's Default on insert.
--
-- Separate from notice_period_profiles (Holiday Notice — how far ahead
-- holiday must be booked).
--
-- Writes go through server actions on the service-role client; RLS
-- allows org members to read their org's profiles and nothing else.
-- Trigger functions are SECURITY INVOKER (org creation runs inside the
-- create_organisation RPC; member inserts run on the service role or a
-- session that can read its own org's profiles).
--
-- Safe to run twice.

-- 1 ---------------------------------------------------------------------

create table if not exists public.employment_notice_profiles (
  id                         uuid primary key default gen_random_uuid(),
  organisation_id            uuid not null references public.organisations(id) on delete cascade,
  name                       text not null,
  is_default                 boolean not null default false,
  sort_order                 int not null default 0,
  member_amount              int not null default 1 check (member_amount between 0 and 120),
  member_unit                text not null default 'month' check (member_unit in ('week', 'month')),
  employer_amount            int not null default 1 check (employer_amount between 0 and 120),
  employer_unit              text not null default 'month' check (employer_unit in ('week', 'month')),
  employer_statutory_floor   boolean not null default true,
  probation_member_amount    int check (probation_member_amount between 0 and 120),
  probation_member_unit      text check (probation_member_unit in ('week', 'month')),
  probation_employer_amount  int check (probation_employer_amount between 0 and 120),
  probation_employer_unit    text check (probation_employer_unit in ('week', 'month')),
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);

create index if not exists idx_employment_notice_profiles_org
  on public.employment_notice_profiles (organisation_id);

create unique index if not exists uq_employment_notice_profiles_org_name
  on public.employment_notice_profiles (organisation_id, lower(name));

create unique index if not exists uq_employment_notice_profiles_one_default
  on public.employment_notice_profiles (organisation_id)
  where is_default = true;

drop trigger if exists set_employment_notice_profiles_updated_at on public.employment_notice_profiles;
create trigger set_employment_notice_profiles_updated_at
  before update on public.employment_notice_profiles
  for each row execute function handle_updated_at();

alter table public.employment_notice_profiles enable row level security;

drop policy if exists employment_notice_profiles_select on public.employment_notice_profiles;
create policy employment_notice_profiles_select on public.employment_notice_profiles
  for select to authenticated
  using (
    organisation_id in (
      select organisation_id from public.members where user_id = auth.uid()
    )
  );

-- 2 ---------------------------------------------------------------------
-- Seed a Default ("Standard", 1 month each way) for every existing org.

insert into public.employment_notice_profiles (
  organisation_id, name, is_default, sort_order,
  member_amount, member_unit, employer_amount, employer_unit, employer_statutory_floor
)
select o.id, 'Standard', true, 0, 1, 'month', 1, 'month', true
from public.organisations o
where not exists (
  select 1 from public.employment_notice_profiles p
  where p.organisation_id = o.id and p.is_default = true
);

-- 3 ---------------------------------------------------------------------

alter table public.members
  add column if not exists employment_notice_profile_id uuid
    references public.employment_notice_profiles(id) on delete set null;

create index if not exists idx_members_employment_notice_profile_id
  on public.members (employment_notice_profile_id);

update public.members m
set employment_notice_profile_id = p.id
from public.employment_notice_profiles p
where p.organisation_id = m.organisation_id
  and p.is_default = true
  and m.employment_notice_profile_id is null;

-- 4 ---------------------------------------------------------------------
-- New org → seed its Default.

create or replace function public.trigger_seed_default_employment_notice_profile()
returns trigger
language plpgsql
as $$
begin
  insert into public.employment_notice_profiles (
    organisation_id, name, is_default, sort_order,
    member_amount, member_unit, employer_amount, employer_unit, employer_statutory_floor
  )
  values (NEW.id, 'Standard', true, 0, 1, 'month', 1, 'month', true)
  on conflict do nothing;
  return NEW;
end $$;

drop trigger if exists seed_default_employment_notice_profile_on_org_insert on public.organisations;
create trigger seed_default_employment_notice_profile_on_org_insert
  after insert on public.organisations
  for each row execute function public.trigger_seed_default_employment_notice_profile();

-- 5 ---------------------------------------------------------------------
-- New member → their org's Default.

create or replace function public.trigger_assign_employment_notice_profile()
returns trigger
language plpgsql
as $$
declare def_id uuid;
begin
  if NEW.employment_notice_profile_id is not null then
    return NEW;
  end if;
  select id into def_id from public.employment_notice_profiles
    where organisation_id = NEW.organisation_id and is_default = true
    limit 1;
  NEW.employment_notice_profile_id := def_id;
  return NEW;
end $$;

drop trigger if exists assign_employment_notice_profile_on_member_insert on public.members;
create trigger assign_employment_notice_profile_on_member_insert
  before insert on public.members
  for each row execute function public.trigger_assign_employment_notice_profile();
