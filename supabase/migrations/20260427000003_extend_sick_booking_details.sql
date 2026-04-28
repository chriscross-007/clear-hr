-- Extra fields on sick_booking_details:
-- - self_cert_received_by: who recorded the self-cert form arriving
-- - med_cert_required / med_cert_received_date / med_cert_received_by:
--   medical-certificate equivalents of the self-cert workflow
-- - btw_completed: marks the back-to-work interview as done

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
