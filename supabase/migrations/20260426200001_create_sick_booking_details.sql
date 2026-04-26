-- Migration: create sick_booking_details
-- 1:1 with holiday_bookings, only populated when the booking's reason is a
-- Sick-type absence type. Captures the workflow fields that wrap a sick
-- absence (self-cert form, return-to-work interview, paid status, HR sign-off).

create table public.sick_booking_details (
  id                       uuid primary key default gen_random_uuid(),
  booking_id               uuid not null unique references public.holiday_bookings(id) on delete cascade,
  self_cert_required       boolean not null default false,
  self_cert_received_date  date,
  self_cert_document_id    uuid references public.member_documents(id) on delete set null,
  btw_required             boolean not null default false,
  btw_date                 date,
  btw_interviewer_id       uuid references public.members(id) on delete set null,
  is_paid                  boolean not null default true,
  hr_approved              boolean not null default false,
  hr_approved_by           uuid references public.members(id) on delete set null,
  hr_approved_at           timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index idx_sick_booking_details_booking_id
  on public.sick_booking_details(booking_id);

create trigger set_sick_booking_details_updated_at
  before update on public.sick_booking_details
  for each row
  execute function public.handle_updated_at();

alter table public.sick_booking_details enable row level security;

-- Admin/Owner: full CRUD on rows whose parent booking belongs to their org.
create policy "sick_details_select"
  on public.sick_booking_details for select
  using (
    exists (
      select 1 from public.holiday_bookings hb
      where hb.id = booking_id
        and get_user_role(hb.organisation_id) in ('admin', 'owner')
    )
  );

create policy "sick_details_insert"
  on public.sick_booking_details for insert
  with check (
    exists (
      select 1 from public.holiday_bookings hb
      where hb.id = booking_id
        and get_user_role(hb.organisation_id) in ('admin', 'owner')
    )
  );

create policy "sick_details_update"
  on public.sick_booking_details for update
  using (
    exists (
      select 1 from public.holiday_bookings hb
      where hb.id = booking_id
        and get_user_role(hb.organisation_id) in ('admin', 'owner')
    )
  )
  with check (
    exists (
      select 1 from public.holiday_bookings hb
      where hb.id = booking_id
        and get_user_role(hb.organisation_id) in ('admin', 'owner')
    )
  );

create policy "sick_details_delete"
  on public.sick_booking_details for delete
  using (
    exists (
      select 1 from public.holiday_bookings hb
      where hb.id = booking_id
        and get_user_role(hb.organisation_id) in ('admin', 'owner')
    )
  );

-- Employees: read-only access to their own booking's sick details (for future
-- mobile display).
create policy "sick_details_select_own"
  on public.sick_booking_details for select
  using (
    exists (
      select 1 from public.holiday_bookings hb
      where hb.id = booking_id
        and hb.member_id in (select id from public.members where user_id = auth.uid())
    )
  );
