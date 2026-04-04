-- Migration: allow admins to read all members in their org (not just their team)
-- Required for approvals, holiday management, and other admin workflows
-- This is additive — PostgreSQL OR's all permissive policies together
create policy "Admins can read all org members"
  on public.members for select
  using (
    get_user_role(organisation_id) = 'admin'
  );
