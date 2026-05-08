-- Migration: auto-populate document metadata on INSERT via trigger.
-- When a member_documents row is inserted with a conversation_message_id,
-- derive entity_type, entity_id, and document_category from the linked
-- conversation. This catches uploads from all clients (mobile, web, etc.).
-- CLE-162

create or replace function public.fn_populate_document_metadata()
returns trigger as $$
begin
  -- Only act when conversation_message_id is set and metadata is missing
  if NEW.conversation_message_id is not null
     and NEW.entity_type is null
  then
    select c.entity_type, c.entity_id,
           case when c.entity_type = 'absence_booking' then 'absence_document'
                else c.entity_type
           end
      into NEW.entity_type, NEW.entity_id, NEW.document_category
      from public.conversation_messages cm
      join public.conversations c on c.id = cm.conversation_id
     where cm.id = NEW.conversation_message_id;
  end if;

  return NEW;
end;
$$ language plpgsql security definer;

create trigger trg_populate_document_metadata
  before insert on public.member_documents
  for each row
  execute function public.fn_populate_document_metadata();

-- Backfill any rows that were inserted after the columns were added
-- but before this trigger existed (e.g. mobile uploads).
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
