-- Migration: add is_deprecated flag to absence_reasons
alter table public.absence_reasons
  add column is_deprecated boolean not null default false;
