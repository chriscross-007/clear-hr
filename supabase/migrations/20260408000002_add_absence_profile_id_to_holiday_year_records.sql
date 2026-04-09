-- Migration: add absence_profile_id to holiday_year_records
-- Needed to distinguish which specific profile was used when multiple profiles
-- share the same absence_type_id
ALTER TABLE public.holiday_year_records
  ADD COLUMN absence_profile_id uuid REFERENCES public.absence_profiles(id);
