-- Migration: split "Sick" into "Sick Paid" and "Sick Unpaid"

-- Step 1: Rename existing "Sick" default records to "Sick Paid"
UPDATE public.absence_types
SET name = 'Sick Paid', is_paid = true
WHERE name = 'Sick' AND is_default = true;

-- Step 2: Insert "Sick Unpaid" for every org that has "Sick Paid" but not "Sick Unpaid"
INSERT INTO public.absence_types
  (organisation_id, name, is_paid, requires_tracking, deducts_from_entitlement, requires_approval, is_default)
SELECT organisation_id, 'Sick Unpaid', false, false, false, false, true
FROM public.absence_types
WHERE name = 'Sick Paid' AND is_default = true
AND NOT EXISTS (
  SELECT 1 FROM public.absence_types at2
  WHERE at2.organisation_id = absence_types.organisation_id
    AND at2.name = 'Sick Unpaid' AND at2.is_default = true
);

-- Step 3: Update the seed function for new orgs going forward
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
