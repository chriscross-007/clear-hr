-- Merge the two default sick absence types ("Sick Paid" + "Sick Unpaid") into
-- a single default called "Sick". Runs idempotently: every step is gated on
-- the old names still existing, so re-running is a no-op once the merge is done.

-- Step 1 — Rename "Sick Paid" to "Sick" (keeps the same id, so nothing else
-- needs to change for orgs that only have absence_reasons under "Sick Paid").
UPDATE public.absence_types
SET name = 'Sick',
    updated_at = now()
WHERE name = 'Sick Paid'
  AND is_default = true;

-- Step 2 — Move every "Sick Unpaid" absence_reason over to the renamed "Sick"
-- type within the same organisation.
UPDATE public.absence_reasons AS ar
SET absence_type_id = sick.id,
    updated_at = now()
FROM public.absence_types AS sick_unpaid,
     public.absence_types AS sick
WHERE ar.absence_type_id = sick_unpaid.id
  AND sick_unpaid.name = 'Sick Unpaid'
  AND sick_unpaid.is_default = true
  AND sick.name = 'Sick'
  AND sick.is_default = true
  AND sick.organisation_id = sick_unpaid.organisation_id;

-- Step 3 — Clean up any absence_profiles pointed at "Sick Unpaid". Sick types
-- aren't tracked, so these should be empty, but RESTRICT FK would block the
-- later DELETE otherwise.
DELETE FROM public.absence_profiles AS ap
USING public.absence_types AS at
WHERE ap.absence_type_id = at.id
  AND at.name = 'Sick Unpaid'
  AND at.is_default = true;

-- Step 4 — Same for holiday_year_records. We can't simply reassign because of
-- the (member_id, absence_type_id, year_start) unique constraint, so delete.
DELETE FROM public.holiday_year_records AS hyr
USING public.absence_types AS at
WHERE hyr.absence_type_id = at.id
  AND at.name = 'Sick Unpaid'
  AND at.is_default = true;

-- Step 5 — With all FK references cleared, drop the "Sick Unpaid" type.
DELETE FROM public.absence_types
WHERE name = 'Sick Unpaid'
  AND is_default = true;

-- Step 6 — Update the seed function so new organisations get a single "Sick"
-- default instead of the Paid/Unpaid pair. Keeps is_paid=true as a sensible
-- starting point; admins can flip it per-org.
CREATE OR REPLACE FUNCTION seed_default_absence_types(org_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.absence_types
    (organisation_id, name, is_paid, requires_tracking,
     deducts_from_entitlement, requires_approval, is_default)
  VALUES
    (org_id, 'Annual Leave',        true,  true,  true,  true,  true),
    (org_id, 'Sick',                true,  false, false, false, true),
    (org_id, 'Compassionate Leave', true,  false, false, false, true)
  ON CONFLICT DO NOTHING;
END;
$$;
