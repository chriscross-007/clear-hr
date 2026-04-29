-- Migration: add metadata columns to member_documents for automatic
-- categorisation, entity linking, and user-selected document labels.
-- CLE-161

-- =========================================================================
-- 1. Add new columns
-- =========================================================================

alter table public.member_documents
  add column entity_type       text,
  add column entity_id         uuid,
  add column document_category text,
  add column document_label    text;

-- =========================================================================
-- 2. Indexes for filtering on the Docs page
-- =========================================================================

create index idx_member_documents_entity
  on public.member_documents(entity_type, entity_id);

create index idx_member_documents_document_category
  on public.member_documents(document_category);

-- =========================================================================
-- 3. Backfill existing rows — derive entity_type + entity_id from the
--    linked conversation (via conversation_message_id → conversations).
--    Set document_category to 'absence_document' for absence bookings.
-- =========================================================================

update public.member_documents md
set
  entity_type       = c.entity_type,
  entity_id         = c.entity_id,
  document_category = case
    when c.entity_type = 'absence_booking' then 'absence_document'
    else c.entity_type
  end
from public.conversation_messages cm
join public.conversations c on c.id = cm.conversation_id
where md.conversation_message_id = cm.id
  and md.entity_type is null;

-- =========================================================================
-- 4. UPDATE policy — admin/owner can update document metadata in their org
-- =========================================================================

create policy "member_documents_update_org"
  on public.member_documents for update
  using (
    get_user_role(organisation_id) in ('admin', 'owner')
  )
  with check (
    get_user_role(organisation_id) in ('admin', 'owner')
  );
