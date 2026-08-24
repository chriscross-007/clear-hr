-- Custom Fields: split "input mode" out of "field type".
--
-- Before this migration `field_type` conflated the value's underlying
-- data type (text, number, date, currency, …) with the way the user
-- entered it (free-form text, single-choice dropdown, multi-choice
-- list). Two "types" — `dropdown` and `multiselect` — were really just
-- entry mechanisms layered on top of an implicit `text` data type. That
-- shape blocked useful combinations like "single-choice from a list of
-- numbers" or "multi-choice from a list of dates".
--
-- The new shape is a two-column pair:
--
--   • field_type  → one of nine underlying data types
--                   (text, multiline, email, url, phone, number,
--                    currency, date, checkbox)
--   • input_mode  → one of three entry mechanisms
--                   (freeform, single_choice, multi_choice)
--
-- Options (the picklist) apply when input_mode is single_choice or
-- multi_choice. Values are still stored on `members.custom_fields`
-- (JSONB): a single scalar for single_choice / freeform, an array for
-- multi_choice. Data preservation was not required for this migration;
-- however the backfill below maps any existing dropdown / multiselect
-- definitions to their nearest equivalent so orgs that had defined
-- picklists don't lose them.

-- ---------------------------------------------------------------------------
-- 1. Add the new column
-- ---------------------------------------------------------------------------

alter table public.custom_field_definitions
  add column if not exists input_mode text not null default 'freeform';

alter table public.custom_field_definitions
  add constraint custom_field_definitions_input_mode_check
    check (input_mode in ('freeform', 'single_choice', 'multi_choice'));

-- ---------------------------------------------------------------------------
-- 2. Backfill: convert legacy dropdown / multiselect rows in place
-- ---------------------------------------------------------------------------
-- Both types were text-backed under the hood, so field_type collapses
-- to 'text' and input_mode captures the selection mechanism.

update public.custom_field_definitions
   set field_type = 'text',
       input_mode = 'single_choice'
 where field_type = 'dropdown';

update public.custom_field_definitions
   set field_type = 'text',
       input_mode = 'multi_choice'
 where field_type = 'multiselect';

-- No CHECK constraint on field_type in the current schema, so nothing
-- further to drop. Application code (custom-fields-manager.tsx +
-- render sites) is the source of truth for the nine allowed types.
