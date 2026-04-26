-- Allow all authenticated users to read basic member info within their own org.
-- Required so employees can see who authored conversation messages — without
-- this, the Supabase join `members:author_member_id(...)` silently returns
-- null for non-admin authors and the mobile app shows "Someone" / "employee".
-- Additive policy — PostgreSQL OR's all permissive policies together.
create policy "Members can read same-org members"
  on public.members for select
  using (
    organisation_id in (
      select organisation_id from public.members where user_id = auth.uid()
    )
  );
