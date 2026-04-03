-- Migration: add holiday_profile_id FK to members
alter table public.members
  add column holiday_profile_id uuid references public.absence_profiles(id);
