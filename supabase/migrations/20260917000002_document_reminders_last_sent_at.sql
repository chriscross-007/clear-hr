-- CLE-219 Ticket D — track when the "Remind outstanding" bulk button
-- last fired per doc, so the 24-hour throttle can enforce.
--
-- Nullable — a doc that's never been reminded is a valid state, and
-- the throttle check compares `now() - reminders_last_sent_at` only
-- when the value is present.

alter table public.document
  add column if not exists reminders_last_sent_at timestamptz null;

comment on column public.document.reminders_last_sent_at is
  'Timestamp of the last "Remind outstanding" bulk email fired from '
  'the Compliance dashboard Acknowledgements tab for this document. '
  'NULL when the doc has never been reminded. The 24-hour throttle '
  'in remindOutstanding() reads this column. See CLE-219.';
