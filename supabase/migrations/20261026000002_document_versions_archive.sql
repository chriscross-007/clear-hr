-- CLE-233 — Document versions + Archive.
--
-- * archived_at / archived_by — an archived document is "was valid, keep
--   the record": read-only, hidden from members, never counted as needing
--   attention or acknowledgement. Different from Trash (disposal_queue),
--   which is "shouldn't exist" and is purged after 30 days. Restoring
--   clears both columns.
-- * supersedes_document_id — set on a new version, pointing at the version
--   it replaced (which is archived at the same moment). The "replaced by"
--   link is the reverse lookup.
-- * version_number — 1 for every existing / freshly uploaded document;
--   a new version is previous + 1.
--
-- Archive applies to organisation documents, Employment (contract)
-- documents, Certificates and RTW evidence; new versions to organisation
-- and Employment documents (enforced in the app layer).
--
-- Safe to run twice.

alter table document
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references members(id) on delete set null,
  add column if not exists supersedes_document_id uuid references document(id) on delete set null,
  add column if not exists version_number integer not null default 1;

create index if not exists document_supersedes_idx on document (supersedes_document_id);
create index if not exists document_archived_idx on document (organisation_id, archived_at);
