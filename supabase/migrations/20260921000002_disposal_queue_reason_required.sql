-- CLE-226 — Broaden the meaning of disposal_queue.force_delete_reason
-- from "retention-override justification" to "reason for delete, full
-- stop". Column type + nullability unchanged (auto-deletes on Replace
-- still write a system-generated reason; historic rows with NULL from
-- the pre-CLE-226 era remain valid). Enforcement of "reason required"
-- moves to the app layer in softDeleteMemberDocument.
COMMENT ON COLUMN public.disposal_queue.force_delete_reason IS
  'Reason for the deletion. Free-text, 3..500 chars for user-initiated
   deletes; system-generated for auto-deletes on Replace flows.
   Nullable for legacy rows and for auto-deletes that predate CLE-226.';
