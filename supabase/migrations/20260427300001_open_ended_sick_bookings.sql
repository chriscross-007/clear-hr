-- CLE-148: Open-ended sick bookings
-- Allow end_date to be null for sick-type absence bookings.
-- When end_date is null the booking is "open" — the employee is still off sick.
-- The calendar renders projected days virtually (no extra DB rows).

-- 1. Make end_date nullable
alter table public.holiday_bookings
  alter column end_date drop not null;

-- 2. Replace the old check constraint with one that allows null end_date
--    (when end_date IS NOT NULL it must still be >= start_date).
alter table public.holiday_bookings
  drop constraint chk_end_date_gte_start_date;

alter table public.holiday_bookings
  add constraint chk_end_date_gte_start_date
    check (end_date is null or end_date >= start_date);
