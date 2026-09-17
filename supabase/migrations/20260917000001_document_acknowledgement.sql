-- CLE-219 — Document Acknowledgement (Ticket A: schema + rename).
--
-- See spec: C:\Lifeboat\Halo\Spec Vault\specs\Documents\Document Acknowledgement.md
--
-- This migration:
-- 1. Renames `document_subtype.requires_signature` → `requires_acknowledgement`.
--    The two names referred to the same idea; the spec unifies on the
--    honest "acknowledgement" label (a click confirming "I've read
--    this") rather than "signature" (which implies weightier legal
--    meaning we don't provide until Tier 3 qualified e-sign).
-- 2. Creates the `document_acknowledgement` table — single source of
--    truth for both member-doc and org-doc acknowledgements.
-- 3. Wires RLS so a Member can only insert their own ack row.
-- 4. Adds indexes for the two hot-path queries (per-member outstanding,
--    per-doc coverage).
--
-- No app-layer wiring in this migration; Ticket B ships the server
-- actions that read + write. The table starts empty and grows only
-- once the acknowledge button is wired up.
--
-- FK ON DELETE RESTRICT on `document_id` and `member_id`: ack rows
-- outlive their subjects by the retention_class window. Documents
-- and members transition through soft-delete / archive rather than
-- hard delete; if a hard delete is ever attempted while ack rows
-- exist, RESTRICT surfaces the design invariant loudly.

-- ---------------------------------------------------------------------------
-- 1. Column rename on `document_subtype`
-- ---------------------------------------------------------------------------

alter table public.document_subtype
  rename column requires_signature to requires_acknowledgement;

comment on column public.document_subtype.requires_acknowledgement is
  'When true, docs of this subtype require an acknowledgement from '
  'their target Member(s) — member-scope docs need the owner to ack; '
  'org-scope docs need every Live Member with documents.view to ack. '
  'See spec: Document Acknowledgement capability (CLE-219).';

-- ---------------------------------------------------------------------------
-- 2. `document_acknowledgement` table
-- ---------------------------------------------------------------------------
--
-- Single row per (document_id, member_id). Denormalised
-- `document_file_name` and `document_subtype_name` are stamped at
-- write time so the row remains renderable after the doc itself
-- purges — the row is a receipt in its own right.

create table if not exists public.document_acknowledgement (
  id                          uuid        primary key default gen_random_uuid(),
  organisation_id             uuid        not null references public.organisations(id) on delete cascade,
  document_id                 uuid        not null references public.document(id) on delete restrict,
  member_id                   uuid        not null references public.members(id) on delete restrict,
  acknowledged_at             timestamptz not null default now(),
  ip                          inet        null,
  user_agent                  text        null check (user_agent is null or length(user_agent) <= 500),
  document_version_hash       text        null,
  -- Denormalised — filled by the acknowledgeDocument server action
  -- at insert time from the referenced doc row.
  document_file_name          text        not null,
  document_subtype_name       text        not null,
  -- Stamped by Replace (CLE-217 follow-up) when a doc's bytes change.
  -- Non-null means "this ack referred to a file that has since been
  -- replaced — evidence stays, but coverage no longer counts it".
  superseded_by_replace_at    timestamptz null
);

-- One ack per Member per doc.
create unique index if not exists uq_document_acknowledgement_doc_member
  on public.document_acknowledgement (document_id, member_id);

-- Hot-path: "docs this Member has outstanding" — starts from
-- member_id and joins to `document` for the requires-ack docs the
-- member is expected to acknowledge.
create index if not exists idx_document_acknowledgement_org_member
  on public.document_acknowledgement (organisation_id, member_id);

-- Hot-path: "who has / hasn't acknowledged this doc" — starts from
-- document_id and joins to `members` for outstanding-count.
create index if not exists idx_document_acknowledgement_org_document
  on public.document_acknowledgement (organisation_id, document_id);

comment on table public.document_acknowledgement is
  'One row per (document, member) recording that the member has '
  'clicked "I have read and understood this document". Rows outlive '
  'the referenced document by design — see the retention rule in '
  'the Document Acknowledgement spec (CLE-219). Never updated by '
  'the app; superseded_by_replace_at is the only mutation, stamped '
  'when the underlying doc''s bytes change via Replace.';

-- ---------------------------------------------------------------------------
-- 3. RLS
-- ---------------------------------------------------------------------------

alter table public.document_acknowledgement enable row level security;

-- Reads follow the same scope as `members` — a self-scope caller
-- sees their own ack rows; team/all-scope callers see their scope's
-- members' rows. Reuses the resolver helpers so any future scope
-- rework doesn't have to touch this table.
create policy document_acknowledgement_select
  on public.document_acknowledgement
  for select
  to authenticated
  using (
    organisation_id in (
      select m.organisation_id from public.members m
      where m.user_id = auth.uid()
    )
    and (
      -- Self-scope: only own rows.
      member_id in (
        select id from public.members
        where user_id = auth.uid()
          and organisation_id = document_acknowledgement.organisation_id
      )
      or public.get_cross_user_access(organisation_id) in ('team', 'all')
    )
    and (
      -- Team scope narrows further to same-team members. `all`
      -- scope skips this branch entirely.
      public.get_cross_user_access(organisation_id) <> 'team'
      or member_id in (
        select id from public.members
        where organisation_id = document_acknowledgement.organisation_id
          and team_id = public.get_user_team_id(organisation_id)
      )
    )
  );

-- Writes: hard rule — a Member can only ever insert their OWN row.
-- No admin override, no support-recovery path (see spec §Access &
-- Security invariant #3). The app-layer server action performs
-- additional validation (was the doc read? does the subtype
-- require ack?) before calling insert; RLS enforces the identity
-- invariant even if the server action is wrong.
create policy document_acknowledgement_insert
  on public.document_acknowledgement
  for insert
  to authenticated
  with check (
    member_id in (
      select id from public.members
      where user_id = auth.uid()
        and organisation_id = document_acknowledgement.organisation_id
    )
  );

-- No UPDATE / DELETE policies — the app never mutates or deletes ack
-- rows. `superseded_by_replace_at` is stamped by a service-role
-- helper called from the Replace server action; that path bypasses
-- RLS as service_role always does.
