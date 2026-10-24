-- Document subtype flags that don't fit the document's kind.
--
-- * Certificates and RTW evidence are supplied by the member, so there
--   is nothing for the member to acknowledge: requires_acknowledgement
--   is switched off for `certificate` and `evidence`.
-- * Employment (`contract`) documents are always issued by the
--   organisation, so members can never upload them:
--   employee_can_upload is switched off for `contract` (and
--   `organisation_document`, which was already hidden in the editor).
--
-- Existing document_acknowledgement rows are kept as history.
-- Safe to run twice.

update document_subtype
   set requires_acknowledgement = false
 where requires_acknowledgement = true
   and type in ('certificate', 'evidence');

update document_subtype
   set employee_can_upload = false
 where employee_can_upload = true
   and type in ('contract', 'organisation_document');
