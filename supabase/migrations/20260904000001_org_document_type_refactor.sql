-- CLE-210 (Docs refactor) — Collapse the three legacy org-scope types
-- (`policy`, `handbook`, `other`) into one type: `organisation_document`.
--
-- Motivation: `policy | handbook | other` was an awkward hardcoded
-- grouping. Tenants think of "organisation documents" as a single
-- category and want to add their own subtypes (Data Protection Policy,
-- Fire Procedure, etc.) rather than being forced into three fixed
-- buckets. Employee Handbook seeds as the single default subtype.
--
-- Data migration:
--   * document_subtype rows with type in (policy, handbook, other) are
--     rewritten to type = 'organisation_document'.
--   * document rows likewise.
--   * The unique constraint (organisation_id, type, name) means
--     tenants with e.g. both a `policy` "General policy" and a
--     `handbook` "General policy" would collide after the rewrite.
--     Guarded below with a numeric suffix — extremely unlikely to
--     fire on Chris's data, but the migration stays safe if it does.
--
-- Seed:
--   * seed_document_subtypes_for_org rewritten to insert one
--     "Employee Handbook" subtype under organisation_document.
--   * Old policy/handbook/other seed lines removed.
--
-- Notes:
--   * document_subtype.type and document.type CHECKs both updated to
--     the new closed set. Old values are removed — they're now dead.
--   * ORG_TYPES in org-document-actions.ts must be updated to
--     Set(["organisation_document"]) in the same commit.

begin;

-- ---------------------------------------------------------------------------
-- 1. Collision guard — if the rewrite would clash within a tenant on
--    (organisation_id, type='organisation_document', name), suffix the
--    later rows with " (N)". Deterministic on primary key so re-runs
--    would produce the same output.
-- ---------------------------------------------------------------------------
do $$
declare
  r          record;
  new_name   text;
  suffix     int;
begin
  for r in
    with candidates as (
      select id, organisation_id, name,
             row_number() over (
               partition by organisation_id, name
               order by created_at asc, id asc
             ) as rn
      from public.document_subtype
      where type in ('policy', 'handbook', 'other')
    )
    select id, organisation_id, name, rn from candidates where rn > 1
  loop
    suffix := r.rn;
    new_name := r.name || ' (' || suffix || ')';
    -- If the suffixed name also exists, keep bumping.
    while exists (
      select 1 from public.document_subtype
      where organisation_id = r.organisation_id
        and type = 'organisation_document'
        and name = new_name
    ) loop
      suffix := suffix + 1;
      new_name := r.name || ' (' || suffix || ')';
    end loop;
    update public.document_subtype
      set name = new_name
      where id = r.id;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Drop the old CHECK constraints so the UPDATE can rewrite `type`
--    to the new value. Postgres enforces CHECK per-row-touched, so
--    trying to run the UPDATE against the pre-existing constraint
--    would fail with 23514.
-- ---------------------------------------------------------------------------
alter table public.document_subtype
  drop constraint if exists document_subtype_type_check;
alter table public.document
  drop constraint if exists document_type_check;

-- ---------------------------------------------------------------------------
-- 3. Rewrite the type column on both tables.
-- ---------------------------------------------------------------------------
update public.document_subtype
   set type = 'organisation_document'
 where type in ('policy', 'handbook', 'other');

update public.document
   set type = 'organisation_document'
 where type in ('policy', 'handbook', 'other');

-- ---------------------------------------------------------------------------
-- 4. Add the new CHECK constraints reflecting the closed set.
-- ---------------------------------------------------------------------------
alter table public.document_subtype
  add constraint document_subtype_type_check
  check (type in (
    'contract', 'certificate', 'evidence', 'attachment',
    'organisation_document'
  ));

alter table public.document
  add constraint document_type_check
  check (type in (
    'contract', 'certificate', 'evidence', 'attachment',
    'organisation_document'
  ));

-- ---------------------------------------------------------------------------
-- 4. Rewrite the seed function. Employee Handbook is the single
--    default subtype under organisation_document. Tenants add more
--    (Data Protection Policy, Fire Procedure, etc.) via the Settings
--    → Document Subtypes UI.
-- ---------------------------------------------------------------------------
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

  -- Evidence — Right-to-Work subtypes.
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

  -- Attachments — absence-attachment surfaces already in the app.
  insert into public.document_subtype
    (organisation_id, type, name, sort_order, retention_class, employee_can_upload)
  values
    (p_org_id, 'attachment', 'Self-certification', 1, 'absence_attachment', true),
    (p_org_id, 'attachment', 'Fit note',           2, 'absence_attachment', true),
    (p_org_id, 'attachment', 'Prescription',       3, 'absence_attachment', true),
    (p_org_id, 'attachment', 'Other',              4, 'absence_attachment', true)
  on conflict on constraint uq_document_subtype_org_type_name do nothing;

  -- Organisation Documents — Employee Handbook seeds; tenants add more.
  insert into public.document_subtype
    (organisation_id, type, name, sort_order, retention_class)
  values
    (p_org_id, 'organisation_document', 'Employee Handbook', 1, 'handbook')
  on conflict on constraint uq_document_subtype_org_type_name do nothing;
end;
$$;

commit;
