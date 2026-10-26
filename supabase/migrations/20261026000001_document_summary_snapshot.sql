-- Admin documents summary becomes a snapshot of the admin dashboard
-- (2026-10-26). Instead of reporting only items new since the last
-- summary, each weekday it lists every member whose documents need
-- attention, the acknowledgement count and organisation documents —
-- the same numbers the dashboard shows — and marks members / org docs
-- that weren't in the previous summary as "New".
--
-- organisations.doc_digest_snapshot (jsonb, nullable) holds the previous
-- summary for "New" flags and the same-day re-run guard:
--   { "sentOn": "YYYY-MM-DD", "memberIds": [uuid…], "orgDocIds": [uuid…] }
--
-- The per-item `admin_item` rows in document_email_log are no longer
-- written or read; clear them. Safe to run twice.

alter table organisations
  add column if not exists doc_digest_snapshot jsonb;

delete from document_email_log where kind = 'admin_item';
