-- Migration: add bank holiday handling setting to organisations
alter table public.organisations
  add column bank_holiday_handling text not null default 'additional'
    check (bank_holiday_handling in ('additional', 'deducted'));
