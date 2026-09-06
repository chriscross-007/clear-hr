-- CLE-211a — Foundation for Remote Camera Capture.
--
-- Creates the `capture_task` table that bridges HR's web session and
-- HR's own paired mobile app. HR clicks "Photo" on the web-side "Add
-- Document" dialog → a task row is inserted → the mobile app,
-- subscribed via Supabase Realtime on the caller's own user id, sees
-- it appear in its pending-tasks list. HR takes the shot, uploads,
-- and the row transitions to `uploaded` — Realtime fires back to the
-- web dialog which closes automatically.
--
-- Ad-hoc mobile-initiated captures do NOT create a task row — they
-- go straight through a separate upload endpoint. See the spec at
-- specs/Documents/Remote Camera Capture.md for the full flow.
--
-- Nothing user-visible from this migration alone; the web dialog and
-- mobile endpoints land in CLE-211b/c/d.

begin;

-- ---------------------------------------------------------------------------
-- 1. Table
-- ---------------------------------------------------------------------------
create table if not exists public.capture_task (
  id                     uuid        primary key default gen_random_uuid(),
  organisation_id        uuid        not null references public.organisations(id) on delete cascade,
  -- auth.users id of whoever queued the task. Every read/write RLS
  -- policy keys on this — the caller's own user id must match, so
  -- another admin (even in the same org) can't see or act on it.
  queued_by_user_id      uuid        not null,
  -- Convenience pointer to the caller's members row so joins for
  -- display ("Queued by Chris Smith") don't need a second lookup
  -- through auth.users.
  queued_by_member_id    uuid        not null references public.members(id),
  target_member_id       uuid        not null references public.members(id) on delete cascade,
  subtype_id             uuid        not null references public.document_subtype(id),
  expires_on             date,
  note                   text        check (note is null or length(note) <= 240),
  status                 text        not null default 'pending' check (status in (
    'pending', 'uploaded', 'cancelled', 'timeout'
  )),
  expires_at             timestamptz not null,
  uploaded_at            timestamptz,
  cancelled_at           timestamptz,
  uploaded_document_id   uuid        references public.document(id),
  created_at             timestamptz not null default now()
);

-- Partial index: mobile "list my pending tasks" is the hot query.
create index if not exists idx_capture_task_queued_by_pending
  on public.capture_task(queued_by_user_id, created_at asc)
  where status = 'pending';

-- Partial index: the timeout sweep walks pending rows past expires_at.
create index if not exists idx_capture_task_sweep
  on public.capture_task(expires_at)
  where status = 'pending';

-- ---------------------------------------------------------------------------
-- 2. RLS — scoped strictly to the queuing user's own tasks. No other
--    user (not even admins in the same org, not even the target
--    member) has any visibility.
-- ---------------------------------------------------------------------------
alter table public.capture_task enable row level security;

drop policy if exists capture_task_select on public.capture_task;
create policy capture_task_select on public.capture_task
  for select to authenticated
  using (queued_by_user_id = (select auth.uid()));

drop policy if exists capture_task_insert on public.capture_task;
create policy capture_task_insert on public.capture_task
  for insert to authenticated
  with check (queued_by_user_id = (select auth.uid()));

drop policy if exists capture_task_update on public.capture_task;
create policy capture_task_update on public.capture_task
  for update to authenticated
  using (queued_by_user_id = (select auth.uid()))
  with check (queued_by_user_id = (select auth.uid()));

-- No DELETE policy — rows are retained for audit and purged by a
-- future retention job (spec §Open items — 12 months proposed).

-- ---------------------------------------------------------------------------
-- 3. Realtime — enable INSERT/UPDATE broadcast on the table so the
--    mobile app + web dialog see state transitions live.
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table public.capture_task;

commit;
