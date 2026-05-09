-- CLE-178 — Notice period rules: per-org "block or warn" flag.
--
-- When TRUE, holiday requests that violate the notice period rules are
-- rejected by the server. When FALSE (default), the request is accepted
-- and the employee just sees a soft warning in the booking sheet that the
-- request is likely to be rejected by their approver.

ALTER TABLE organisations
  ADD COLUMN IF NOT EXISTS notice_rules_block_requests BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN organisations.notice_rules_block_requests IS
  'When TRUE, the server hard-rejects holiday requests that breach notice_period_rules. When FALSE the request is accepted and the booking sheet renders a soft warning instead.';
