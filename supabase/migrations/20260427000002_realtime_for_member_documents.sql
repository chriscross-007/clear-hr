-- Enable Supabase Realtime broadcasts for member_documents so the
-- BookingConversation thread can pick up newly-attached documents on
-- already-displayed messages without needing a manual refresh.
alter publication supabase_realtime add table public.member_documents;
