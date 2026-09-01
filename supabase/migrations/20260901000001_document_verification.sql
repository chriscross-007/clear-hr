-- CLE-207 / CLE-204c — Verification workflow support.
--
-- The `document` verification columns (verified_on, verified_by,
-- verification_notes, next_review_on) already exist from CLE-205's
-- foundation migration. This slice only adds the Employee-Records-
-- level `rtw_not_required` opt-out (per the Right to Work worked
-- example in the Spec Vault). Owned by Employee Records but wired
-- here so the compliance dashboard's RTW filter can respect it.

begin;

alter table public.members
  add column if not exists rtw_not_required        boolean not null default false,
  add column if not exists rtw_not_required_reason text;

-- Mirror flag on the shape returned by any consumer that reads
-- SELECT * on members — the app-side layer already imports the whole
-- row, so tsc catches drift automatically. No further RLS work; the
-- existing members policies cover these columns implicitly.

commit;
