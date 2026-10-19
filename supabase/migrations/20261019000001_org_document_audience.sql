-- CLE-230 — Per-document audience for organisation documents.
--
-- Replaces the per-member "Viewable" checkbox (member_org_document_hidden)
-- with a setting on each org doc that says who can see it:
--
--   audience_mode = 'all'       → every member with can_view_organisation_documents
--   audience_mode = 'selected'  → a member sees it when EITHER
--       (a) they match the filters: at least one filter is set, and
--           team_id ∈ audience_team_ids (if any teams chosen) AND
--           rights_profile_id ∈ audience_rights_profile_ids (if any profiles chosen)
--       OR
--       (b) they're in audience_include_member_ids ("Always include").
--
-- Members whose profile grants can_manage_organisation_documents always
-- SEE every org doc, but are only EXPECTED to acknowledge it when they're
-- in the audience. Evaluation is app-layer (src/lib/org-doc-audience.ts).
--
-- Columns apply only to owner_scope = 'organisation' rows; per-member docs
-- keep the defaults and ignore them.
--
-- Backfill: any org doc that had per-member hides becomes 'selected' with
-- "Always include" = every member of the org who wasn't hidden from it.
-- That reproduces today's visibility exactly (new joiners won't be added
-- automatically to those docs — admins can switch them back to Everyone).
--
-- member_org_document_hidden is left in place (unused by the app after
-- this change) so code deployed before this migration keeps working.
-- A later cleanup migration drops it.
--
-- Idempotent.

alter table public.document
  add column if not exists audience_mode text not null default 'all',
  add column if not exists audience_team_ids uuid[] not null default '{}',
  add column if not exists audience_rights_profile_ids uuid[] not null default '{}',
  add column if not exists audience_include_member_ids uuid[] not null default '{}';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'chk_document_audience_mode'
  ) then
    alter table public.document
      add constraint chk_document_audience_mode
      check (audience_mode in ('all', 'selected'));
  end if;
end $$;

-- Backfill from the old per-member hide table. Only touches docs still
-- on the default 'all' so re-running is harmless.
update public.document d
   set audience_mode = 'selected',
       audience_include_member_ids = coalesce((
         select array_agg(m.id order by m.id)
           from public.members m
          where m.organisation_id = d.organisation_id
            and not exists (
              select 1 from public.member_org_document_hidden h
               where h.document_id = d.id and h.member_id = m.id
            )
       ), '{}')
 where d.owner_scope = 'organisation'
   and d.audience_mode = 'all'
   and exists (
     select 1 from public.member_org_document_hidden h where h.document_id = d.id
   );
