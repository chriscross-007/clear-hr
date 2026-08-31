"use client";

import { useState, useEffect, useRef } from "react";
import {
  CustomFieldMultiSelect,
  CustomFieldSingleSelect,
  normaliseMultiselectValue,
} from "@/components/custom-field-multiselect";
import { useMemberLabel } from "@/contexts/member-label-context";
import { capitalize } from "@/lib/label-utils";
import { updateEmployee, sendInvite, uploadMemberAvatar, getMemberHolidayFields } from "./actions";
import { updateMemberTeam } from "./team-actions";
import type { FieldDef } from "./custom-field-actions";
import { saveCustomFieldValues } from "./custom-field-actions";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import type { Member, Team } from "./employees-client";

interface EditEmployeeDialogProps {
  member: Member | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  teams: Team[];
  customFieldDefs: FieldDef[];
  currencySymbol: string;
  onSaved: (updated: {
    member_id: string;
    first_name: string;
    last_name: string;
    team_id: string | null;
    payroll_number: string | null;
    custom_fields: Record<string, unknown>;
  }) => void;
  onAvatarChanged: (memberId: string, avatarUrl: string) => void;
  onInviteStatusChanged: (memberId: string, invitedAt: string) => void;
}

export function EditEmployeeDialog({
  member,
  open,
  onOpenChange,
  teams,
  customFieldDefs,
  currencySymbol,
  onSaved,
  onAvatarChanged,
  onInviteStatusChanged,
}: EditEmployeeDialogProps) {
  const { memberLabel } = useMemberLabel();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [payrollNumber, setPayrollNumber] = useState("");
  // CLE-201c-9 — legacy `role` state removed. Access level is
  // driven by rights_profile_id, edited on the Employment page.
  const [teamId, setTeamId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [inviteSuccess, setInviteSuccess] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [customValues, setCustomValues] = useState<Record<string, unknown>>({});

  useEffect(() => {
    if (member) {
      setFirstName(member.first_name);
      setLastName(member.last_name);
      setPayrollNumber(member.payroll_number ?? "");
      setTeamId(member.team_id);
      setError(null);
      setInviteSuccess(false);
      setStartDate("");
      setCustomValues(member.custom_fields ?? {});
      // Load start_date
      getMemberHolidayFields(member.member_id).then((result) => {
        if (result.success) {
          setStartDate(result.startDate ?? "");
        }
      });
      // CLE-201c — Legacy getMemberProfile call retired. User Rights
      // profile is loaded + edited via the dedicated picker on the
      // Employment page, not here.
    }
  }, [member]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!member) return;

    setLoading(true);
    setError(null);

    const result = await updateEmployee({
      memberId: member.member_id,
      firstName,
      lastName,
      payrollNumber: payrollNumber.trim() || null,
      teamId,
      updatedAt: member.updated_at,
      startDate: startDate || null,
    });

    if (!result.success) {
      setError(result.error ?? "Failed to update");
      setLoading(false);
      return;
    }

    // CLE-185 — single team per member.
    const teamResult = await updateMemberTeam(member.member_id, teamId, true);
    if (!teamResult.success) {
      setError(teamResult.error ?? "Failed to update team");
      setLoading(false);
      return;
    }

    // Validate required custom fields
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

    // Save custom field values
    if (customFieldDefs.length > 0) {
      const cfResult = await saveCustomFieldValues(member.member_id, customValues);
      if (!cfResult.success) {
        setError(cfResult.error ?? "Failed to save custom fields");
        setLoading(false);
        return;
      }
    }

    setLoading(false);
    onSaved({
      member_id: member.member_id,
      first_name: firstName,
      last_name: lastName,
      team_id: teamId,
      payroll_number: payrollNumber.trim() || null,
      custom_fields: customValues,
    });
  }

  async function handleInvite() {
    if (!member) return;
    setInviting(true);
    setError(null);
    setInviteSuccess(false);

    const result = await sendInvite(member.member_id);

    if (!result.success) {
      setError(result.error ?? "Failed to send invite");
    } else {
      setInviteSuccess(true);
      if (result.invited_at) {
        onInviteStatusChanged(member.member_id, result.invited_at);
      }
    }
    setInviting(false);
  }

  async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !member) return;
    setAvatarUploading(true);
    setAvatarError(null);
    const fd = new FormData();
    fd.append("avatar", file);
    const result = await uploadMemberAvatar(member.member_id, fd);
    if (result.success && result.avatarUrl) {
      onAvatarChanged(member.member_id, result.avatarUrl);
    } else {
      setAvatarError(result.error ?? "Upload failed");
    }
    setAvatarUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  const isAccepted = !!member?.accepted_at;
  const isInvited = !!member?.invited_at;

  function getInviteButtonLabel() {
    if (isAccepted) return "Accepted";
    if (inviting) return "Sending...";
    if (isInvited) return "Resend Invite";
    return "Invite";
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit {capitalize(memberLabel)}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="max-h-[60vh] overflow-y-auto space-y-4 pr-1">
          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}
          {inviteSuccess && (
            <div className="rounded-md bg-green-500/10 p-3 text-sm text-green-700 dark:text-green-400">
              Invite sent successfully.
            </div>
          )}
          <Tabs defaultValue="details">
            <TabsList className={customFieldDefs.length > 0 ? "" : "hidden"}>
              <TabsTrigger value="details">Details</TabsTrigger>
              {customFieldDefs.length > 0 && (
                <TabsTrigger value="custom-fields">Custom Fields</TabsTrigger>
              )}
            </TabsList>
            <TabsContent value="details" className="space-y-4 mt-0">
              {/* Avatar upload */}
              <div className="flex items-center gap-4">
                {member?.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={member.avatar_url}
                    alt={`${member.first_name} ${member.last_name}`}
                    className="h-24 w-24 rounded-full object-cover shrink-0"
                  />
                ) : (
                  <div className="h-24 w-24 rounded-full bg-muted flex items-center justify-center shrink-0">
                    <span className="text-2xl font-medium text-muted-foreground">
                      {[member?.first_name, member?.last_name].map((n) => n?.charAt(0).toUpperCase()).join("")}
                    </span>
                  </div>
                )}
                <div className="space-y-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={avatarUploading}
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
                <Label htmlFor="edit-email">Email Address</Label>
                <Input
                  id="edit-email"
                  type="email"
                  value={member?.email ?? ""}
                  disabled
                  className="bg-muted"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-first-name">First Name</Label>
                <Input
                  id="edit-first-name"
                  type="text"
                  maxLength={50}
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-last-name">Last Name</Label>
                <Input
                  id="edit-last-name"
                  type="text"
                  maxLength={50}
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-payroll">Payroll Number</Label>
                <Input
                  id="edit-payroll"
                  type="text"
                  placeholder="Optional"
                  maxLength={50}
                  value={payrollNumber}
                  onChange={(e) => setPayrollNumber(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-start-date">Start Date</Label>
                <Input
                  id="edit-start-date"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
              {/* CLE-201c — Legacy Role picker retired. The User
                  Rights profile picker on the Employment page is
                  now the single surface for changing a Member's
                  rights. The `role` value passed to updateEmployee
                  is unchanged (read from the current record) until
                  the DB column is dropped in a follow-up. */}
              {teams.length > 0 && (
                <div className="space-y-2">
                  <Label>Team</Label>
                  <Select
                    value={teamId ?? "__none__"}
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
              {/* CLE-201a — Legacy Rights Profile picker retired.
                  Assign the User Rights profile on the Employment
                  page instead (dedicated <UserRightsPicker> card). */}
            </TabsContent>
            {customFieldDefs.length > 0 && (
              <TabsContent value="custom-fields" className="space-y-3 mt-0">
                {customFieldDefs.map((def) => (
                  <div key={def.field_key} className="space-y-1">
                    <Label htmlFor={`cf-${def.field_key}`}>
                      {def.label}{def.required && <span className="text-destructive ml-0.5">*</span>}
                    </Label>
                    {/* Input-mode preflight — see employment-form for the
                        same pattern. */}
                    {def.input_mode === "multi_choice" ? (
                      <CustomFieldMultiSelect
                        id={`cf-${def.field_key}`}
                        options={def.options ?? []}
                        value={normaliseMultiselectValue(customValues[def.field_key])}
                        onChange={(next) => setCustomValues((prev) => ({ ...prev, [def.field_key]: next }))}
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
                        fieldType={def.field_type}
                        currencySymbol={currencySymbol}
                        maxDecimalPlaces={def.max_decimal_places}
                        allowClear={!def.required}
                      />
                    ) : def.field_type === "checkbox" ? (
                      <div className="flex items-center gap-2">
                        <Switch
                          id={`cf-${def.field_key}`}
                          checked={customValues[def.field_key] === true}
                          onCheckedChange={(v) => setCustomValues((prev) => ({ ...prev, [def.field_key]: v }))}
                        />
                      </div>
                    ) : def.field_type === "multiline" ? (
                      <Textarea
                        id={`cf-${def.field_key}`}
                        value={String(customValues[def.field_key] ?? "")}
                        onChange={(e) => setCustomValues((prev) => ({ ...prev, [def.field_key]: e.target.value }))}
                        rows={3}
                      />
                    ) : def.field_type === "currency" ? (
                      <div className="flex items-center gap-1.5">
                        <span className="shrink-0 text-sm text-muted-foreground">{currencySymbol}</span>
                        <Input
                          id={`cf-${def.field_key}`}
                          type="number"
                          step="0.01"
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
                        value={String(customValues[def.field_key] ?? "")}
                        onChange={(e) => setCustomValues((prev) => ({ ...prev, [def.field_key]: e.target.value }))}
                      />
                    )}
                  </div>
                ))}
              </TabsContent>
            )}
          </Tabs>
          </div>
          <DialogFooter>
            {!isAccepted && (
              <Button
                type="button"
                variant="secondary"
                onClick={handleInvite}
                disabled={inviting}
              >
                {getInviteButtonLabel()}
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
