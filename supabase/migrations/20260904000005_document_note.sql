-- CLE-211 follow-up — persist the free-text note from the Add
-- Document dialog onto the document row so it survives the Photo
-- upload and shows up in Edit Metadata.
--
-- Previously the note lived only on capture_task and was lost when
-- the task terminated. Chris wants the note as document metadata.

alter table public.document
  add column if not exists note text
    check (note is null or length(note) <= 240);
