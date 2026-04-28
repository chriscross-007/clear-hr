-- Enable Supabase Realtime broadcasts for conversation_messages so the
-- BookingConversation thread receives INSERT events from other clients.
alter publication supabase_realtime add table public.conversation_messages;
