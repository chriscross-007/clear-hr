-- Migration: Booking violation flags (CLE-189)
--
-- Snapshot at submit time whether a booking was raised despite a notice
-- or team-cover warning. The Approvals page reads these flags to:
--   * Show a "Notice" / "Cover" badge next to Approve/Reject.
--   * Demand a confirm-on-approve when an admin is about to approve a
--     request that bypassed a rule.
--
-- Flags are snapshots — they capture the state at submit time and never
-- change afterwards (matches our approval-routing snapshot semantics).
-- Existing rows default to false; pre-feature requests therefore show no
-- badge, which is the correct read for them.

alter table public.holiday_bookings
  add column if not exists notice_violation_at_submit boolean not null default false,
  add column if not exists cover_violation_at_submit  boolean not null default false;
