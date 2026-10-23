-- CLE-234 — Separate Verify, Review and Expiry.
--
-- Verify only applies to documents a member can supply (certificate,
-- evidence / RTW, attachment / Other). Employment (`contract`) and
-- Organisation (`organisation_document`) documents are issued by the
-- organisation, so "requires verification" is switched off for them.
--
-- `review_period_months` stays: NULL = None (ad hoc reviews). Existing
-- `verified_on` / `next_review_on` values on documents are kept as-is.
-- Verifying no longer touches `next_review_on` (app change); new
-- documents get `next_review_on` seeded from the interval on upload.
--
-- Safe to run twice.

update document_subtype
   set requires_verification = false
 where requires_verification = true
   and type in ('contract', 'organisation_document');

-- Non-positive intervals are meaningless; normalise to None.
update document_subtype
   set review_period_months = null
 where review_period_months is not null
   and review_period_months <= 0;
