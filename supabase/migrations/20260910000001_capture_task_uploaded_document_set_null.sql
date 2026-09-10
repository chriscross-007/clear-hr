-- CLE-212 follow-up — the nightly purge sweep couldn't delete a document
-- row when a capture_task pointed at it via uploaded_document_id, since
-- that FK was created without an ON DELETE rule (default NO ACTION).
--
--   ERROR:  update or delete on table "document" violates foreign key
--   constraint "capture_task_uploaded_document_id_fkey" on table
--   "capture_task"
--
-- Fix: replace the FK with ON DELETE SET NULL. The capture_task row is
-- a historical record of the queued-and-uploaded job (subtype, target,
-- note, timestamps); when the resulting document is eventually purged
-- 30 days after being moved to Trash, the task's pointer should just
-- become NULL. Deleting the task itself would lose useful audit
-- history for no gain.

alter table public.capture_task
  drop constraint if exists capture_task_uploaded_document_id_fkey;

alter table public.capture_task
  add constraint capture_task_uploaded_document_id_fkey
  foreign key (uploaded_document_id)
  references public.document(id)
  on delete set null;
