-- CLE-236 — Simple in-app e-signature.
--
-- Spec: Spec Vault → specs/Documents/08 Document Signatures.md
--
-- 1. document_subtype.sign_off — 'none' | 'acknowledge' | 'sign'.
--    Replaces the "Requires acknowledgement" switch. requires_acknowledgement
--    is kept as a mirror (= sign_off = 'acknowledge') so every existing
--    acknowledgement reader keeps working unchanged; the app writes both.
--    'sign' is only allowed on Employment (contract) and Organisation
--    subtypes (enforced in the app layer, subtype-types.ts).
-- 2. document_subtype.default_signing_mode — the mode pre-selected in
--    "Send for signature" for Employment subtypes set to Sign.
-- 3. rights_profiles.can_sign_for_organisation — new flag. Seeded on for
--    every Admin-rank profile (existing and future default profiles).
-- 4. document.signed_request_id — set on the version produced by a
--    completed signature request (the "signed copy"). Read-only for good.
-- 5. document_signature_request + document_signature — the requests and
--    the per-signer evidence rows. Org documents use one 'audience'
--    request per document with one signature row per member who signs.
--    Reads and writes go through server actions on the service-role
--    client (same as the rest of the documents layer); RLS is enabled
--    with no policies so nothing is reachable from the browser directly.
--
-- Safe to run twice.

-- 1 + 2 -----------------------------------------------------------------

alter table public.document_subtype
  add column if not exists sign_off text not null default 'none',
  add column if not exists default_signing_mode text not null default 'member';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'chk_document_subtype_sign_off'
  ) then
    alter table public.document_subtype
      add constraint chk_document_subtype_sign_off
      check (sign_off in ('none', 'acknowledge', 'sign'));
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'chk_document_subtype_default_signing_mode'
  ) then
    alter table public.document_subtype
      add constraint chk_document_subtype_default_signing_mode
      check (default_signing_mode in ('member', 'company', 'member_then_company'));
  end if;
end $$;

-- Backfill from the old switch (only rows still on the default).
update public.document_subtype
   set sign_off = 'acknowledge'
 where requires_acknowledgement = true
   and sign_off = 'none';

-- 3 ---------------------------------------------------------------------

alter table public.rights_profiles
  add column if not exists can_sign_for_organisation boolean not null default false;

update public.rights_profiles
   set can_sign_for_organisation = true
 where rank = 'admin'
   and is_default = true
   and can_sign_for_organisation = false;

-- Future orgs: seed the flag on the default Admin profile. A plain
-- BEFORE INSERT trigger (no SECURITY DEFINER needed — it only edits NEW).
create or replace function public.trigger_seed_sign_for_organisation()
returns trigger
language plpgsql
as $$
begin
  if new.is_default = true and new.rank = 'admin' then
    new.can_sign_for_organisation := true;
  end if;
  return new;
end;
$$;

drop trigger if exists seed_sign_for_organisation on public.rights_profiles;
create trigger seed_sign_for_organisation
  before insert on public.rights_profiles
  for each row execute function public.trigger_seed_sign_for_organisation();

-- 5 (tables first, so document.signed_request_id can reference them) ----

create table if not exists public.document_signature_request (
  id                  uuid        primary key default gen_random_uuid(),
  organisation_id     uuid        not null references public.organisations(id) on delete cascade,
  document_id         uuid        not null references public.document(id) on delete restrict,
  mode                text        not null check (mode in ('member', 'company', 'member_then_company', 'audience')),
  status              text        not null default 'pending' check (status in ('pending', 'completed', 'declined', 'cancelled')),
  message             text        null check (message is null or length(message) <= 2000),
  document_hash       text        not null,
  created_by          uuid        null references public.members(id) on delete set null,
  created_at          timestamptz not null default now(),
  completed_at        timestamptz null,
  signed_document_id  uuid        null references public.document(id) on delete set null,
  cancelled_by        uuid        null references public.members(id) on delete set null,
  cancelled_at        timestamptz null,
  -- Denormalised so the request stays readable after the doc purges.
  document_file_name  text        not null,
  document_subtype_name text      not null
);

-- One open send-for-signature request per document. The 'audience'
-- request (org documents: every member in the audience signs) is a
-- standing campaign row, one per document, and doesn't count.
create unique index if not exists uq_document_signature_request_open
  on public.document_signature_request (document_id)
  where status = 'pending' and mode <> 'audience';

create unique index if not exists uq_document_signature_request_audience
  on public.document_signature_request (document_id)
  where mode = 'audience';

create index if not exists idx_document_signature_request_org_status
  on public.document_signature_request (organisation_id, status);

create table if not exists public.document_signature (
  id                  uuid        primary key default gen_random_uuid(),
  organisation_id     uuid        not null references public.organisations(id) on delete cascade,
  request_id          uuid        not null references public.document_signature_request(id) on delete restrict,
  document_id         uuid        not null references public.document(id) on delete restrict,
  role                text        not null check (role in ('member', 'company')),
  signer_member_id    uuid        not null references public.members(id) on delete restrict,
  status              text        not null default 'pending' check (status in ('waiting', 'pending', 'signed', 'declined')),
  sent_at             timestamptz null,   -- when this signer was asked (null while 'waiting')
  mark_type           text        null check (mark_type is null or mark_type in ('typed', 'drawn')),
  typed_name          text        null check (typed_name is null or length(typed_name) <= 200),
  mark_storage_path   text        null,
  signer_name         text        null,   -- full name at signing time
  signed_at           timestamptz null,
  ip                  inet        null,
  user_agent          text        null check (user_agent is null or length(user_agent) <= 500),
  document_hash       text        null,
  declined_reason     text        null check (declined_reason is null or length(declined_reason) <= 2000),
  created_at          timestamptz not null default now()
);

create unique index if not exists uq_document_signature_request_signer
  on public.document_signature (request_id, signer_member_id, role);

create index if not exists idx_document_signature_signer_status
  on public.document_signature (organisation_id, signer_member_id, status);

create index if not exists idx_document_signature_document
  on public.document_signature (document_id);

alter table public.document_signature_request enable row level security;
alter table public.document_signature enable row level security;

-- 4 ---------------------------------------------------------------------

alter table public.document
  add column if not exists signed_request_id uuid null
    references public.document_signature_request(id) on delete set null;

-- 6. Nightly email: signature reminders are logged like acknowledgement
--    reminders (kind 'member_sign').
alter table public.document_email_log drop constraint if exists chk_document_email_log_kind;
alter table public.document_email_log
  add constraint chk_document_email_log_kind
  check (kind in ('member_ack', 'member_expiry', 'member_sign'));

comment on column public.document_subtype.sign_off is
  'none | acknowledge | sign (CLE-236). requires_acknowledgement mirrors '
  'sign_off = ''acknowledge''. sign only on contract / organisation_document.';
comment on column public.document.signed_request_id is
  'Set on the signed copy produced by a completed document_signature_request (CLE-236).';
