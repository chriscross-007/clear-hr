-- Migration: add allowance and measurement_mode to absence_profiles
alter table public.absence_profiles
  add column allowance numeric not null default 0,
  add column measurement_mode text not null default 'days'
    check (measurement_mode in ('days', 'hours'));
