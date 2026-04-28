-- Enable Supabase Realtime on conversation_messages so both the web admin
-- and mobile employee can receive new messages instantly.
alter publication supabase_realtime add table public.conversation_messages;
