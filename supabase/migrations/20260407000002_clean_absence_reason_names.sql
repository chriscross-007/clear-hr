-- Migration: strip " (Full Day)" suffix from default absence reason names

UPDATE public.absence_reasons
SET name = LEFT(name, LENGTH(name) - 11)
WHERE is_default = true
  AND name LIKE '% (Full Day)';
