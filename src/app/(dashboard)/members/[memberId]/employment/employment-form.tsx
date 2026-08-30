"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { useMemberLabel } from "@/contexts/member-label-context";
import {
  CustomFieldMultiSelect,
  CustomFieldSingleSelect,
  normaliseMultiselectValue,
} from "@/components/custom-field-multiselect";
import type { FieldDef } from "@/app/(dashboard)/employees/custom-field-actions";
import { capitalize } from "@/lib/label-utils";
import {
  updateEmployee,
  sendInvite,
  uploadMemberAvatar,
  deleteEmployee,
} from "@/app/(dashboard)/employees/actions";
import { updateMemberTeam } from "@/app/(dashboard)/employees/team-actions";
import { saveCustomFieldValues } from "@/app/(dashboard)/employees/custom-field-actions";
import { setMemberRightsProfile } from "@/app/(dashboard)/settings/rights-profiles/actions";
import { WorkProfileSection, type WorkProfileAssignmentRow } from "./work-profile-section";
import { ApprovalProfileSection } from "./approval-profile-section";
import { NoticePeriodSection } from "./notice-period-section";
import { HolidayProfileSection } from "./holiday-profile-section";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";

type Member = {
  member_id: string;
  first_name: string;
  last_name: string;
  email: string;
  role: string;
  team_id: string | null;
  payroll_number: string | null;
  avatar_url: string | null;
  invited_at: string | null;
  accepted_at: string | null;
  user_id: string | null;
  custom_fields: Record<string, unknown>;
  updated_at: string;
  start_date: string | null;
  current_profile_id: string | null;
};

// Canonical FieldDef type from custom-field-actions — imported below.
// The old local duplicate here shadowed the canonical type and got left
// behind when input_mode was added, which broke the Vercel build. See
// "Schema change discipline" in CLAUDE.md — always import canonical
// types for rows from schema-drift-prone tables.

interface EmploymentFormProps {
  member: Member;
  canEdit: boolean;
  canDelete: boolean;
  teams: { id: string; name: string }[];
  // CLE-201a — legacy Admin/Employee Profile pickers removed. Props
  // kept for backwards compat but ignored; safe to delete once every
  // caller stops threading them (page.tsx, edit-employee-dialog, etc.
  // update in the same slice).
  adminProfiles?: { id: string; name: string }[];
  employeeProfiles?: { id: string; name: string }[];
  customFieldDefs: FieldDef[];
  currencySymbol: string;
  workProfileAssignments: WorkProfileAssignmentRow[];
  orgWorkProfiles: { id: string; name: string }[];
  orgDefaultWorkProfileId: string | null;
  /** CLE-198 — When false, sensitive-field inputs render as a `•••`
   *  read-only cell instead of the editable input, and the field is
   *  omitted from the values submitted on Save. Defaults to true so
   *  legacy callers that haven't wired the resolver don't accidentally
   *  under-redact. */
  canViewSensitiveFields?: boolean;
  /** CLE-198 — When false, sensitive-field inputs render read-only
   *  even if the viewer can see the value. Defaults to true. */
  canEditSensitiveFields?: boolean;
  /** User Rights profiles assignable to this member (org-scoped list). */
  rightsProfiles?: { id: string; name: string }[];
  /** Whether the Caller can change the assigned User Rights profile.
   *  When false the Select renders read-only. */
  canEditRightsProfiles?: boolean;
}

export function EmploymentForm({
  member,
  canEdit,
  canDelete,
  teams,
  customFieldDefs,
  currencySymbol,
  workProfileAssignments,
  orgWorkProfiles,
  orgDefaultWorkProfileId,
  canViewSensitiveFields = true,
  canEditSensitiveFields = true,
  rightsProfiles = [],
  canEditRightsProfiles = false,
}: EmploymentFormProps) {
  const { memberLabel } = useMemberLabel();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [firstName, setFirstName] = useState(member.first_name);
  const [lastName, setLastName] = useState(member.last_name);
  const [payrollNumber, setPayrollNumber] = useState(member.payroll_number ?? "");
  // CLE-201a — role state kept for the header display badge below and
  // for the (legacy) updateEmployee call payload until the action's
  // signature is trimmed in CLE-201c. Not user-editable.
  const [role] = useState(member.role);
  const [teamId, setTeamId] = useState<string | null>(member.team_id);
  const [rightsProfileId, setRightsProfileId] = useState<string | null>(member.current_profile_id);
  const [startDate, setStartDate] = useState(member.start_date ?? "");
  const [avatarUrl, setAvatarUrl] = useState(member.avatar_url);
  const [invitedAt, setInvitedAt] = useState(member.invited_at);
  const [customValues, setCustomValues] = useState<Record<string, unknown>>(member.custom_fields ?? {});

  const [loading, setLoading] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);

  const isOwner = member.role === "owner";
  const isAccepted = !!member.accepted_at;
  const isInvited = !!invitedAt;

  // Dirty check — enables the Save button only when the form contains
  // an actual change vs. the row initially loaded. JSON.stringify keeps
  // the check compact and covers the multi-key custom fields blob.
  const initialCustomJson = JSON.stringify(member.custom_fields ?? {});
  const currentCustomJson = JSON.stringify(customValues ?? {});
  const hasChanges =
    firstName !== member.first_name ||
    lastName !== member.last_name ||
    (payrollNumber.trim() || null) !== (member.payroll_number ?? null) ||
    teamId !== member.team_id ||
    (startDate || null) !== (member.start_date ?? null) ||
    rightsProfileId !== member.current_profile_id ||
    currentCustomJson !== initialCustomJson;

  const inviteLabel = isAccepted
    ? "Accepted"
    : inviting
    ? "Sending..."
    : isInvited
    ? "Resend Invite"
    : "Invite";

  const rightsProfileChanged =
    canEditRightsProfiles &&
    rightsProfileId !== null &&
    rightsProfileId !== member.current_profile_id;

  // Split "did the employee-record fields (name/team/payroll/start/CF)
  // change?" from "did User Rights change?" so a Rights-only save
  // doesn't need to route through updateEmployee (which requires its
  // own permission checks) — and vice versa.
  const employmentFieldsChanged =
    firstName !== member.first_name ||
    lastName !== member.last_name ||
    (payrollNumber.trim() || null) !== (member.payroll_number ?? null) ||
    teamId !== member.team_id ||
    (startDate || null) !== (member.start_date ?? null) ||
    currentCustomJson !== initialCustomJson;

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    // Allow save if either the caller can edit the tab, or only User
    // Rights changed and the caller can edit those. Prevents a Rights
    // editor without employment.update from being blocked from saving
    // the one field they are allowed to change.
    if (!canEdit && !rightsProfileChanged) return;
    setLoading(true);
    setError(null);
    setSuccess(null);

    // Only touch the employment-record path when at least one of those
    // fields actually changed. This decouples a User Rights save from
    // updateEmployee's separate permission checks (getCallerMembership
    // needs canCreateUsers/canInviteUsers).
    if (canEdit && employmentFieldsChanged) {
      const result = await updateEmployee({
        memberId: member.member_id,
        firstName,
        lastName,
        role,
        payrollNumber: payrollNumber.trim() || null,
        teamId,
        // CLE-201a — legacy profileId omitted; the action ignores an
        // undefined value.
        updatedAt: member.updated_at,
        startDate: startDate || null,
      });
      if (!result.success) {
        setError(result.error ?? "Failed to update");
        setLoading(false);
        return;
      }

      // CLE-185 — single team per member. Update separately so audit captures
      // the team change cleanly even when other fields are unchanged.
      const res = await updateMemberTeam(member.member_id, teamId, true);
      if (!res.success) {
        setError(res.error ?? "Failed to update team");
        setLoading(false);
        return;
      }

      // Required custom fields
      for (const def of customFieldDefs) {
        if (def.required) {
          const val = customValues[def.field_key];
          if (val === undefined || val === null || val === "") {
            setError(`${def.label} is required`);
            setLoading(false);
            return;
          }
        }
      }
      if (customFieldDefs.length > 0) {
        const res = await saveCustomFieldValues(member.member_id, customValues);
        if (!res.success) {
          setError(res.error ?? "Failed to save custom fields");
          setLoading(false);
          return;
        }
      }
    }

    // User Rights profile — always attempt when the picker changed,
    // independent of the employment-field save above. The server
    // action re-checks canEditRightsProfiles and writes an audit_log
    // row on real change.
    if (rightsProfileChanged && rightsProfileId) {
      const rpRes = await setMemberRightsProfile(member.member_id, rightsProfileId);
      if (!rpRes.success) {
        setError(rpRes.error ?? "Failed to update User Rights");
        setLoading(false);
        return;
      }
    }

    setLoading(false);
    setSuccess("Changes saved.");
    router.refresh();
  }

  async function handleInvite() {
    setInviting(true);
    setError(null);
    setSuccess(null);
    const res = await sendInvite(member.member_id);
    if (!res.success) {
      setError(res.error ?? "Failed to send invite");
    } else {
      setSuccess("Invite sent.");
      if (res.invited_at) setInvitedAt(res.invited_at);
    }
    setInviting(false);
  }

  async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarUploading(true);
    setAvatarError(null);
    const fd = new FormData();
    fd.append("avatar", file);
    const res = await uploadMemberAvatar(member.member_id, fd);
    if (res.success && res.avatarUrl) {
      setAvatarUrl(res.avatarUrl);
      router.refresh();
    } else {
      setAvatarError(res.error ?? "Upload failed");
    }
    setAvatarUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleDelete() {
    setDeleting(true);
    const res = await deleteEmployee(member.member_id);
    setDeleting(false);
    if (!res.success) {
      setError(res.error ?? "Failed to delete");
      return;
    }
    router.push("/employees");
  }

  const initials = [firstName, lastName]
    .map((n) => n?.charAt(0).toUpperCase() ?? "")
    .join("");

  return (
    <form onSubmit={handleSave} className="space-y-6">
      {error && (
        <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
      )}
      {success && (
        <div className="rounded-md bg-green-500/10 p-3 text-sm text-green-700 dark:text-green-400">{success}</div>
      )}

      <Tabs defaultValue="details">
        <TabsList className={customFieldDefs.length > 0 ? "" : "hidden"}>
          <TabsTrigger value="details">Details</TabsTrigger>
          {customFieldDefs.length > 0 && (
            <TabsTrigger value="custom-fields">Custom Fields</TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="details" className="mt-4 space-y-4">
          <Card>
            <CardContent className="space-y-4 pt-6">
              {/* Avatar */}
              <div className="flex items-center gap-4">
                {avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={avatarUrl}
                    alt={`${firstName} ${lastName}`}
                    className="h-24 w-24 shrink-0 rounded-full object-cover"
                  />
                ) : (
                  <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-full bg-muted">
                    <span className="text-2xl font-medium text-muted-foreground">{initials}</span>
                  </div>
                )}
                <div className="space-y-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!canEdit || avatarUploading}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    {avatarUploading ? "Uploading..." : "Change photo"}
                  </Button>
                  {avatarError && <p className="text-xs text-destructive">{avatarError}</p>}
                  <p className="text-xs text-muted-foreground">JPG, PNG, WebP or GIF — max 5MB</p>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  className="hidden"
                  onChange={handleAvatarChange}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">Email Address</Label>
                <Input id="email" type="email" value={member.email} disabled className="bg-muted" />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="first-name">First Name</Label>
                  <Input
                    id="first-name"
                    type="text"
                    maxLength={50}
                    required
                    disabled={!canEdit}
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="last-name">Last Name</Label>
                  <Input
                    id="last-name"
                    type="text"
                    maxLength={50}
                    required
                    disabled={!canEdit}
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                  />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="payroll">Payroll Number</Label>
                  <Input
                    id="payroll"
                    type="text"
                    placeholder="Optional"
                    maxLength={50}
                    disabled={!canEdit}
                    value={payrollNumber}
                    onChange={(e) => setPayrollNumber(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="start-date">Start Date</Label>
                  <Input
                    id="start-date"
                    type="date"
                    disabled={!canEdit}
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                  />
                </div>
              </div>

              {/* User Rights — replaces the legacy Role selector. Change
                  is queued in local state and committed via Save (goes
                  through setMemberRightsProfile, which audits). */}
              <div className="space-y-2">
                <Label>User Rights</Label>
                {canEditRightsProfiles && rightsProfiles.length > 0 ? (
                  <Select
                    value={rightsProfileId ?? ""}
                    onValueChange={(v) => setRightsProfileId(v || null)}
                    disabled={!canEditRightsProfiles}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Choose a profile" />
                    </SelectTrigger>
                    <SelectContent>
                      {rightsProfiles.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    value={
                      rightsProfiles.find((p) => p.id === rightsProfileId)?.name ??
                      "Unassigned"
                    }
                    disabled
                    className="bg-muted"
                  />
                )}
              </div>

              {teams.length > 0 && (
                <div className="space-y-2">
                  <Label>Team</Label>
                  <Select
                    value={teamId ?? "__none__"}
                    disabled={!canEdit}
                    onValueChange={(v) => setTeamId(v === "__none__" ? null : v)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">No team</SelectItem>
                      {teams.map((team) => (
                        <SelectItem key={team.id} value={team.id}>
                          {team.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <WorkProfileSection
                memberId={member.member_id}
                assignments={workProfileAssignments}
                orgWorkProfiles={orgWorkProfiles}
                orgDefaultWorkProfileId={orgDefaultWorkProfileId}
                canEdit={canEdit}
              />

              {/* CLE-186 — per-employee Approval Profile picker */}
              <ApprovalProfileSection
                memberId={member.member_id}
                canEdit={canEdit}
              />

              {/* CLE-194 — per-employee Notice Period Profile picker */}
              <NoticePeriodSection
                memberId={member.member_id}
                canEdit={canEdit}
              />

              {/* CLE-194 Phase 2 — per-employee Holiday Profile picker */}
              <HolidayProfileSection
                memberId={member.member_id}
                canEdit={canEdit}
              />

              {/* CLE-201a — Legacy Admin/Employee Profile picker
                  retired. User Rights assignment now lives in the
                  standalone <UserRightsPicker> card below this form. */}
            </CardContent>
          </Card>
        </TabsContent>

        {customFieldDefs.length > 0 && (
          <TabsContent value="custom-fields" className="mt-4">
            <Card>
              <CardContent className="space-y-4 pt-6">
                {customFieldDefs.map((def) => {
                  // CLE-198 — Resolve sensitive-field rendering.
                  //   • !view    → show a `•••` placeholder, no input
                  //   • view+!edit → render input disabled+readOnly
                  //   • view+edit → normal (canEdit still applies)
                  const isSensitive = def.is_sensitive === true;
                  const hideValue = isSensitive && !canViewSensitiveFields;
                  const lockValue = isSensitive && !canEditSensitiveFields;
                  const inputDisabled = !canEdit || lockValue;

                  return (
                  <div key={def.field_key} className="space-y-1">
                    <Label htmlFor={`cf-${def.field_key}`}>
                      {def.label}
                      {def.required && <span className="ml-0.5 text-destructive">*</span>}
                      {isSensitive && (
                        <span className="ml-1.5 text-xs text-amber-600 dark:text-amber-400" title="Sensitive field">
                          (sensitive)
                        </span>
                      )}
                    </Label>
                    {hideValue ? (
                      <div className="text-sm text-muted-foreground py-2">•••</div>
                    ) : (
                    // Input-mode preflight (multi/single choice) takes
                    // precedence over the free-form type chain below.
                    // Options-driven inputs render their value through
                    // the shared MultiSelect / SingleSelect, which
                    // apply the base-type formatter to each option.
                    def.input_mode === "multi_choice" ? (
                      <CustomFieldMultiSelect
                        id={`cf-${def.field_key}`}
                        options={def.options ?? []}
                        value={normaliseMultiselectValue(customValues[def.field_key])}
                        onChange={(next) => setCustomValues((prev) => ({ ...prev, [def.field_key]: next }))}
                        disabled={inputDisabled}
                        fieldType={def.field_type}
                        currencySymbol={currencySymbol}
                        maxDecimalPlaces={def.max_decimal_places}
                      />
                    ) : def.input_mode === "single_choice" ? (
                      <CustomFieldSingleSelect
                        id={`cf-${def.field_key}`}
                        options={def.options ?? []}
                        value={String(customValues[def.field_key] ?? "")}
                        onChange={(next) => setCustomValues((prev) => ({ ...prev, [def.field_key]: next }))}
                        disabled={inputDisabled}
                        fieldType={def.field_type}
                        currencySymbol={currencySymbol}
                        maxDecimalPlaces={def.max_decimal_places}
                        allowClear={!def.required}
                      />
                    ) : def.field_type === "checkbox" ? (
                      <div>
                        <Switch
                          id={`cf-${def.field_key}`}
                          disabled={inputDisabled}
                          checked={customValues[def.field_key] === true}
                          onCheckedChange={(v) => setCustomValues((prev) => ({ ...prev, [def.field_key]: v }))}
                        />
                      </div>
                    ) : def.field_type === "multiline" ? (
                      <Textarea
                        id={`cf-${def.field_key}`}
                        disabled={inputDisabled}
                        rows={3}
                        value={String(customValues[def.field_key] ?? "")}
                        onChange={(e) => setCustomValues((prev) => ({ ...prev, [def.field_key]: e.target.value }))}
                      />
                    ) : def.field_type === "currency" ? (
                      <div className="flex items-center gap-1.5">
                        <span className="shrink-0 text-sm text-muted-foreground">{currencySymbol}</span>
                        <Input
                          id={`cf-${def.field_key}`}
                          type="number"
                          step="0.01"
                          disabled={inputDisabled}
                          value={String(customValues[def.field_key] ?? "")}
                          onChange={(e) => setCustomValues((prev) => ({ ...prev, [def.field_key]: e.target.value }))}
                          className="flex-1"
                        />
                      </div>
                    ) : (
                      <Input
                        id={`cf-${def.field_key}`}
                        type={def.field_type === "number" ? "number" : def.field_type === "date" ? "date" : def.field_type === "email" ? "email" : def.field_type === "url" ? "url" : def.field_type === "phone" ? "tel" : "text"}
                        step={def.field_type === "number" ? (def.max_decimal_places === null || def.max_decimal_places === undefined ? "any" : def.max_decimal_places === 0 ? "1" : String(Math.pow(10, -def.max_decimal_places))) : undefined}
                        disabled={inputDisabled}
                        value={String(customValues[def.field_key] ?? "")}
                        onChange={(e) => setCustomValues((prev) => ({ ...prev, [def.field_key]: e.target.value }))}
                      />
                    ))}
                  </div>
                  );
                })}
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>

      {/* Primary action row */}
      <div className="flex items-center justify-end gap-2">
        {!isAccepted && (
          <Button type="button" variant="secondary" onClick={handleInvite} disabled={inviting || !canEdit}>
            {inviteLabel}
          </Button>
        )}
        <Button
          type="submit"
          disabled={
            loading ||
            !hasChanges ||
            (!canEdit && !rightsProfileChanged)
          }
        >
          {loading ? "Saving..." : "Save"}
        </Button>
      </div>

      {/* Danger zone */}
      {canDelete && (
        <Card className="border-destructive/50">
          <CardHeader>
            <CardTitle className="text-destructive">Danger zone</CardTitle>
          </CardHeader>
          <CardContent>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button type="button" variant="destructive" disabled={deleting}>
                  Delete {capitalize(memberLabel)}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete {firstName} {lastName}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will remove this {memberLabel} from the organisation
                    {member.user_id ? " and delete their user account" : ""}. This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handleDelete} disabled={deleting}>
                    {deleting ? "Deleting..." : "Delete"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </CardContent>
        </Card>
      )}
    </form>
  );
}
