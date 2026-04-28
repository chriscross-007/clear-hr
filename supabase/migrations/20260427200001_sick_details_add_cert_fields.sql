-- Add self_cert_received_by to track which admin recorded the self-cert date,
-- and medical certificate fields (required, date received, received by).

alter table public.sick_booking_details
  add column self_cert_received_by uuid references public.members(id) on delete set null;

alter table public.sick_booking_details
  add column med_cert_required boolean not null default false;

alter table public.sick_booking_details
  add column med_cert_received_date date;

alter table public.sick_booking_details
  add column med_cert_received_by uuid references public.members(id) on delete set null;

alter table public.sick_booking_details
  add column btw_completed boolean not null default false;

-- NOTE: Run this separately if the earlier columns from this migration
-- have already been applied:
-- alter table public.sick_booking_details add column btw_completed boolean not null default false;
