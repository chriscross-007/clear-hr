-- CLE-194 (cont) — user-controlled sort_order on every profile type.
--
-- Adds a `sort_order int NOT NULL DEFAULT 0` column to each profile table
-- so admins can drag-reorder profiles in the Settings → Profiles tabs.
-- Existing rows are backfilled per org with row_number(), preserving the
-- current alphabetical ordering as the initial sort_order.
--
-- For tables with `is_default` (notice_period_profiles, approval_profiles),
-- the Default profile gets sort_order = 0 (pinned at the top). New rows
-- default to sort_order = 0 too; the matching `create...` server actions
-- assign max(sort_order) + 1 so new profiles append to the end.

ALTER TABLE public.admin_profiles            ADD COLUMN sort_order int NOT NULL DEFAULT 0;
ALTER TABLE public.employee_profiles         ADD COLUMN sort_order int NOT NULL DEFAULT 0;
ALTER TABLE public.work_profiles             ADD COLUMN sort_order int NOT NULL DEFAULT 0;
ALTER TABLE public.notice_period_profiles    ADD COLUMN sort_order int NOT NULL DEFAULT 0;
ALTER TABLE public.approval_profiles         ADD COLUMN sort_order int NOT NULL DEFAULT 0;

-- admin_profiles: alphabetical within org
WITH ranked AS (
  SELECT id, row_number() OVER (PARTITION BY organisation_id ORDER BY name) - 1 AS so
  FROM public.admin_profiles
)
UPDATE public.admin_profiles t SET sort_order = r.so
FROM ranked r WHERE r.id = t.id;

-- employee_profiles: alphabetical within org
WITH ranked AS (
  SELECT id, row_number() OVER (PARTITION BY organisation_id ORDER BY name) - 1 AS so
  FROM public.employee_profiles
)
UPDATE public.employee_profiles t SET sort_order = r.so
FROM ranked r WHERE r.id = t.id;

-- work_profiles: only org-level profiles (member_id IS NULL) appear in
-- the Settings list. Per-member rows are individual assignments — their
-- sort_order is irrelevant but we set them in the same batch for simplicity.
WITH ranked AS (
  SELECT id, row_number() OVER (PARTITION BY organisation_id ORDER BY name) - 1 AS so
  FROM public.work_profiles
)
UPDATE public.work_profiles t SET sort_order = r.so
FROM ranked r WHERE r.id = t.id;

-- notice_period_profiles: Default pinned at 0, rest alphabetical
WITH ranked AS (
  SELECT id, row_number() OVER (PARTITION BY organisation_id ORDER BY is_default DESC, name) - 1 AS so
  FROM public.notice_period_profiles
)
UPDATE public.notice_period_profiles t SET sort_order = r.so
FROM ranked r WHERE r.id = t.id;

-- approval_profiles: Default pinned at 0, rest alphabetical
WITH ranked AS (
  SELECT id, row_number() OVER (PARTITION BY organisation_id ORDER BY is_default DESC, name) - 1 AS so
  FROM public.approval_profiles
)
UPDATE public.approval_profiles t SET sort_order = r.so
FROM ranked r WHERE r.id = t.id;

COMMENT ON COLUMN public.admin_profiles.sort_order            IS 'User-controlled display order in Settings → Profiles → Rights.';
COMMENT ON COLUMN public.employee_profiles.sort_order         IS 'User-controlled display order in Settings → Profiles → Rights.';
COMMENT ON COLUMN public.work_profiles.sort_order             IS 'User-controlled display order in Settings → Profiles → Working Patterns. Only meaningful for org-level rows (member_id IS NULL).';
COMMENT ON COLUMN public.notice_period_profiles.sort_order    IS 'User-controlled display order in Settings → Profiles → Holiday Notice. Default profile is pinned at the top by the read query.';
COMMENT ON COLUMN public.approval_profiles.sort_order         IS 'User-controlled display order in Settings → Profiles → Holiday Approval. Default profile is pinned at the top by the read query.';
