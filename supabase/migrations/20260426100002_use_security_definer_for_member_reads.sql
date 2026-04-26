-- Replace the same-org members SELECT policy with a SECURITY DEFINER helper
-- so it doesn't query members from inside a members policy (which can trigger
-- recursive RLS evaluation depending on planner behaviour).

-- 1. Drop the previous policy that used a self-referencing subquery
drop policy if exists "Members can read same-org members" on public.members;

-- 2. Helper that bypasses RLS on members and returns the caller's org id
create or replace function get_my_organisation_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select organisation_id from members where user_id = auth.uid() limit 1
$$;

-- 3. Safe policy that uses the helper instead of a subquery on members
create policy "Members can read same-org members"
  on public.members for select
  using (organisation_id = get_my_organisation_id());
