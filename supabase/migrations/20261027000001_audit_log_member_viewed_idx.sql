-- "{Member} viewed" column on a member's Documents page (2026-10-27).
-- loadMemberLastViewed (src/lib/document-member-views.ts) reads the newest
-- document.viewed / document.downloaded audit row per document for one actor.
-- This index keeps that lookup cheap as audit_log grows. Safe to re-run;
-- the feature works without it (just slower on large logs).

create index if not exists audit_log_actor_target_created_idx
  on public.audit_log (actor_id, target_id, created_at desc);
