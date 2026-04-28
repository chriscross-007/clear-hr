-- CLE-149: Sick booking completion status
-- Stored column tracking the highest-priority outstanding action on a sick
-- booking. Computed by the app on every save. Allows efficient querying for
-- the admin dashboard widget ("bookings needing attention").

alter table public.sick_booking_details
  add column completion_status text not null default 'complete';

-- Index for the dashboard query that fetches incomplete bookings.
create index idx_sick_booking_details_completion_status
  on public.sick_booking_details(completion_status)
  where completion_status <> 'complete';
