-- Document email notifications.
--
-- 1. Three per-organisation switches (Settings → Organisation →
--    Notifications), all on by default:
--      notify_member_doc_acks      member "documents to acknowledge" emails
--      notify_member_doc_expiry    member "your certificate is expiring" emails
--      notify_admin_doc_digest     admin daily documents summary
--
-- 2. document_email_log — what the nightly job has already sent, so a
--    re-run never sends twice and the reminder schedule (7 / 30 days
--    after the first acknowledgement email; 30 / 14 / 3 days before
--    expiry) knows what has gone out. Kinds:
--      member_ack     one row per member × document × touch (first/r7/r30)
--      member_expiry  one row per member × document × expiry date × stage
--      admin_item     one row per item already listed in an admin
--                     summary (no recipient — every admin in scope saw it
--                     the same night)
--    `dedupe_key` carries recipient + document + cycle so a single unique
--    index covers every kind. Service-role only: RLS on, no policies.
--
-- Safe to run twice.

alter table organisations
  add column if not exists notify_member_doc_acks boolean not null default true,
  add column if not exists notify_member_doc_expiry boolean not null default true,
  add column if not exists notify_admin_doc_digest boolean not null default true;

create table if not exists document_email_log (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete cascade,
  kind text not null,
  recipient_member_id uuid references members(id) on delete cascade,
  document_id uuid references document(id) on delete cascade,
  cycle_key text not null default '',
  dedupe_key text not null,
  sent_at timestamptz not null default now(),
  constraint chk_document_email_log_kind
    check (kind in ('member_ack', 'member_expiry', 'admin_item'))
);

create unique index if not exists document_email_log_dedupe
  on document_email_log (organisation_id, kind, dedupe_key);

create index if not exists document_email_log_recipient
  on document_email_log (organisation_id, recipient_member_id);

alter table document_email_log enable row level security;
