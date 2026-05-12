-- Migration: Backfill booking audit_log target_labels with date ranges
--
-- Older audit rows for booking events store target_label as
-- "MemberName — ReasonName" without dates. New entries (CLE-184) append
-- the booking's date range. This backfills existing rows where possible.
--
-- Strategy: derive start_date and end_date by trying, in order:
--   1. changes->'start_date'->>'new' / changes->'end_date'->>'new'
--      (covers booking.submitted, booking.updated, booking.resubmitted,
--      booking.created)
--   2. changes->'start_date'->>'old' / changes->'end_date'->>'old'
--      (covers booking.deleted where 'new' is null but 'old' has the value)
--   3. JOIN holiday_bookings on target_id (covers approved/rejected/cancelled
--      where changes don't include the dates and the booking still exists)
--
-- Rows whose target_label already contains '(' are skipped (assumed to have a
-- date appended already). Rows where no source can resolve the start_date
-- are left unchanged (e.g. deleted booking with audit predating the
-- 'changes' diff that captured them).

with candidates as (
  select
    al.id,
    al.target_label,
    coalesce(
      nullif(al.changes->'start_date'->>'new', '')::date,
      nullif(al.changes->'start_date'->>'old', '')::date,
      hb.start_date
    ) as start_date,
    coalesce(
      nullif(al.changes->'end_date'->>'new', '')::date,
      nullif(al.changes->'end_date'->>'old', '')::date,
      hb.end_date
    ) as end_date
  from public.audit_log al
  left join public.holiday_bookings hb on hb.id = al.target_id
  where al.target_type = 'booking'
    and al.target_label is not null
    and al.target_label not like '%(%'
)
update public.audit_log al
set target_label = candidates.target_label || ' (' ||
  case
    when candidates.end_date is null
      then 'from ' || to_char(candidates.start_date, 'FMDD Mon YYYY')
    when candidates.start_date = candidates.end_date
      then to_char(candidates.start_date, 'FMDD Mon YYYY')
    else to_char(candidates.start_date, 'FMDD Mon YYYY')
         || ' – '
         || to_char(candidates.end_date, 'FMDD Mon YYYY')
  end || ')'
from candidates
where al.id = candidates.id
  and candidates.start_date is not null;
