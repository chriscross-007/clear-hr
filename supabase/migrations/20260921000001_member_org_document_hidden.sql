-- CLE-225 — Per-member Org Document visibility.
--
-- Presence of a row means the doc is hidden from that member.
-- Default: no row = visible. Existing employees continue to see every
-- org doc; admins toggle "Viewable" off in the per-member Org Docs
-- surface to insert a hiding row.
--
-- Compromise noted here + in CLAUDE.md: RLS is deliberately broad —
-- any org member can SELECT rows from their own org so the ack /
-- coverage math (run under service-role in server actions today,
-- but with a mind to a future RLS-only path) is straightforward.
-- The narrowing to admin-only writes is enforced at the server-action
-- layer via can_manage_organisation_documents. Tightening RLS to
-- "admins-only reads" is a follow-up (#gap).

create table if not exists public.member_org_document_hidden (
  organisation_id     uuid        not null references public.organisations(id)  on delete cascade,
  member_id           uuid        not null references public.members(id)         on delete cascade,
  document_id         uuid        not null references public.document(id)        on delete cascade,
  hidden_at           timestamptz not null default now(),
  hidden_by_member_id uuid        null references public.members(id)             on delete set null,
  primary key (member_id, document_id)
);

create index if not exists idx_modh_org on public.member_org_document_hidden (organisation_id);
create index if not exists idx_modh_doc on public.member_org_document_hidden (document_id);

alter table public.member_org_document_hidden enable row level security;

-- SELECT: caller sees rows in their own org. Broad by design (see
-- CLE-225 header note); server actions narrow further.
drop policy if exists modh_select_by_org on public.member_org_document_hidden;
create policy modh_select_by_org on public.member_org_document_hidden
  for select to authenticated
  using (
    organisation_id in (
      select organisation_id from public.members where user_id = auth.uid()
    )
  );

-- INSERT / UPDATE / DELETE: any caller in the org. The app-layer
-- gates on `can_manage_organisation_documents`. Kept broad here so
-- future refactors that move gating up (e.g. RPC + row-level check)
-- don't need to touch this policy.
drop policy if exists modh_write on public.member_org_document_hidden;
create policy modh_write on public.member_org_document_hidden
  for all to authenticated
  using (
    organisation_id in (
      select organisation_id from public.members where user_id = auth.uid()
    )
  )
  with check (
    organisation_id in (
      select organisation_id from public.members where user_id = auth.uid()
    )
  );

comment on table public.member_org_document_hidden is
  'CLE-225 — Per-member hides on organisation-scope documents. Row present = hidden for that (member_id, document_id). No row = visible. App-layer enforces the admin-only write gate via can_manage_organisation_documents.';
