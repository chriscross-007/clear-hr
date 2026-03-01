"use client";

import { useState } from "react";
import { useMemberLabel } from "@/contexts/member-label-context";
import { capitalize } from "@/lib/label-utils";
import { addEmployee } from "./actions";
import { assignProfile } from "./profile-actions";
import type { Profile } from "./profile-actions";
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
import type { Member, Team } from "./employees-client";

interface AddEmployeeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  teams: Team[];
  employeeProfiles: Profile[];
  customFieldDefs: FieldDef[];
  onAdded: (member: Member) => void;
}

export function AddEmployeeDialog({
  open,
  onOpenChange,
  teams,
  employeeProfiles,
  customFieldDefs,
  onAdded,
}: AddEmployeeDialogProps) {
  const { memberLabel } = useMemberLabel();
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [payrollNumber, setPayrollNumber] = useState("");
  const [teamId, setTeamId] = useState<string | null>(null);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [customValues, setCustomValues] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function resetForm() {
    setEmail("");
    setFirstName("");
    setLastName("");
    setPayrollNumber("");
    setTeamId(null);
    setProfileId(null);
    setCustomValues({});
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const result = await addEmployee({
      email,
      firstName,
      lastName,
      teamId,
      payrollNumber: payrollNumber.trim() || null,
    });

    if (!result.success) {
      setError(result.error ?? "Failed to add");
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

    // Assign employee profile if selected
    if (profileId && result.member) {
      await assignProfile(result.member.member_id, "employee", profileId);
    }

    // Save custom field values if any
    if (result.member && customFieldDefs.length > 0 && Object.keys(customValues).length > 0) {
      await saveCustomFieldValues(result.member.member_id, customValues);
    }

    setLoading(false);
    resetForm();
    onAdded(result.member!);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) resetForm();
        onOpenChange(isOpen);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add New {capitalize(memberLabel)}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="add-email">Email Address</Label>
            <Input
              id="add-email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="add-first-name">First Name</Label>
            <Input
              id="add-first-name"
              type="text"
              placeholder="First name"
              maxLength={50}
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="add-last-name">Last Name</Label>
            <Input
              id="add-last-name"
              type="text"
              placeholder="Last name"
              maxLength={50}
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="add-payroll">Payroll Number</Label>
            <Input
              id="add-payroll"
              type="text"
              placeholder="Optional"
              maxLength={50}
              value={payrollNumber}
              onChange={(e) => setPayrollNumber(e.target.value)}
            />
          </div>
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
          {employeeProfiles.length > 0 && (
            <div className="space-y-2">
              <Label>Rights Profile</Label>
              <Select
                value={profileId ?? "__none__"}
                onValueChange={(v) => setProfileId(v === "__none__" ? null : v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">No profile</SelectItem>
                  {employeeProfiles.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {customFieldDefs.length > 0 && (
            <div className="space-y-3 rounded-md border p-3">
              <p className="text-sm font-medium">Custom Fields</p>
              {customFieldDefs.map((def) => (
                <div key={def.field_key} className="space-y-1">
                  <Label htmlFor={`acf-${def.field_key}`}>
                    {def.label}{def.required && <span className="text-destructive ml-0.5">*</span>}
                  </Label>
                  {def.field_type === "checkbox" ? (
                    <div className="flex items-center gap-2">
                      <Switch
                        id={`acf-${def.field_key}`}
                        checked={customValues[def.field_key] === true}
                        onCheckedChange={(v) => setCustomValues((prev) => ({ ...prev, [def.field_key]: v }))}
                      />
                    </div>
                  ) : def.field_type === "multiline" ? (
                    <Textarea
                      id={`acf-${def.field_key}`}
                      value={String(customValues[def.field_key] ?? "")}
                      onChange={(e) => setCustomValues((prev) => ({ ...prev, [def.field_key]: e.target.value }))}
                      rows={3}
                    />
                  ) : def.field_type === "dropdown" ? (
                    <Select
                      value={String(customValues[def.field_key] ?? "__none__")}
                      onValueChange={(v) => setCustomValues((prev) => ({ ...prev, [def.field_key]: v === "__none__" ? "" : v }))}
                    >
                      <SelectTrigger id={`acf-${def.field_key}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {!def.required && <SelectItem value="__none__">—</SelectItem>}
                        {(def.options ?? []).map((opt) => (
                          <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      id={`acf-${def.field_key}`}
                      type={def.field_type === "number" ? "number" : def.field_type === "date" ? "date" : def.field_type === "email" ? "email" : def.field_type === "url" ? "url" : def.field_type === "phone" ? "tel" : "text"}
                      value={String(customValues[def.field_key] ?? "")}
                      onChange={(e) => setCustomValues((prev) => ({ ...prev, [def.field_key]: e.target.value }))}
                    />
                  )}
                </div>
              ))}
            </div>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Adding..." : `Add ${capitalize(memberLabel)}`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
