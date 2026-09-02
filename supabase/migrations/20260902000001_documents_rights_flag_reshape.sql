-- CLE-209 follow-up — Rights flag reshape.
--
-- Before: three flags — can_view_organisation_documents,
--         can_manage_deleted_documents, can_force_delete_documents.
-- After:  three flags — can_view_organisation_documents,
--         can_manage_organisation_documents, can_force_delete_documents.
--
-- can_manage_deleted_documents (which previously gated the per-member
-- Trash surface AND was reused for org-doc CRUD via can_edit_org_settings)
-- is replaced by can_manage_organisation_documents. The new flag
-- explicitly gates full CRUD + Trash restore on organisation-scoped
-- documents. Per-member Trash is now governed by the existing
-- documents.update tab-matrix cell.
--
-- Backfill: the new flag turns on for anyone who currently has
-- can_manage_deleted_documents (matches the seed defaults —
-- Admin + HR).

begin;

alter table public.rights_profiles
  add column if not exists can_manage_organisation_documents boolean not null default false;

update public.rights_profiles
   set can_manage_organisation_documents = true
 where can_manage_deleted_documents = true;

-- Rewrite has_rights_flag() to recognise the new key and drop the
-- old one. Same signature as the Path B version.
create or replace function public.has_rights_flag(org_id uuid, flag_name text)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select case flag_name
    when 'can_create_users'                    then p.can_create_users
    when 'can_invite_users'                    then p.can_invite_users
    when 'can_delete_users'                    then p.can_delete_users
    when 'can_approve_holidays'                then p.can_approve_holidays
    when 'can_override_holiday_rules'          then p.can_override_holiday_rules
    when 'can_run_reports'                     then p.can_run_reports
    when 'can_run_admin_reports'               then p.can_run_admin_reports
    when 'can_manage_teams'                    then p.can_manage_teams
    when 'can_edit_org_settings'               then p.can_edit_org_settings
    when 'can_edit_rights_profiles'            then p.can_edit_rights_profiles
    when 'can_manage_billing'                  then p.can_manage_billing
    when 'can_view_audit_logs'                 then p.can_view_audit_logs
    when 'can_view_sensitive_fields'           then p.can_view_sensitive_fields
    when 'can_edit_sensitive_fields'           then p.can_edit_sensitive_fields
    when 'can_manage_holiday_bookings'         then p.can_manage_holiday_bookings
    when 'can_view_organisation_documents'     then p.can_view_organisation_documents
    when 'can_manage_organisation_documents'   then p.can_manage_organisation_documents
    when 'can_force_delete_documents'          then p.can_force_delete_documents
    else false
  end
  from public.members m
  join public.rights_profiles p on p.id = m.rights_profile_id
  where m.organisation_id = org_id
    and m.user_id = (select auth.uid())
  limit 1;
$$;

-- Update the seed trigger — future org creation seeds the new flag
-- for Admin/HR default profiles instead of the old one.
create or replace function public.trigger_seed_documents_rights_flags()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.is_default = true then
    if new.rank in ('admin', 'hr', 'manager', 'employee')
       and new.can_view_organisation_documents = false then
      new.can_view_organisation_documents := true;
    end if;
    if new.rank in ('admin', 'hr')
       and new.can_manage_organisation_documents = false then
      new.can_manage_organisation_documents := true;
    end if;
  end if;
  -- can_force_delete_documents stays off; explicit toggle only.
  return new;
end;
$$;

-- Drop the retired column now that no code references it. Any RLS
-- policy that referenced it (none in practice — CLE-205 gated org
-- doc writes on can_edit_org_settings) would need to be rewritten
-- before this point; verified clean.
alter table public.rights_profiles
  drop column if exists can_manage_deleted_documents;

-- Also drop the (unused) can_manage_deleted_documents branch from
-- has_rights_flag — the CASE above already omits it.

commit;
