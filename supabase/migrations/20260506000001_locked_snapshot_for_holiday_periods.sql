-- CLE-172 — Lock freezes the Holiday Period chain.
--
-- Adds a JSONB snapshot column that captures a Holiday Period's
-- ComputedPeriodValues at the moment of locking. The compute helper uses
-- snapshot.carryForward as the broughtForward of the next period when
-- present, isolating later periods from upstream edits.
--
-- We deliberately do NOT add a CHECK linking `locked` to `locked_snapshot`:
-- existing locked rows pre-date this column and will have NULL snapshots.
-- The compute helper falls back to live computation in that case (legacy
-- behaviour). Admin can opt those rows into the new behaviour by unlocking
-- and re-locking them.

ALTER TABLE holiday_periods
  ADD COLUMN IF NOT EXISTS locked_snapshot JSONB NULL;

COMMENT ON COLUMN holiday_periods.locked_snapshot IS
  'Frozen ComputedPeriodValues at the moment this period was locked. NULL when unlocked. When present, computeAllHolidayPeriodValues emits the snapshot directly for this row and uses snapshot.carryForward as the broughtForward of the next period — isolating later periods from upstream edits.';
