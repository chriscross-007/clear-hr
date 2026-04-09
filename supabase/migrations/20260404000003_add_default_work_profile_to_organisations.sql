-- Migration: add default_work_profile_id to organisations
alter table public.organisations
  add column default_work_profile_id uuid references public.work_profiles(id);
