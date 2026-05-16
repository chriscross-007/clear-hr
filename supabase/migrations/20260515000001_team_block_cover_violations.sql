-- CLE-194 (cont) — split block-on-cover from the notice profile.
--
-- Previously the org-level `notice_rules_block_requests` flag governed
-- BOTH "block on notice rule breach" AND "block on cover rule breach".
-- CLE-194 moved Notice to `notice_period_profiles.block_requests` (per
-- profile, per booking author). This migration finishes the split by
-- giving the Cover side its own per-team flag.
--
-- Backfill copies the org-level flag onto each team so existing
-- behaviour is preserved on first deploy.

ALTER TABLE public.teams
  ADD COLUMN block_cover_violations boolean NOT NULL DEFAULT false;

UPDATE public.teams t
SET block_cover_violations = COALESCE(o.notice_rules_block_requests, false)
FROM public.organisations o
WHERE o.id = t.organisation_id;

COMMENT ON COLUMN public.teams.block_cover_violations IS
  'CLE-194 — when TRUE, the server hard-rejects holiday requests that would drop this team below its min_cover. When FALSE, the booking is accepted and the breach surfaces as an advisory cover warning. Independent of the notice profile''s block_requests flag.';
