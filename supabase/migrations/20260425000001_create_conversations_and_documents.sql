-- Migration: create conversations, conversation_messages, member_documents
-- and the private member-documents storage bucket. Migrates existing
-- holiday_bookings notes into the new conversation thread model.

-- =========================================================================
-- Table 1: conversations
-- A conversation thread attached to any entity via (entity_type, entity_id).
-- One conversation per entity.
-- =========================================================================

create table public.conversations (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  entity_type     text not null,
  entity_id       uuid not null,
  created_at      timestamptz not null default now()
);

-- Indexes
create unique index idx_conversations_entity
  on public.conversations(entity_type, entity_id);
create index idx_conversations_organisation_id
  on public.conversations(organisation_id);

-- Enable RLS
alter table public.conversations enable row level security;

-- Employee: SELECT conversations linked to their own absence bookings
create policy "conversations_select_own"
  on public.conversations for select
  using (
    (entity_type = 'absence_booking' and entity_id in (
      select id from public.holiday_bookings
      where member_id in (
        select id from public.members where user_id = (select auth.uid())
      )
    ))
  );

-- Admin/Owner: SELECT all conversations in their org
create policy "conversations_select_org"
  on public.conversations for select
  using (
    get_user_role(organisation_id) in ('admin', 'owner')
  );

-- Employee: INSERT conversation on their own absence bookings
create policy "conversations_insert_own"
  on public.conversations for insert
  with check (
    (entity_type = 'absence_booking' and entity_id in (
      select id from public.holiday_bookings
      where member_id in (
        select id from public.members where user_id = (select auth.uid())
      )
    ))
  );

-- Admin/Owner: INSERT conversation on any entity in their org
create policy "conversations_insert_org"
  on public.conversations for insert
  with check (
    get_user_role(organisation_id) in ('admin', 'owner')
  );

-- No UPDATE or DELETE policies.

-- =========================================================================
-- Table 2: conversation_messages
-- Individual messages within a conversation.
-- =========================================================================

create table public.conversation_messages (
  id                uuid primary key default gen_random_uuid(),
  conversation_id   uuid not null references public.conversations(id) on delete cascade,
  author_member_id  uuid not null references public.members(id) on delete restrict,
  body              text not null,
  created_at        timestamptz not null default now()
);

-- Indexes
create index idx_conversation_messages_conversation_id
  on public.conversation_messages(conversation_id);
create index idx_conversation_messages_created_at
  on public.conversation_messages(created_at);

-- Enable RLS
alter table public.conversation_messages enable row level security;

-- Employee: SELECT messages in conversations on their own bookings
create policy "conversation_messages_select_own"
  on public.conversation_messages for select
  using (
    conversation_id in (
      select c.id from public.conversations c
      where c.entity_type = 'absence_booking'
        and c.entity_id in (
          select id from public.holiday_bookings
          where member_id in (
            select id from public.members where user_id = (select auth.uid())
          )
        )
    )
  );

-- Admin/Owner: SELECT all messages in their org's conversations
create policy "conversation_messages_select_org"
  on public.conversation_messages for select
  using (
    conversation_id in (
      select c.id from public.conversations c
      where get_user_role(c.organisation_id) in ('admin', 'owner')
    )
  );

-- Employee: INSERT messages in conversations on their own bookings
create policy "conversation_messages_insert_own"
  on public.conversation_messages for insert
  with check (
    conversation_id in (
      select c.id from public.conversations c
      where c.entity_type = 'absence_booking'
        and c.entity_id in (
          select id from public.holiday_bookings
          where member_id in (
            select id from public.members where user_id = (select auth.uid())
          )
        )
    )
  );

-- Admin/Owner: INSERT messages in any conversation in their org
create policy "conversation_messages_insert_org"
  on public.conversation_messages for insert
  with check (
    conversation_id in (
      select c.id from public.conversations c
      where get_user_role(c.organisation_id) in ('admin', 'owner')
    )
  );

-- No UPDATE or DELETE policies.

-- =========================================================================
-- Table 3: member_documents
-- Universal file registry. Files can be standalone (contract, right-to-work)
-- or linked to a conversation message via conversation_message_id.
-- =========================================================================

create table public.member_documents (
  id                       uuid primary key default gen_random_uuid(),
  organisation_id          uuid not null references public.organisations(id) on delete cascade,
  member_id                uuid not null references public.members(id) on delete cascade,
  document_type            text not null,
  file_name                text not null,
  file_size                integer not null,
  content_type             text not null,
  storage_path             text not null,
  uploaded_by_member_id    uuid not null references public.members(id) on delete restrict,
  conversation_message_id  uuid references public.conversation_messages(id) on delete set null,
  created_at               timestamptz not null default now()
);

-- Indexes
create index idx_member_documents_organisation_id
  on public.member_documents(organisation_id);
create index idx_member_documents_member_id
  on public.member_documents(member_id);
create index idx_member_documents_document_type
  on public.member_documents(document_type);
create index idx_member_documents_conversation_message_id
  on public.member_documents(conversation_message_id);

-- Enable RLS
alter table public.member_documents enable row level security;

-- Employee: SELECT their own documents
create policy "member_documents_select_own"
  on public.member_documents for select
  using (
    member_id in (
      select id from public.members where user_id = (select auth.uid())
    )
  );

-- Admin/Owner: SELECT all documents in their org
create policy "member_documents_select_org"
  on public.member_documents for select
  using (
    get_user_role(organisation_id) in ('admin', 'owner')
  );

-- Employee: INSERT documents for themselves
create policy "member_documents_insert_own"
  on public.member_documents for insert
  with check (
    member_id in (
      select id from public.members where user_id = (select auth.uid())
    )
  );

-- Admin/Owner: INSERT documents for any member in their org
create policy "member_documents_insert_org"
  on public.member_documents for insert
  with check (
    get_user_role(organisation_id) in ('admin', 'owner')
  );

-- No UPDATE or DELETE policies for now.

-- =========================================================================
-- Storage bucket — PRIVATE. No end-user storage.objects policies are added;
-- all reads/writes go through server actions using the service-role client.
-- This is intentional because employee documents are sensitive.
-- =========================================================================

insert into storage.buckets (id, name, public)
values ('member-documents', 'member-documents', false);

-- =========================================================================
-- Data migration — convert existing holiday_bookings notes into the new
-- conversation/message model. employee_note becomes the first message,
-- approver_note (when present and there's an approver1_id) becomes the
-- second message (timestamped 1 second later for stable ordering).
-- =========================================================================

-- Step 1 — Create a conversation for every booking that has any note
insert into public.conversations (organisation_id, entity_type, entity_id, created_at)
select hb.organisation_id, 'absence_booking', hb.id, hb.created_at
from public.holiday_bookings hb
where (hb.employee_note is not null and hb.employee_note != '')
   or (hb.approver_note is not null and hb.approver_note != '' and hb.approver1_id is not null);

-- Step 2 — Insert employee notes as the first message
insert into public.conversation_messages (conversation_id, author_member_id, body, created_at)
select c.id, hb.member_id, hb.employee_note, hb.created_at
from public.holiday_bookings hb
join public.conversations c
  on c.entity_type = 'absence_booking' and c.entity_id = hb.id
where hb.employee_note is not null
  and hb.employee_note != '';

-- Step 3 — Insert approver notes as the second message (1s after employee)
insert into public.conversation_messages (conversation_id, author_member_id, body, created_at)
select c.id, hb.approver1_id, hb.approver_note, hb.created_at + interval '1 second'
from public.holiday_bookings hb
join public.conversations c
  on c.entity_type = 'absence_booking' and c.entity_id = hb.id
where hb.approver_note is not null
  and hb.approver_note != ''
  and hb.approver1_id is not null;

-- holiday_bookings.employee_note and approver_note are intentionally kept
-- in place for now — existing reads continue to work.
