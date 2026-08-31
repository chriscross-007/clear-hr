-- CLE-205 / CLE-204a — Documents Tier 1 Foundation.
--
-- Ships:
--   * document               table (per-member + org-scoped rows, with
--                            verification workflow columns).
--   * document_subtype       table (tenant-configurable subtype list
--                            with all subtype flags — verification,
--                            expiry, retention override, expected-for-
--                            every-member, employee-can-upload, etc.).
--   * disposal_queue         table (30-day grace holding pen for
--                            soft-deleted docs; nightly purge is
--                            wired in CLE-209).
--   * Three new booleans on rights_profiles:
--       can_view_organisation_documents
--       can_manage_deleted_documents
--       can_force_delete_documents
--   * Backfill: existing seeded profiles get sensible defaults.
--   * Trigger: any future rights_profile insert gets the same
--     defaults based on rank + is_default.
--   * Trigger: any future organisation gets a starter subtype set
--     seeded automatically (includes RTW + DBS + absence attachments).
--   * Backfill: seed subtypes for every existing tenant.
--   * Backfill: copy existing member_documents rows into document
--     with owner_scope='member'.
--   * Storage bucket: org-documents (private, signed-URL-only).
--   * RLS: flag-based, matches Path B pattern from 20260828000003.
--
-- Deferred to CLE-206:
--   * Any CRUD action or UI — this migration is schema-only.
--   * Nightly disposal sweep — implemented in CLE-209.

begin;

-- ===========================================================================
-- 1. Rights profile flags
-- ===========================================================================

alter table public.rights_profiles
  add column if not exists can_view_organisation_documents boolean not null default false,
  add column if not exists can_manage_deleted_documents    boolean not null default false,
  add column if not exists can_force_delete_documents      boolean not null default false;

-- Backfill existing seeded profiles per the design in
-- specs/Documents/Documents.md §4a.
--
-- Everyone on a seeded profile can view org docs by default (handbook,
-- policies). HR + Admin manage deleted docs. Nobody force-deletes
-- without an explicit configuration act — including Admin.
update public.rights_profiles
set can_view_organisation_documents = true
where is_default = true
  and rank in ('admin', 'hr', 'manager', 'employee');

update public.rights_profiles
set can_manage_deleted_documents = true
where is_default = true
  and rank in ('admin', 'hr');

-- Trigger to seed the same defaults on future INSERTs so tenants
-- created via the create_organisation RPC (which lives outside
-- migrations) automatically get the right flags without a code
-- change to that RPC. Non-default profiles keep whatever the caller
-- supplied.
create or replace function public.trigger_seed_documents_rights_flags()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.is_default = true then
    if new.rank in ('admin', 'hr', 'manager', 'employee')
       and new.can_view_organisation_documents = false then
      new.can_view_organisation_documents := true;
    end if;
    if new.rank in ('admin', 'hr')
       and new.can_manage_deleted_documents = false then
      new.can_manage_deleted_documents := true;
    end if;
  end if;
  -- can_force_delete_documents stays false — explicit toggle only.
  return new;
end;
$$;

drop trigger if exists trg_seed_documents_rights_flags on public.rights_profiles;
create trigger trg_seed_documents_rights_flags
before insert on public.rights_profiles
for each row
execute function public.trigger_seed_documents_rights_flags();

-- ---------------------------------------------------------------------------
-- 1a. Extend has_rights_flag() to recognise the three new document flags
-- ---------------------------------------------------------------------------
-- Same signature as the Path B version from 20260828000003 (returns
-- false for any unknown flag_name). Adding the new cases keeps every
-- existing policy call intact.

create or replace function public.has_rights_flag(org_id uuid, flag_name text)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select case flag_name
    when 'can_create_users'                 then p.can_create_users
    when 'can_invite_users'                 then p.can_invite_users
    when 'can_delete_users'                 then p.can_delete_users
    when 'can_approve_holidays'             then p.can_approve_holidays
    when 'can_override_holiday_rules'       then p.can_override_holiday_rules
    when 'can_run_reports'                  then p.can_run_reports
    when 'can_run_admin_reports'            then p.can_run_admin_reports
    when 'can_manage_teams'                 then p.can_manage_teams
    when 'can_edit_org_settings'            then p.can_edit_org_settings
    when 'can_edit_rights_profiles'         then p.can_edit_rights_profiles
    when 'can_manage_billing'               then p.can_manage_billing
    when 'can_view_audit_logs'              then p.can_view_audit_logs
    when 'can_view_sensitive_fields'        then p.can_view_sensitive_fields
    when 'can_edit_sensitive_fields'        then p.can_edit_sensitive_fields
    when 'can_manage_holiday_bookings'      then p.can_manage_holiday_bookings
    when 'can_view_organisation_documents'  then p.can_view_organisation_documents
    when 'can_manage_deleted_documents'     then p.can_manage_deleted_documents
    when 'can_force_delete_documents'       then p.can_force_delete_documents
    else false
  end
  from public.members m
  join public.rights_profiles p on p.id = m.rights_profile_id
  where m.organisation_id = org_id
    and m.user_id = (select auth.uid())
  limit 1;
$$;

-- ===========================================================================
-- 2. document_subtype table
-- ===========================================================================
--
-- Tenant-configurable refinement of the system `type` enum. Every
-- flag that governs upload/verify/expiry/retention lives here rather
-- than on the document itself, so editing a subtype doesn't rewrite
-- history — new uploads pick up the new rules, existing docs keep
-- what they were uploaded under.

create table if not exists public.document_subtype (
  id                            uuid        primary key default gen_random_uuid(),
  organisation_id               uuid        not null references public.organisations(id) on delete cascade,
  -- System type enum (documents.md §5 closed set)
  type                          text        not null check (type in (
    'contract', 'certificate', 'evidence', 'policy', 'handbook',
    'attachment', 'other'
  )),
  name                          text        not null,
  sort_order                    int         not null default 0,
  -- Subtype flags per specs/Documents/Documents.md §5.
  employee_can_upload           boolean     not null default false,
  retention_class               text        not null default 'other',
  expiry_required               boolean     not null default false,
  default_expiry_months         int,
  requires_verification         boolean     not null default false,
  review_period_months          int,
  expected_for_every_member     boolean     not null default false,
  requires_signature            boolean     not null default false,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now(),
  constraint uq_document_subtype_org_type_name unique (organisation_id, type, name)
);

create index if not exists idx_document_subtype_organisation_id
  on public.document_subtype(organisation_id);
create index if not exists idx_document_subtype_type
  on public.document_subtype(organisation_id, type);

alter table public.document_subtype enable row level security;

-- Reads: any member of the tenant.
create policy document_subtype_select on public.document_subtype
  for select to authenticated
  using (
    organisation_id in (
      select m.organisation_id from public.members m
      where m.user_id = auth.uid()
    )
  );

-- Writes: needs can_edit_org_settings (settings-shaped surface).
create policy document_subtype_insert on public.document_subtype
  for insert to authenticated
  with check (public.has_rights_flag(organisation_id, 'can_edit_org_settings'));

create policy document_subtype_update on public.document_subtype
  for update to authenticated
  using (public.has_rights_flag(organisation_id, 'can_edit_org_settings'))
  with check (public.has_rights_flag(organisation_id, 'can_edit_org_settings'));

create policy document_subtype_delete on public.document_subtype
  for delete to authenticated
  using (public.has_rights_flag(organisation_id, 'can_edit_org_settings'));

-- ===========================================================================
-- 3. document table
-- ===========================================================================
--
-- The row per stored file. Verification workflow columns and
-- retention/disposal columns are all here.

create table if not exists public.document (
  id                        uuid        primary key default gen_random_uuid(),
  organisation_id           uuid        not null references public.organisations(id) on delete cascade,
  owner_scope               text        not null check (owner_scope in ('member', 'organisation')),
  owner_id                  uuid,       -- member id when scope=member, NULL when scope=organisation
  -- Storage
  storage_path              text        not null,
  file_name                 text        not null,
  file_size                 bigint      not null,
  content_type              text        not null,
  -- Classification
  type                      text        not null check (type in (
    'contract', 'certificate', 'evidence', 'policy', 'handbook',
    'attachment', 'other'
  )),
  subtype_id                uuid        references public.document_subtype(id) on delete set null,
  -- Expiry / retention
  expires_on                date,
  retention_class           text        not null default 'other',
  disposal_date             date,
  -- Verification workflow (CLE-207 wires the verify/renew actions;
  -- these columns are inert until then for docs whose subtype has
  -- requires_verification=false).
  verified_on               date,
  verified_by               uuid        references public.members(id) on delete set null,
  verification_notes        text,
  next_review_on            date,
  -- Provenance
  uploaded_by               uuid        references public.members(id) on delete set null,
  uploaded_at               timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  -- Constraints
  constraint chk_document_owner_shape check (
    (owner_scope = 'member' and owner_id is not null) or
    (owner_scope = 'organisation' and owner_id is null)
  )
);

create index if not exists idx_document_organisation_id
  on public.document(organisation_id);
create index if not exists idx_document_owner_scope_owner_id
  on public.document(organisation_id, owner_scope, owner_id);
create index if not exists idx_document_subtype_id
  on public.document(subtype_id);
create index if not exists idx_document_expires_on
  on public.document(organisation_id, expires_on)
  where expires_on is not null;
create index if not exists idx_document_next_review_on
  on public.document(organisation_id, next_review_on)
  where next_review_on is not null;
create index if not exists idx_document_disposal_date
  on public.document(organisation_id, disposal_date)
  where disposal_date is not null;

alter table public.document enable row level security;

-- Reads. Three paths, any one of which grants visibility:
--   1. Org-scoped doc + caller has can_view_organisation_documents.
--   2. Member-scoped doc + owner_id is the caller (self-read).
--   3. Member-scoped doc + caller has cross-user access that reaches
--      the owner (team = same team, all = any member in the org).
--
-- The tab-matrix documents.view cell is enforced at the app layer
-- (page.tsx guards). RLS provides the tenant/cross-user boundary.
create policy document_select on public.document
  for select to authenticated
  using (
    (
      owner_scope = 'organisation'
      and public.has_rights_flag(organisation_id, 'can_view_organisation_documents')
    )
    or
    (
      owner_scope = 'member'
      and (
        -- Self-read
        owner_id in (
          select id from public.members
          where user_id = auth.uid() and organisation_id = document.organisation_id
        )
        -- Cross-user 'all' — any org member is visible
        or public.get_cross_user_access(organisation_id) = 'all'
        -- Cross-user 'team' — same team as the caller
        or (
          public.get_cross_user_access(organisation_id) = 'team'
          and owner_id in (
            select m2.id from public.members m2
            where m2.organisation_id = document.organisation_id
              and m2.team_id = (
                select team_id from public.members
                where user_id = auth.uid()
                  and organisation_id = document.organisation_id
                limit 1
              )
          )
        )
      )
    )
  );

-- Writes: gated by can_edit_org_settings for org-scoped rows, by
-- the documents.update tab-matrix cell for member-scoped rows.
create policy document_insert on public.document
  for insert to authenticated
  with check (
    (
      owner_scope = 'organisation'
      and public.has_rights_flag(organisation_id, 'can_edit_org_settings')
    )
    or
    (
      owner_scope = 'member'
      and public.get_effective_tab_update(organisation_id, 'documents') = true
    )
  );

create policy document_update on public.document
  for update to authenticated
  using (
    (
      owner_scope = 'organisation'
      and public.has_rights_flag(organisation_id, 'can_edit_org_settings')
    )
    or
    (
      owner_scope = 'member'
      and public.get_effective_tab_update(organisation_id, 'documents') = true
    )
  )
  with check (
    (
      owner_scope = 'organisation'
      and public.has_rights_flag(organisation_id, 'can_edit_org_settings')
    )
    or
    (
      owner_scope = 'member'
      and public.get_effective_tab_update(organisation_id, 'documents') = true
    )
  );

create policy document_delete on public.document
  for delete to authenticated
  using (
    (
      owner_scope = 'organisation'
      and public.has_rights_flag(organisation_id, 'can_edit_org_settings')
    )
    or
    (
      owner_scope = 'member'
      and public.get_effective_tab_update(organisation_id, 'documents') = true
    )
  );

-- ===========================================================================
-- 4. disposal_queue table
-- ===========================================================================
--
-- Soft-delete holding pen. Rows sit here for 30 days before the
-- nightly sweep permanently deletes them from DB + storage. The
-- sweep and the queued_at grace check are wired in CLE-209.

create table if not exists public.disposal_queue (
  id                  uuid        primary key default gen_random_uuid(),
  organisation_id     uuid        not null references public.organisations(id) on delete cascade,
  document_id         uuid        not null,  -- soft-FK; the document row survives until purge
  queued_at           timestamptz not null default now(),
  queued_by           uuid        references public.members(id) on delete set null,
  -- Reason for force-delete when applicable (mandatory when the
  -- underlying doc's retention class would otherwise block deletion).
  force_delete_reason text,
  constraint uq_disposal_queue_document unique (document_id)
);

create index if not exists idx_disposal_queue_organisation_id
  on public.disposal_queue(organisation_id);
create index if not exists idx_disposal_queue_queued_at
  on public.disposal_queue(queued_at);

alter table public.disposal_queue enable row level security;

-- Only visible to callers who can manage deleted documents. Writes
-- (INSERT for soft-delete) are gated on documents.update; DELETE on
-- the queue row (i.e. Restore) is gated on can_manage_deleted_documents.
create policy disposal_queue_select on public.disposal_queue
  for select to authenticated
  using (public.has_rights_flag(organisation_id, 'can_manage_deleted_documents'));

create policy disposal_queue_insert on public.disposal_queue
  for insert to authenticated
  with check (public.get_effective_tab_update(organisation_id, 'documents') = true);

create policy disposal_queue_delete on public.disposal_queue
  for delete to authenticated
  using (public.has_rights_flag(organisation_id, 'can_manage_deleted_documents'));

-- ===========================================================================
-- 5. Subtype seeding — function + trigger for future orgs, plus a
--    one-off backfill for every existing tenant.
-- ===========================================================================

create or replace function public.seed_document_subtypes_for_org(p_org_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Contracts
  insert into public.document_subtype
    (organisation_id, type, name, sort_order, retention_class, requires_verification)
  values
    (p_org_id, 'contract', 'Employment contract', 1, 'contract', true),
    (p_org_id, 'contract', 'Variation',            2, 'contract', false)
  on conflict on constraint uq_document_subtype_org_type_name do nothing;

  -- Certificates
  insert into public.document_subtype
    (organisation_id, type, name, sort_order, retention_class,
     requires_verification, review_period_months, expiry_required)
  values
    (p_org_id, 'certificate', 'First-aid at work', 1, 'certificate', true, 36, true),
    (p_org_id, 'certificate', 'DBS check',         2, 'certificate', true, 36, false)
  on conflict on constraint uq_document_subtype_org_type_name do nothing;

  -- Evidence — Right-to-Work subtypes. Passport + BRP-no-time-limit
  -- are expected_for_every_member = true; time-limited entries have
  -- expiry_required = true.
  insert into public.document_subtype
    (organisation_id, type, name, sort_order, retention_class,
     requires_verification, expected_for_every_member, expiry_required)
  values
    (p_org_id, 'evidence', 'Passport (List A)',                  1, 'right_to_work', true, true,  false),
    (p_org_id, 'evidence', 'BRP — no time limit (List A)',       2, 'right_to_work', true, true,  false),
    (p_org_id, 'evidence', 'Visa (List B)',                      3, 'right_to_work', true, false, true),
    (p_org_id, 'evidence', 'BRP — time limited (List B)',        4, 'right_to_work', true, false, true),
    (p_org_id, 'evidence', 'Share code confirmation',            5, 'right_to_work', true, false, true)
  on conflict on constraint uq_document_subtype_org_type_name do nothing;

  -- Attachments — absence-attachment surfaces that already exist in
  -- the app. Employee can upload these against their own record.
  insert into public.document_subtype
    (organisation_id, type, name, sort_order, retention_class, employee_can_upload)
  values
    (p_org_id, 'attachment', 'Self-certification', 1, 'absence_attachment', true),
    (p_org_id, 'attachment', 'Fit note',           2, 'absence_attachment', true),
    (p_org_id, 'attachment', 'Prescription',       3, 'absence_attachment', true),
    (p_org_id, 'attachment', 'Other',              4, 'absence_attachment', true)
  on conflict on constraint uq_document_subtype_org_type_name do nothing;

  -- Policies & Handbook — one default entry each; admins add more.
  insert into public.document_subtype
    (organisation_id, type, name, sort_order, retention_class)
  values
    (p_org_id, 'policy',   'General policy',   1, 'other'),
    (p_org_id, 'handbook', 'Employee handbook', 1, 'other'),
    (p_org_id, 'other',    'Other',            1, 'other')
  on conflict on constraint uq_document_subtype_org_type_name do nothing;
end;
$$;

-- Trigger for new tenants — fire after INSERT on organisations.
create or replace function public.trigger_seed_document_subtypes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.seed_document_subtypes_for_org(new.id);
  return new;
end;
$$;

drop trigger if exists trg_seed_document_subtypes on public.organisations;
create trigger trg_seed_document_subtypes
after insert on public.organisations
for each row
execute function public.trigger_seed_document_subtypes();

-- Backfill: seed subtypes for every existing org that doesn't yet
-- have any. Idempotent because seed_document_subtypes_for_org uses
-- ON CONFLICT DO NOTHING.
do $$
declare
  o_id uuid;
begin
  for o_id in select id from public.organisations loop
    perform public.seed_document_subtypes_for_org(o_id);
  end loop;
end $$;

-- ===========================================================================
-- 6. Backfill: copy existing member_documents into document
-- ===========================================================================
--
-- One-way copy. member_documents stays in place — CLE-206's UI reads
-- from the new `document` table; the absence-attachment write path
-- can migrate over as part of CLE-206b.
--
-- Best-effort subtype mapping: absence attachments go to the seeded
-- "Fit note" subtype by default (the closest catch-all); the app can
-- reclassify later via the metadata edit action.

insert into public.document (
  id, organisation_id, owner_scope, owner_id,
  storage_path, file_name, file_size, content_type,
  type, subtype_id, uploaded_by, uploaded_at, updated_at
)
select
  md.id,
  md.organisation_id,
  'member'::text as owner_scope,
  md.member_id  as owner_id,
  md.storage_path,
  md.file_name,
  md.file_size,
  md.content_type,
  case md.document_category
    when 'absence_document' then 'attachment'
    else 'other'
  end as type,
  (
    select ds.id
    from public.document_subtype ds
    where ds.organisation_id = md.organisation_id
      and ds.type = case md.document_category
        when 'absence_document' then 'attachment'
        else 'other'
      end
    order by ds.sort_order
    limit 1
  ) as subtype_id,
  md.uploaded_by_member_id,
  md.created_at,
  md.created_at
from public.member_documents md
where not exists (
  select 1 from public.document d where d.id = md.id
);

-- ===========================================================================
-- 7. Storage bucket for org-scoped documents.
-- ===========================================================================
--
-- Private bucket; the app mediates every read/write via signed URLs
-- issued by the admin client after row-level auth checks.

insert into storage.buckets (id, name, public)
values ('org-documents', 'org-documents', false)
on conflict (id) do nothing;

commit;
