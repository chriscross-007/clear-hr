"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { useMemberLabel } from "@/contexts/member-label-context";
import { capitalize } from "@/lib/label-utils";
import {
  updateEmployee,
  sendInvite,
  uploadMemberAvatar,
  deleteEmployee,
} from "@/app/(dashboard)/employees/actions";
import {
  updateMemberTeam,
  setMemberTeams,
} from "@/app/(dashboard)/employees/team-actions";
import { saveCustomFieldValues } from "@/app/(dashboard)/employees/custom-field-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
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
  selected_team_ids: string[];
};

type FieldDef = {
  id: string;
  label: string;
  field_key: string;
  field_type: string;
  options: string[] | null;
  required: boolean;
  sort_order: number;
  max_decimal_places: number | null;
};

interface EmploymentFormProps {
  member: Member;
  canEdit: boolean;
  canDelete: boolean;
  teams: { id: string; name: string }[];
  adminProfiles: { id: string; name: string }[];
  employeeProfiles: { id: string; name: string }[];
  customFieldDefs: FieldDef[];
  currencySymbol: string;
}

export function EmploymentForm({
  member,
  canEdit,
  canDelete,
  teams,
  adminProfiles,
  employeeProfiles,
  customFieldDefs,
  currencySymbol,
}: EmploymentFormProps) {
  const { memberLabel } = useMemberLabel();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [firstName, setFirstName] = useState(member.first_name);
  const [lastName, setLastName] = useState(member.last_name);
  const [payrollNumber, setPayrollNumber] = useState(member.payroll_number ?? "");
  const [role, setRole] = useState(member.role);
  const [teamId, setTeamId] = useState<string | null>(member.team_id);
  const [selectedTeamIds, setSelectedTeamIds] = useState<string[]>(member.selected_team_ids);
  const [profileId, setProfileId] = useState<string>(member.current_profile_id ?? "__none__");
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
  const isMultiTeam = role === "admin" || role === "owner";
  const isAccepted = !!member.accepted_at;
  const isInvited = !!invitedAt;

  const inviteLabel = isAccepted
    ? "Accepted"
    : inviting
    ? "Sending..."
    : isInvited
    ? "Resend Invite"
    : "Invite";

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!canEdit) return;
    setLoading(true);
    setError(null);
    setSuccess(null);

    const teamIds = isMultiTeam ? selectedTeamIds : (teamId ? [teamId] : []);

    const result = await updateEmployee({
      memberId: member.member_id,
      firstName,
      lastName,
      role,
      payrollNumber: payrollNumber.trim() || null,
      teamIds,
      isMultiTeam,
      profileId,
      updatedAt: member.updated_at,
      startDate: startDate || null,
    });
    if (!result.success) {
      setError(result.error ?? "Failed to update");
      setLoading(false);
      return;
    }

    // Team assignment
    if (isMultiTeam) {
      const res = await setMemberTeams(member.member_id, selectedTeamIds, true);
      if (!res.success) {
        setError(res.error ?? "Failed to update teams");
        setLoading(false);
        return;
      }
    } else {
      const res = await updateMemberTeam(member.member_id, teamId, true);
      if (!res.success) {
        setError(res.error ?? "Failed to update team");
        setLoading(false);
        return;
      }
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

              <div className="space-y-2">
                <Label>Role</Label>
                {isOwner ? (
                  <Input value="Owner" disabled className="bg-muted" />
                ) : (
                  <Select
                    value={role}
                    disabled={!canEdit}
                    onValueChange={(v) => { setRole(v); setProfileId("__none__"); }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="admin">Admin</SelectItem>
                      <SelectItem value="employee">{capitalize(memberLabel)}</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </div>

              {teams.length > 0 && (
                <div className="space-y-2">
                  <Label>{isMultiTeam ? "Teams" : "Team"}</Label>
                  {isMultiTeam ? (
                    <div className="space-y-2 rounded-md border p-3">
                      {teams.map((team) => (
                        <div key={team.id} className="flex items-center gap-2">
                          <Checkbox
                            id={`team-${team.id}`}
                            disabled={!canEdit}
                            checked={selectedTeamIds.includes(team.id)}
                            onCheckedChange={(checked) => {
                              setSelectedTeamIds((prev) =>
                                checked ? [...prev, team.id] : prev.filter((id) => id !== team.id),
                              );
                            }}
                          />
                          <label htmlFor={`team-${team.id}`} className="text-sm font-medium leading-none">
                            {team.name}
                          </label>
                        </div>
                      ))}
                    </div>
                  ) : (
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
                  )}
                </div>
              )}

              {!isOwner && (() => {
                const applicable = role === "admin" ? adminProfiles : employeeProfiles;
                if (applicable.length === 0) return null;
                return (
                  <div className="space-y-2">
                    <Label>Rights Profile</Label>
                    <Select value={profileId} disabled={!canEdit} onValueChange={setProfileId}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">No profile</SelectItem>
                        {applicable.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                );
              })()}
            </CardContent>
          </Card>
        </TabsContent>

        {customFieldDefs.length > 0 && (
          <TabsContent value="custom-fields" className="mt-4">
            <Card>
              <CardContent className="space-y-4 pt-6">
                {customFieldDefs.map((def) => (
                  <div key={def.field_key} className="space-y-1">
                    <Label htmlFor={`cf-${def.field_key}`}>
                      {def.label}
                      {def.required && <span className="ml-0.5 text-destructive">*</span>}
                    </Label>
                    {def.field_type === "checkbox" ? (
                      <div>
                        <Switch
                          id={`cf-${def.field_key}`}
                          disabled={!canEdit}
                          checked={customValues[def.field_key] === true}
                          onCheckedChange={(v) => setCustomValues((prev) => ({ ...prev, [def.field_key]: v }))}
                        />
                      </div>
                    ) : def.field_type === "multiline" ? (
                      <Textarea
                        id={`cf-${def.field_key}`}
                        disabled={!canEdit}
                        rows={3}
                        value={String(customValues[def.field_key] ?? "")}
                        onChange={(e) => setCustomValues((prev) => ({ ...prev, [def.field_key]: e.target.value }))}
                      />
                    ) : def.field_type === "dropdown" ? (
                      <Select
                        disabled={!canEdit}
                        value={String(customValues[def.field_key] ?? "__none__")}
                        onValueChange={(v) => setCustomValues((prev) => ({ ...prev, [def.field_key]: v === "__none__" ? "" : v }))}
                      >
                        <SelectTrigger id={`cf-${def.field_key}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {!def.required && <SelectItem value="__none__">—</SelectItem>}
                          {(def.options ?? []).map((opt) => (
                            <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : def.field_type === "currency" ? (
                      <div className="flex items-center gap-1.5">
                        <span className="shrink-0 text-sm text-muted-foreground">{currencySymbol}</span>
                        <Input
                          id={`cf-${def.field_key}`}
                          type="number"
                          step="0.01"
                          disabled={!canEdit}
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
                        disabled={!canEdit}
                        value={String(customValues[def.field_key] ?? "")}
                        onChange={(e) => setCustomValues((prev) => ({ ...prev, [def.field_key]: e.target.value }))}
                      />
                    )}
                  </div>
                ))}
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
        <Button type="submit" disabled={loading || !canEdit}>
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
