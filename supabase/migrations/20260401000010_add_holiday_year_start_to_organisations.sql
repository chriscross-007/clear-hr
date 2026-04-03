-- Migration: add holiday year start settings to organisations
alter table public.organisations
  add column holiday_year_start_type text not null default 'fixed'
    check (holiday_year_start_type in ('fixed', 'employee_start_date')),
  add column holiday_year_start_day integer default 1,
  add column holiday_year_start_month integer default 1;
