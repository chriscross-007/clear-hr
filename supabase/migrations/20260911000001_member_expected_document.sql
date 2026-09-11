-- CLE-213 — Required documents per member.
--
-- Two additions:
--
--   1. `document_subtype.trackable_per_member` (bool, default false).
--      Marks a subtype as eligible for per-member expectation. Purely
--      a UI-visibility flag: the Employment tab's Required Documents
--      picker lists only subtypes with this on. Independent of
--      `expected_for_every_member` — a subtype may be neither, one,
--      the other, or both.
--
--   2. `member_expected_document` table. One row per (member, subtype)
--      pairing that the tenant has recorded as expected of that
--      member. Feeds the compliance dashboard's synthetic
--      not_uploaded rows *additively* — the caller unions this table
--      with the org-wide `expected_for_every_member` subtypes to get
--      the full "expected of this member" set.

-- ---------------------------------------------------------------------
-- 1. Subtype flag
-- ---------------------------------------------------------------------
alter table public.document_subtype
  add column if not exists trackable_per_member boolean not null default false;

comment on column public.document_subtype.trackable_per_member is
  'CLE-213 — when true, this subtype appears in the Required Documents picker on the Employment tab so admins can assign it to specific members.';

-- ---------------------------------------------------------------------
-- 2. Per-member expected list
-- ---------------------------------------------------------------------
create table if not exists public.member_expected_document (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations(id) on delete cascade,
  member_id         uuid not null references public.members(id) on delete cascade,
  subtype_id        uuid not null references public.document_subtype(id) on delete cascade,
  added_at          timestamptz not null default now(),
  added_by          uuid references public.members(id) on delete set null,
  constraint member_expected_document_unique unique (member_id, subtype_id)
);

create index if not exists idx_member_expected_document_org
  on public.member_expected_document(organisation_id);

create index if not exists idx_member_expected_document_member
  on public.member_expected_document(member_id);

create index if not exists idx_member_expected_document_subtype
  on public.member_expected_document(subtype_id);

alter table public.member_expected_document enable row level security;

-- SELECT: any caller who can see the member row can see their
-- expected-doc list. Scope mirrors the `document` table's read
-- policy — self-read, or cross-user-access = team/all within org.
create policy member_expected_document_select
  on public.member_expected_document for select to authenticated
  using (
    -- Self
    member_id in (
      select id from public.members
      where user_id = auth.uid()
        and organisation_id = member_expected_document.organisation_id
    )
    -- Cross-user 'all' — any member of the caller's org
    or public.get_cross_user_access(organisation_id) = 'all'
    -- Cross-user 'team' — same team as the caller
    or (
      public.get_cross_user_access(organisation_id) = 'team'
      and member_id in (
        select m2.id from public.members m2
        where m2.organisation_id = member_expected_document.organisation_id
          and m2.team_id = (
            select team_id from public.members
            where user_id = auth.uid()
              and organisation_id = member_expected_document.organisation_id
            limit 1
          )
      )
    )
  );

-- INSERT / DELETE: caller must have documents.update on the target
-- (same gate as writing to `document` itself for member-scoped rows).
create policy member_expected_document_insert
  on public.member_expected_document for insert to authenticated
  with check (
    public.get_effective_tab_update(organisation_id, 'documents') = true
  );

create policy member_expected_document_delete
  on public.member_expected_document for delete to authenticated
  using (
    public.get_effective_tab_update(organisation_id, 'documents') = true
  );

-- No UPDATE policy — rows are effectively immutable once inserted.
-- Changing the set means DELETE + INSERT, which the setMemberExpectedDocuments
-- server action does atomically.
