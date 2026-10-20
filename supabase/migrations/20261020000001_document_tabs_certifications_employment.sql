-- CLE-231 — Member documents split into Certifications / Employment / Other.
--
-- Model (Chris, 2026-10-20):
--   • Certifications — documents the MEMBER supplies: Right to Work
--     evidence plus any certificate-type subtype the org requires of
--     that member. Only `certificate` subtypes can be marked
--     "Can be required" (trackable_per_member).
--   • Employment — documents the ORG supplies to the member (system type
--     `contract`, shown as "Employment"): contracts, reviews,
--     disciplinary. New per-subtype flag `visible_to_member` lets HR keep
--     e.g. investigation notes off the member's own view.
--   • Other — everything else (absence evidence, unrequired certificates).
--
-- No live data yet (dev only), so existing requirements on non-certificate
-- subtypes are simply removed. Idempotent.

alter table public.document_subtype
  add column if not exists visible_to_member boolean not null default true;

-- Only certificate subtypes may be required of a member.
update public.document_subtype
   set trackable_per_member = false
 where type <> 'certificate'
   and trackable_per_member = true;

delete from public.member_expected_document e
 using public.document_subtype s
 where s.id = e.subtype_id
   and s.type <> 'certificate';
