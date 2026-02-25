"use client";

import { useState, useEffect } from "react";
import { useMemberLabel } from "@/contexts/member-label-context";
import { capitalize } from "@/lib/label-utils";
import { updateEmployee, sendInvite } from "./actions";
import { updateMemberTeam, getMemberTeams, setMemberTeams } from "./team-actions";
import type { Profile } from "./profile-actions";
import { getMemberProfile } from "./profile-actions";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import type { Member, Team } from "./employees-client";

interface EditEmployeeDialogProps {
  member: Member | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  teams: Team[];
  adminProfiles: Profile[];
  employeeProfiles: Profile[];
  onSaved: (updated: {
    member_id: string;
    first_name: string;
    last_name: string;
    role: string;
    team_id: string | null;
    payroll_number: string | null;
  }) => void;
  onInviteStatusChanged: (memberId: string, invitedAt: string) => void;
}

export function EditEmployeeDialog({
  member,
  open,
  onOpenChange,
  teams,
  adminProfiles,
  employeeProfiles,
  onSaved,
  onInviteStatusChanged,
}: EditEmployeeDialogProps) {
  const { memberLabel } = useMemberLabel();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [payrollNumber, setPayrollNumber] = useState("");
  const [role, setRole] = useState("");
  const [teamId, setTeamId] = useState<string | null>(null);
  const [selectedTeamIds, setSelectedTeamIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [inviteSuccess, setInviteSuccess] = useState(false);
  const [profileId, setProfileId] = useState<string>("__none__");

  const isMultiTeam = member?.role === "admin" || member?.role === "owner";

  useEffect(() => {
    if (member) {
      setFirstName(member.first_name);
      setLastName(member.last_name);
      setPayrollNumber(member.payroll_number ?? "");
      setRole(member.role);
      setTeamId(member.team_id);
      setError(null);
      setInviteSuccess(false);
      setProfileId("__none__");
      // Load the member's current profile assignment
      getMemberProfile(member.member_id).then((result) => {
        if (result.success) {
          const isAdmin = member.role === "admin" || member.role === "owner";
          const currentId = isAdmin ? result.adminProfileId : result.employeeProfileId;
          setProfileId(currentId ?? "__none__");
        }
      });

      // Load multi-team assignments for admins/owners
      if (member.role === "admin" || member.role === "owner") {
        getMemberTeams(member.member_id).then((result) => {
          if (result.success && result.teamIds) {
            setSelectedTeamIds(result.teamIds);
          } else {
            setSelectedTeamIds(member.team_id ? [member.team_id] : []);
          }
        });
      } else {
        setSelectedTeamIds([]);
      }
    }
  }, [member]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!member) return;

    setLoading(true);
    setError(null);

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
    });

    if (!result.success) {
      setError(result.error ?? "Failed to update");
      setLoading(false);
      return;
    }

    // Save team assignment (audit is handled by updateEmployee)
    if (isMultiTeam) {
      const teamResult = await setMemberTeams(member.member_id, selectedTeamIds, true);
      if (!teamResult.success) {
        setError(teamResult.error ?? "Failed to update teams");
        setLoading(false);
        return;
      }
    } else {
      const teamResult = await updateMemberTeam(member.member_id, teamId, true);
      if (!teamResult.success) {
        setError(teamResult.error ?? "Failed to update team");
        setLoading(false);
        return;
      }
    }

    setLoading(false);
    onSaved({
      member_id: member.member_id,
      first_name: firstName,
      last_name: lastName,
      role,
      team_id: isMultiTeam ? (selectedTeamIds[0] ?? null) : teamId,
      payroll_number: payrollNumber.trim() || null,
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
        <form onSubmit={handleSubmit} className="space-y-4">
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
            <Label>Role</Label>
            {member?.role === "owner" ? (
              <Input value="Owner" disabled className="bg-muted" />
            ) : (
              <Select value={role} onValueChange={(v) => { setRole(v); setProfileId("__none__"); }}>
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
                        checked={selectedTeamIds.includes(team.id)}
                        onCheckedChange={(checked) => {
                          setSelectedTeamIds((prev) =>
                            checked
                              ? [...prev, team.id]
                              : prev.filter((id) => id !== team.id)
                          );
                        }}
                      />
                      <label
                        htmlFor={`team-${team.id}`}
                        className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                      >
                        {team.name}
                      </label>
                    </div>
                  ))}
                </div>
              ) : (
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
              )}
            </div>
          )}
          {member?.role !== "owner" && (() => {
            const applicableProfiles = role === "admin" ? adminProfiles : employeeProfiles;
            if (applicableProfiles.length === 0) return null;
            return (
              <div className="space-y-2">
                <Label>Rights Profile</Label>
                <Select
                  value={profileId}
                  onValueChange={setProfileId}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">No profile</SelectItem>
                    {applicableProfiles.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            );
          })()}
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
