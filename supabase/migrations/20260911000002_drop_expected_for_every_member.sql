-- CLE-215 — Drop `document_subtype.expected_for_every_member`.
--
-- The flag was a blunt instrument: turn it on and every member in
-- the org shows a not_uploaded row on the compliance dashboard for
-- that subtype. In practice it produced noisy false-positives (a
-- British member flagged as missing "Visa" and "BRP" because those
-- are also expected_for_every_member RTW subtypes) and it couldn't
-- express "this member needs at least one of the following".
--
-- Replacement:
--   * Per-member expectations move to the existing
--     `member_expected_document` table (populated via the
--     Employment tab card, or Bulk Edit on the Employees Directory).
--   * Right-to-Work becomes a *category* expectation: any member
--     whose `rtw_not_required = false` needs at least one non-
--     expired doc of a subtype whose `retention_class` is
--     `right_to_work`. This is handled at the read/render layer and
--     doesn't rely on any per-subtype flag.
--
-- Backfill rule:
--   * For each subtype with expected_for_every_member = true AND
--     retention_class != 'right_to_work', insert
--     `member_expected_document` rows for every active member in
--     that org. Preserves current behaviour without the blunt flag.
--   * RTW-class subtypes are deliberately NOT backfilled — the RTW
--     aggregate row on the Required Documents card + compliance
--     dashboard covers them.

-- ---------------------------------------------------------------------
-- 1. Backfill from non-RTW flagged subtypes
-- ---------------------------------------------------------------------
insert into public.member_expected_document (organisation_id, member_id, subtype_id, added_by)
select
  s.organisation_id,
  m.id,
  s.id,
  null
from public.document_subtype s
join public.members m
  on m.organisation_id = s.organisation_id
where s.expected_for_every_member = true
  and s.retention_class <> 'right_to_work'
on conflict (member_id, subtype_id) do nothing;

-- ---------------------------------------------------------------------
-- 2. Drop the column
-- ---------------------------------------------------------------------
alter table public.document_subtype
  drop column if exists expected_for_every_member;
