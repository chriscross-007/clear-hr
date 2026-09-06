-- CLE-211 follow-up — capture_source column on `document`. Tracks
-- whether the file arrived via the web-side "Upload" file picker or
-- via a mobile photo capture (either web-queued or mobile ad-hoc).
--
-- The grid renders this as a small icon column so HR can tell at a
-- glance which docs came from a scan vs a phone snap. Auditing
-- already carries this info in audit_log metadata; the column
-- surfaces it back on the row for display.

alter table public.document
  add column if not exists capture_source text not null default 'upload'
    check (capture_source in ('upload', 'photo'));

-- Backfill existing rows to 'upload' (already the default, but
-- belt-and-braces if anything sat in the schema between two ALTERs).
update public.document set capture_source = 'upload' where capture_source is null;
