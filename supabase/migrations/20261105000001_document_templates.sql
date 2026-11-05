-- CLE-237 — Document templates (merge fields → PDF).
--
-- Spec: Spec Vault → specs/Documents/09 Document Templates.md
--
-- 1. document_template — one row per named template per org. Produces
--    documents of one subtype (the "kind").
-- 2. document_template_version — each uploaded .docx. A generated
--    document records the exact version that produced it.
-- 3. document.generated_from_template_version_id + generation_values —
--    provenance on the generated member document (ask.* answers and
--    one-off overrides; never written back to the member).
-- 4. Private storage bucket `document-templates` for the .docx files.
--
-- Reads and writes go through server actions on the service-role
-- client; RLS is enabled with no policies so nothing is reachable from
-- the browser directly (same as document_signature_request).
--
-- Safe to run twice.

-- 1 ---------------------------------------------------------------------

create table if not exists public.document_template (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  name text not null,
  subtype_id uuid not null references public.document_subtype(id),
  archived_at timestamptz,
  created_by uuid references public.members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_document_template_org
  on public.document_template (organisation_id);

-- Name unique among live templates in an org.
create unique index if not exists uq_document_template_org_name_live
  on public.document_template (organisation_id, lower(name))
  where archived_at is null;

alter table public.document_template enable row level security;

-- 2 ---------------------------------------------------------------------

create table if not exists public.document_template_version (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.document_template(id) on delete cascade,
  version_number int not null,
  storage_path text not null,
  file_name text not null,
  file_size bigint not null default 0,
  fields jsonb not null default '[]'::jsonb,
  uploaded_by uuid references public.members(id) on delete set null,
  uploaded_at timestamptz not null default now(),
  unique (template_id, version_number)
);

alter table public.document_template_version enable row level security;

-- 3 ---------------------------------------------------------------------

alter table public.document
  add column if not exists generated_from_template_version_id uuid
    references public.document_template_version(id) on delete set null,
  add column if not exists generation_values jsonb;

-- 4 ---------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('document-templates', 'document-templates', false)
on conflict (id) do nothing;
