-- Migration: remove redundant holiday_profile_id from members
-- Holiday profile is derived from holiday_year_records instead
ALTER TABLE public.members DROP CONSTRAINT members_holiday_profile_id_fkey;
ALTER TABLE public.members DROP COLUMN holiday_profile_id;
