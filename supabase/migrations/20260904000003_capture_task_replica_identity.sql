-- CLE-211 follow-up — Realtime needs full row data on UPDATE events
-- so the RLS policy (queued_by_user_id = auth.uid()) can be evaluated
-- against the change payload. Without REPLICA IDENTITY FULL, only
-- the primary key is in the WAL entry and Realtime silently drops
-- the event.
--
-- Symptom: web dialog's "Waiting for photo…" subscription never
-- receives the `uploaded` status change even though the mobile
-- upload succeeded and the row is correctly updated.

alter table public.capture_task replica identity full;
