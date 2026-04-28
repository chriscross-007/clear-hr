-- Enable Supabase Realtime on member_documents so the web admin sees
-- document attachments as soon as the mobile employee uploads them.
alter publication supabase_realtime add table public.member_documents;
