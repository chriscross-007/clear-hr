-- Migration: revert day_type from absence_reasons (CLE-94 rollback)

-- Remove seeded AM and PM default reasons
DELETE FROM public.absence_reasons
WHERE is_default = true AND day_type IN ('am', 'pm');

-- Drop column (removes check constraint automatically)
ALTER TABLE public.absence_reasons DROP COLUMN day_type;

-- Restore seed function without per-reason seeding
CREATE OR REPLACE FUNCTION seed_default_absence_types(org_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.absence_types
    (organisation_id, name, is_paid, requires_tracking, deducts_from_entitlement, requires_approval, is_default)
  VALUES
    (org_id, 'Annual Leave',        true,  true,  true,  true,  true),
    (org_id, 'Sick Paid',           true,  false, false, false, true),
    (org_id, 'Sick Unpaid',         false, false, false, false, true),
    (org_id, 'Compassionate Leave', true,  false, false, false, true)
  ON CONFLICT DO NOTHING;
END;
$$;
