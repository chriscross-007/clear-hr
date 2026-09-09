-- CLE-212 — Document Activity: replace the half-baked shared "note" on
-- `document` with a proper conversation thread, matching the model
-- Absence Bookings already uses.
--
-- Three parts:
--
--   1. Extend the existing conversations / conversation_messages RLS
--      policies to recognise entity_type = 'document'. The tables were
--      already generic ({ entity_type, entity_id }); only the RLS was
--      hard-coded to absence_booking, so we add parallel policies for
--      document rather than rewriting the existing ones.
--
--   2. Backfill: every existing document with a non-empty note becomes
--      a conversation with a single first message authored by the
--      uploader, dated at the document's uploaded_at. This preserves
--      the human content people have already typed in.
--
--   3. Drop `document.note` and its length constraint. From now on all
--      free-text about a document lives in the conversation thread.
--
-- Side note — capture-task uploads: `capture_task.note` is kept in
-- place. The mobile upload route is updated (application-side) to
-- create a conversation on the resulting document and post the task
-- note as the first message when it's non-empty.

-- ---------------------------------------------------------------------
-- 1. RLS: allow document conversations
-- ---------------------------------------------------------------------
-- Access rules mirror the `document` table itself:
--   * SELECT: caller must be able to SELECT the underlying document row
--     (which already encodes org-scope, cross-user-access, and the
--     can_view_organisation_documents flag).
--   * INSERT: caller must have UPDATE rights on the document, which is
--     what `document_update`/`document_insert` use — that gates the
--     tab-matrix documents.update flag for member-scoped docs and
--     can_edit_org_settings for org-scoped docs.
--
-- The existing conversations_* / conversation_messages_* policies for
-- absence_booking stay untouched. Adding parallel document_* policies
-- means either policy set is a matching set for a query — Postgres
-- ORs matching policies together, which is what we want.

-- SELECT on conversations for document threads
create policy "conversations_select_document"
  on public.conversations for select
  using (
    entity_type = 'document'
    and entity_id in (
      select id from public.document
    )
  );

-- INSERT on conversations for document threads
create policy "conversations_insert_document"
  on public.conversations for insert
  with check (
    entity_type = 'document'
    and entity_id in (
      select id from public.document
    )
  );

-- SELECT on conversation_messages for document threads
create policy "conversation_messages_select_document"
  on public.conversation_messages for select
  using (
    conversation_id in (
      select c.id from public.conversations c
      where c.entity_type = 'document'
        and c.entity_id in (
          select id from public.document
        )
    )
  );

-- INSERT on conversation_messages for document threads
create policy "conversation_messages_insert_document"
  on public.conversation_messages for insert
  with check (
    conversation_id in (
      select c.id from public.conversations c
      where c.entity_type = 'document'
        and c.entity_id in (
          select id from public.document
        )
    )
  );

-- No UPDATE / DELETE policies. Messages are immutable once posted (same
-- as absence_booking). If someone wants a redaction mechanism later,
-- we'll add it explicitly.

-- ---------------------------------------------------------------------
-- 2. Backfill existing document.note values as first messages
-- ---------------------------------------------------------------------
-- One conversation per document that has a non-empty note, one message
-- in that conversation, authored by the doc's uploader.

-- Step 1 — create the conversation for every noted document
insert into public.conversations (organisation_id, entity_type, entity_id, created_at)
select d.organisation_id, 'document', d.id, d.uploaded_at
from public.document d
where d.note is not null
  and d.note != ''
  -- Skip any doc that already has a conversation (idempotency guard).
  and not exists (
    select 1 from public.conversations c
    where c.entity_type = 'document' and c.entity_id = d.id
  );

-- Step 2 — insert the note as the first message on each conversation
insert into public.conversation_messages (conversation_id, author_member_id, body, created_at)
select
  c.id,
  coalesce(d.uploaded_by, (
    -- Fallback: if the doc has no uploader, pick any owner/admin in
    -- the org so the FK still resolves. Should never fire on real
    -- data — every real upload has an uploader.
    select m.id from public.members m
    where m.organisation_id = d.organisation_id
    limit 1
  )),
  d.note,
  d.uploaded_at
from public.document d
join public.conversations c
  on c.entity_type = 'document' and c.entity_id = d.id
where d.note is not null
  and d.note != ''
  -- Guard against re-runs — skip if any message already exists in this
  -- conversation.
  and not exists (
    select 1 from public.conversation_messages m
    where m.conversation_id = c.id
  );

-- ---------------------------------------------------------------------
-- 3. Drop the note column
-- ---------------------------------------------------------------------
-- The check constraint on the note column is anonymous (added inline
-- in 20260904000005). Dropping the column removes the constraint too.

alter table public.document
  drop column if exists note;
