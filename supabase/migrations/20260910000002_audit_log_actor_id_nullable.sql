-- CLE-212 follow-up — allow `audit_log.actor_id` to be NULL so system-
-- generated audit rows can be recorded.
--
-- The nightly document sweep (purge / expiry / overdue review) has no
-- human actor. It set `actor_name = 'System (nightly sweep)'` and
-- `actor_id = null`, but the column had a NOT NULL constraint from an
-- older era when every audit row was tied to a signed-in member. That
-- blocked every sweep-authored event from ever landing in the log.
--
-- The FK on actor_id (if any) tolerates NULL naturally, and every
-- reader path already treats actor_id as optional (see
-- audit-client.tsx, which falls back to `actor_name` for display).

alter table public.audit_log
  alter column actor_id drop not null;
