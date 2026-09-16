-- CLE-218 follow-up — Drop `default_expiry_months` from document_subtype.
--
-- The auto-derive semantics on upload (today + N months) fabricated an
-- `expires_on` that was very unlikely to match the actual document
-- expiry, so admins couldn't trust the value. Removed in favour of the
-- admin entering the real date via the Expiry pencil after upload.
--
-- Column is nullable + has no dependent constraints, so a straight
-- DROP is safe. Any historical value is discarded.

ALTER TABLE document_subtype DROP COLUMN IF EXISTS default_expiry_months;
