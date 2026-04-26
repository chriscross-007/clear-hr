-- Migration: per-organisation self-certification form template path.
-- Stored under member-documents at org-templates/{org_id}/self-cert-template.pdf
-- and surfaced via a signed URL by sick-booking-actions.getSelfCertTemplateUrl.

alter table public.organisations
  add column self_cert_template_path text;
