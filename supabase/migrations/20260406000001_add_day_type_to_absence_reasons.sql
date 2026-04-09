-- Migration: add day_type to absence_reasons and seed default reasons per type

-- Add column
ALTER TABLE public.absence_reasons
  ADD COLUMN day_type text NOT NULL DEFAULT 'full_day'
  CHECK (day_type IN ('full_day', 'am', 'pm'));

-- Set existing reasons to full_day (already the default, but explicit)
UPDATE public.absence_reasons SET day_type = 'full_day' WHERE day_type IS NULL;

-- Seed default reasons for each default absence type that doesn't have them yet
-- For each org's default absence types, ensure 3 reasons exist: Full Day, AM, PM
INSERT INTO public.absence_reasons (organisation_id, absence_type_id, name, day_type, is_default, colour)
SELECT
  at.organisation_id,
  at.id,
  at.name || ' (' || v.label || ')',
  v.day_type,
  true,
  v.colour
FROM public.absence_types at
CROSS JOIN (
  VALUES
    ('full_day', 'Full Day', '#6366f1'),
    ('am', 'AM', '#8b5cf6'),
    ('pm', 'PM', '#a78bfa')
) AS v(day_type, label, colour)
WHERE at.is_default = true
AND NOT EXISTS (
  SELECT 1 FROM public.absence_reasons ar
  WHERE ar.absence_type_id = at.id
    AND ar.organisation_id = at.organisation_id
    AND ar.day_type = v.day_type
    AND ar.is_default = true
);

-- Update the seed function for new orgs
CREATE OR REPLACE FUNCTION seed_default_absence_types(org_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_type_id uuid;
  v_type_name text;
BEGIN
  -- Insert default absence types
  INSERT INTO public.absence_types
    (organisation_id, name, is_paid, requires_tracking, deducts_from_entitlement, requires_approval, is_default)
  VALUES
    (org_id, 'Annual Leave',        true,  true,  true,  true,  true),
    (org_id, 'Sick Paid',           true,  false, false, false, true),
    (org_id, 'Sick Unpaid',         false, false, false, false, true),
    (org_id, 'Compassionate Leave', true,  false, false, false, true)
  ON CONFLICT DO NOTHING;

  -- For each default type, seed 3 default reasons (Full Day, AM, PM)
  FOR v_type_id, v_type_name IN
    SELECT id, name FROM public.absence_types
    WHERE organisation_id = org_id AND is_default = true
  LOOP
    INSERT INTO public.absence_reasons
      (organisation_id, absence_type_id, name, day_type, is_default, colour)
    VALUES
      (org_id, v_type_id, v_type_name || ' (Full Day)', 'full_day', true, '#6366f1'),
      (org_id, v_type_id, v_type_name || ' (AM)',       'am',       true, '#8b5cf6'),
      (org_id, v_type_id, v_type_name || ' (PM)',       'pm',       true, '#a78bfa')
    ON CONFLICT DO NOTHING;
  END LOOP;
END;
$$;
