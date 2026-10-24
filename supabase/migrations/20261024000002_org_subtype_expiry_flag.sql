-- Organisation document uploads no longer ask for an expiry date (it is
-- set on the Document Details dialog afterwards), so "Expiry required"
-- has no meaning for organisation_document subtypes. Clear it.
-- Safe to run twice.

update document_subtype
   set expiry_required = false
 where expiry_required = true
   and type = 'organisation_document';
