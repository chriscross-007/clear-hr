-- Migration: add open/closed status to conversations + UPDATE policies so
-- both employees and admins can change the status of conversations they
-- already have SELECT access to.

alter table public.conversations
  add column status text not null default 'open'
    check (status in ('open', 'closed')),
  add column closed_by_member_id uuid references public.members(id) on delete set null,
  add column closed_at timestamptz;

-- Employee: UPDATE conversations on their own absence bookings
create policy "conversations_update_own"
  on public.conversations for update
  using (
    entity_type = 'absence_booking' and entity_id in (
      select id from public.holiday_bookings
      where member_id in (
        select id from public.members where user_id = (select auth.uid())
      )
    )
  )
  with check (
    entity_type = 'absence_booking' and entity_id in (
      select id from public.holiday_bookings
      where member_id in (
        select id from public.members where user_id = (select auth.uid())
      )
    )
  );

-- Admin/Owner: UPDATE any conversation in their org
create policy "conversations_update_org"
  on public.conversations for update
  using (
    get_user_role(organisation_id) in ('admin', 'owner')
  )
  with check (
    get_user_role(organisation_id) in ('admin', 'owner')
  );
