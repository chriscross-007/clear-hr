-- Migration: add employee_note to holiday_bookings
alter table public.holiday_bookings add column employee_note text;
