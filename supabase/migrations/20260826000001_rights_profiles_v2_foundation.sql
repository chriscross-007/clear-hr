-- CLE-196a Foundation — additive schema for Rights Profiles v2.
--
-- Creates the rights_profiles table + related columns/indexes/guards.
-- Seeds four default profiles per organisation and assigns every member
-- to a starting profile. NO columns dropped, NO data mutated on
-- existing tables. Old members.role / members.permissions and the old
-- admin_profiles / employee_profiles tables remain intact so existing
-- code paths continue to work until they're swapped one domain at a
-- time (CLE-196b) and the legacy columns are dropped in CLE-196c.
--
-- Idempotent: safe to run twice.

-- ---------------------------------------------------------------------------
-- 1. Enums
-- ---------------------------------------------------------------------------

do $$ begin
  if not exists (select 1 from pg_type where typname = 'rights_rank') then
    create type public.rights_rank as enum ('employee', 'manager', 'hr', 'admin');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. rights_profiles
-- ---------------------------------------------------------------------------

create table if not exists public.rights_profiles (
  id                          uuid        primary key default gen_random_uuid(),
  organisation_id             uuid        not null references public.organisations(id) on delete cascade,
  name                        text        not null,
  rank                        public.rights_rank not null,
  sort_order                  int         not null default 0,
  is_default                  boolean     not null default false,
  cross_user_access           text        not null check (cross_user_access in ('self','team','all')),

  -- Non-tab action switches
  can_create_users            boolean     not null default false,
  can_invite_users            boolean     not null default false,
  can_delete_users            boolean     not null default false,
  can_approve_holidays        boolean     not null default false,
  can_override_holiday_rules  boolean     not null default false,
  can_run_reports             boolean     not null default false,
  can_run_admin_reports       boolean     not null default false,
  can_manage_teams            boolean     not null default false,
  can_edit_org_settings       boolean     not null default false,
  can_edit_rights_profiles    boolean     not null default false,
  can_manage_billing          boolean     not null default false,
  can_view_audit_logs         boolean     not null default false,

  -- Sensitive-field redaction (orthogonal to tab access; see CLE-198)
  can_view_sensitive_fields   boolean     not null default false,
  can_edit_sensitive_fields   boolean     not null default false,

  -- Per-tab matrix: { <tab_key>: { view: bool, update: bool } }
  -- Tab keys enumerated in code (see src/lib/rights-resolver.ts):
  --   planner, timesheet, dashboard, holiday, employment,
  --   personal, contacts, documents, expenses, history
  tab_matrix                  jsonb       not null default '{}'::jsonb,

  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),

  constraint uq_rights_profiles_org_name unique (organisation_id, name)
);

-- Exactly one default profile per rank per org. Partial unique index
-- (stock PostgreSQL — no btree_gist required, unlike an EXCLUDE ...
-- USING gist constraint). Belt-and-braces with the WHERE NOT EXISTS
-- checks in the seed section below.
create unique index if not exists uq_rights_profiles_default_per_rank
  on public.rights_profiles (organisation_id, rank)
  where is_default = true;

create index if not exists idx_rights_profiles_org_rank
  on public.rights_profiles (organisation_id, rank, sort_order);

alter table public.rights_profiles enable row level security;

drop policy if exists rights_profiles_read_own_org on public.rights_profiles;
create policy rights_profiles_read_own_org on public.rights_profiles
  for select using (
    organisation_id in (select organisation_id from public.members where user_id = auth.uid())
  );

drop policy if exists rights_profiles_write_own_org on public.rights_profiles;
create policy rights_profiles_write_own_org on public.rights_profiles
  for all using (
    organisation_id in (select organisation_id from public.members where user_id = auth.uid())
  ) with check (
    organisation_id in (select organisation_id from public.members where user_id = auth.uid())
  );

-- Auto-touch updated_at on any UPDATE.
create or replace function public.set_rights_profiles_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_rights_profiles_updated_at on public.rights_profiles;
create trigger trg_rights_profiles_updated_at
  before update on public.rights_profiles
  for each row execute function public.set_rights_profiles_updated_at();

-- ---------------------------------------------------------------------------
-- 3. members additions
-- ---------------------------------------------------------------------------

alter table public.members
  add column if not exists rights_profile_id uuid references public.rights_profiles(id),
  add column if not exists is_billing_contact boolean not null default false;

-- Exactly one billing contact per org.
create unique index if not exists one_billing_contact_per_org
  on public.members(organisation_id) where is_billing_contact = true;

-- ---------------------------------------------------------------------------
-- 4. custom_field_definitions.is_sensitive (Phase 3 uses this; column added
--     now so the schema shape doesn't shift under Phase 2)
-- ---------------------------------------------------------------------------

alter table public.custom_field_definitions
  add column if not exists is_sensitive boolean not null default false;

-- ---------------------------------------------------------------------------
-- 5. Seed default profiles per organisation
-- ---------------------------------------------------------------------------
-- Uses `insert ... select ... where not exists` so re-running the
-- migration doesn't duplicate rows.

-- Full tab matrix (all view + update = true) reused by Admin/HR seeds.
-- Written inline because we can't ship helper functions before the seed.

-- Admin: everything true, all tabs view+update, access=all.
insert into public.rights_profiles
  (organisation_id, name, rank, sort_order, is_default, cross_user_access,
   can_create_users, can_invite_users, can_delete_users,
   can_approve_holidays, can_override_holiday_rules,
   can_run_reports, can_run_admin_reports,
   can_manage_teams, can_edit_org_settings, can_edit_rights_profiles,
   can_manage_billing, can_view_audit_logs,
   can_view_sensitive_fields, can_edit_sensitive_fields,
   tab_matrix)
select
  o.id, 'Admin', 'admin'::public.rights_rank, 0, true, 'all',
  true, true, true,
  true, true,
  true, true,
  true, true, true,
  true, true,
  true, true,
  jsonb_build_object(
    'planner',    jsonb_build_object('view', true, 'update', true),
    'timesheet',  jsonb_build_object('view', true, 'update', true),
    'dashboard',  jsonb_build_object('view', true, 'update', true),
    'holiday',    jsonb_build_object('view', true, 'update', true),
    'employment', jsonb_build_object('view', true, 'update', true),
    'personal',   jsonb_build_object('view', true, 'update', true),
    'contacts',   jsonb_build_object('view', true, 'update', true),
    'documents',  jsonb_build_object('view', true, 'update', true),
    'expenses',   jsonb_build_object('view', true, 'update', true),
    'history',    jsonb_build_object('view', true, 'update', true)
  )
from public.organisations o
where not exists (
  select 1 from public.rights_profiles p
  where p.organisation_id = o.id and p.rank = 'admin' and p.is_default
);

-- HR: everything true EXCEPT can_manage_billing, can_edit_rights_profiles,
-- can_run_admin_reports. All tabs view+update. Access=all.
insert into public.rights_profiles
  (organisation_id, name, rank, sort_order, is_default, cross_user_access,
   can_create_users, can_invite_users, can_delete_users,
   can_approve_holidays, can_override_holiday_rules,
   can_run_reports, can_run_admin_reports,
   can_manage_teams, can_edit_org_settings, can_edit_rights_profiles,
   can_manage_billing, can_view_audit_logs,
   can_view_sensitive_fields, can_edit_sensitive_fields,
   tab_matrix)
select
  o.id, 'HR', 'hr'::public.rights_rank, 0, true, 'all',
  true, true, true,
  true, true,
  true, false,
  true, false, false,
  false, true,
  true, true,
  jsonb_build_object(
    'planner',    jsonb_build_object('view', true, 'update', true),
    'timesheet',  jsonb_build_object('view', true, 'update', true),
    'dashboard',  jsonb_build_object('view', true, 'update', true),
    'holiday',    jsonb_build_object('view', true, 'update', true),
    'employment', jsonb_build_object('view', true, 'update', true),
    'personal',   jsonb_build_object('view', true, 'update', true),
    'contacts',   jsonb_build_object('view', true, 'update', true),
    'documents',  jsonb_build_object('view', true, 'update', true),
    'expenses',   jsonb_build_object('view', true, 'update', true),
    'history',    jsonb_build_object('view', true, 'update', true)
  )
from public.organisations o
where not exists (
  select 1 from public.rights_profiles p
  where p.organisation_id = o.id and p.rank = 'hr' and p.is_default
);

-- Manager: team-scoped, can approve holidays for team, view+update on
-- people-facing tabs of team members, view-only on the rest. Cannot
-- create/invite/delete users or manage billing/rights/settings.
insert into public.rights_profiles
  (organisation_id, name, rank, sort_order, is_default, cross_user_access,
   can_create_users, can_invite_users, can_delete_users,
   can_approve_holidays, can_override_holiday_rules,
   can_run_reports, can_run_admin_reports,
   can_manage_teams, can_edit_org_settings, can_edit_rights_profiles,
   can_manage_billing, can_view_audit_logs,
   can_view_sensitive_fields, can_edit_sensitive_fields,
   tab_matrix)
select
  o.id, 'Manager', 'manager'::public.rights_rank, 0, true, 'team',
  false, false, false,
  true, false,
  true, false,
  false, false, false,
  false, false,
  false, false,
  jsonb_build_object(
    'planner',    jsonb_build_object('view', true,  'update', false),
    'timesheet',  jsonb_build_object('view', true,  'update', false),
    'dashboard',  jsonb_build_object('view', true,  'update', false),
    'holiday',    jsonb_build_object('view', true,  'update', true),
    'employment', jsonb_build_object('view', true,  'update', false),
    'personal',   jsonb_build_object('view', true,  'update', false),
    'contacts',   jsonb_build_object('view', true,  'update', false),
    'documents',  jsonb_build_object('view', true,  'update', false),
    'expenses',   jsonb_build_object('view', true,  'update', false),
    'history',    jsonb_build_object('view', true,  'update', false)
  )
from public.organisations o
where not exists (
  select 1 from public.rights_profiles p
  where p.organisation_id = o.id and p.rank = 'manager' and p.is_default
);

-- Employee: self-scoped. Tab matrix applies to the employee's own record.
-- Can view+update Personal, Contacts, Holiday, Documents on themselves.
-- Can view sensitive fields on themselves (their own DOB, NI, bank);
-- edit-sensitive stays false so payroll data changes are HR/Admin only.
insert into public.rights_profiles
  (organisation_id, name, rank, sort_order, is_default, cross_user_access,
   can_create_users, can_invite_users, can_delete_users,
   can_approve_holidays, can_override_holiday_rules,
   can_run_reports, can_run_admin_reports,
   can_manage_teams, can_edit_org_settings, can_edit_rights_profiles,
   can_manage_billing, can_view_audit_logs,
   can_view_sensitive_fields, can_edit_sensitive_fields,
   tab_matrix)
select
  o.id, 'Employee', 'employee'::public.rights_rank, 0, true, 'self',
  false, false, false,
  false, false,
  false, false,
  false, false, false,
  false, false,
  true, false,
  jsonb_build_object(
    'planner',    jsonb_build_object('view', true,  'update', false),
    'timesheet',  jsonb_build_object('view', true,  'update', true),
    'dashboard',  jsonb_build_object('view', true,  'update', false),
    'holiday',    jsonb_build_object('view', true,  'update', true),
    'employment', jsonb_build_object('view', true,  'update', false),
    'personal',   jsonb_build_object('view', true,  'update', true),
    'contacts',   jsonb_build_object('view', true,  'update', true),
    'documents',  jsonb_build_object('view', true,  'update', false),
    'expenses',   jsonb_build_object('view', true,  'update', true),
    'history',    jsonb_build_object('view', true,  'update', false)
  )
from public.organisations o
where not exists (
  select 1 from public.rights_profiles p
  where p.organisation_id = o.id and p.rank = 'employee' and p.is_default
);

-- ---------------------------------------------------------------------------
-- 6. Assign existing members to a starting profile
-- ---------------------------------------------------------------------------
-- Fresh-start migration but *every* tenant needs to survive. Rules:
--   a) Give every unassigned member their org's Employee default first.
--   b) Then promote every legacy owner/admin to their org's Admin
--      default so no org ends up with zero Admins (which would make the
--      last-Admin guard freeze the whole tenant).
--   c) For any org that has no billing contact yet, set the earliest
--      legacy owner as the billing contact.
--
-- Guard: (a) only touches rows whose rights_profile_id is null, so
-- re-runs do not stomp changes an admin makes later in the Phase 2 UI.
-- (b) and (c) are idempotent by construction.

-- (a) Everyone starts as Employee.
update public.members m
   set rights_profile_id = p.id
  from public.rights_profiles p
 where m.rights_profile_id is null
   and p.organisation_id = m.organisation_id
   and p.rank = 'employee'
   and p.is_default;

-- (b) Promote every legacy owner/admin to the Admin default.
update public.members m
   set rights_profile_id = p.id
  from public.rights_profiles p
 where m.role in ('owner', 'admin')
   and p.organisation_id = m.organisation_id
   and p.rank = 'admin'
   and p.is_default;

-- (c) Earliest legacy owner per org becomes billing contact (only where
-- one isn't already flagged, so re-runs don't shift it).
with owners_to_flag as (
  select distinct on (m.organisation_id) m.id
  from public.members m
  where m.role = 'owner'
    and not exists (
      select 1 from public.members m2
      where m2.organisation_id = m.organisation_id
        and m2.is_billing_contact = true
    )
  order by m.organisation_id, m.created_at, m.id
)
update public.members m
   set is_billing_contact = true
  from owners_to_flag o
 where m.id = o.id;

-- ---------------------------------------------------------------------------
-- 7. Last-Admin guard trigger
-- ---------------------------------------------------------------------------
-- Prevents any UPDATE / DELETE that would leave an organisation without
-- at least one member on an Admin-rank profile. This is the real
-- protection against locking Acme out of the platform.

create or replace function public.ensure_at_least_one_admin()
returns trigger language plpgsql as $$
declare
  target_org       uuid := coalesce(old.organisation_id, new.organisation_id);
  other_admins     int;   -- admins in the org excluding the row being changed
  old_was_admin    boolean := false;
  new_will_be_admin boolean := false;
  before_count     int;
  after_count      int;
begin
  if target_org is null then
    return coalesce(new, old);
  end if;

  -- How many Admins are in this org NOT counting the row under change.
  select count(*) into other_admins
    from public.members m
    join public.rights_profiles p on p.id = m.rights_profile_id
   where m.organisation_id = target_org
     and p.rank = 'admin'
     and m.id != coalesce(old.id, '00000000-0000-0000-0000-000000000000'::uuid);

  -- Was the row an Admin before this operation?
  if old.rights_profile_id is not null then
    select exists (
      select 1 from public.rights_profiles p
      where p.id = old.rights_profile_id and p.rank = 'admin'
    ) into old_was_admin;
  end if;

  -- Will the row be an Admin after this operation? (DELETE = no.)
  if tg_op = 'UPDATE' and new.rights_profile_id is not null then
    select exists (
      select 1 from public.rights_profiles p
      where p.id = new.rights_profile_id and p.rank = 'admin'
    ) into new_will_be_admin;
  end if;

  before_count := other_admins + (case when old_was_admin then 1 else 0 end);
  after_count  := other_admins + (case when new_will_be_admin then 1 else 0 end);

  -- Only block if this operation actually crosses the threshold. If the
  -- org was ALREADY at 0 admins for some reason (e.g. seed order, an
  -- earlier data-fix in progress), don't freeze every subsequent write
  -- — allow the operation and rely on the app to re-establish an
  -- Admin. The point of the guard is to protect against operations
  -- that CAUSE the drop, not to enforce an invariant on already-broken
  -- data.
  if before_count >= 1 and after_count < 1 then
    raise exception 'Cannot leave organisation % without at least one Admin', target_org
      using errcode = 'check_violation';
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_ensure_at_least_one_admin on public.members;
create trigger trg_ensure_at_least_one_admin
  before update or delete on public.members
  for each row execute function public.ensure_at_least_one_admin();

-- ---------------------------------------------------------------------------
-- Notes for follow-up phases:
--   CLE-196b — swap every code read of members.role / members.permissions /
--              admin_profiles / employee_profiles to the resolver.
--   CLE-196c — drop members.role, members.permissions, admin_profiles,
--              employee_profiles, and any remaining rights-config helpers.
--   CLE-198  — populate is_sensitive on custom_field_definitions and wire
--              the redaction UI.
-- ---------------------------------------------------------------------------
