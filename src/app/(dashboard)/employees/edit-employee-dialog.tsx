"use client";

import { useState, useEffect } from "react";
import { useMemberLabel } from "@/contexts/member-label-context";
import { capitalize } from "@/lib/label-utils";
import { updateEmployee, sendInvite } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import type { Member } from "./employees-client";

interface EditEmployeeDialogProps {
  member: Member | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (updated: {
    member_id: string;
    first_name: string;
    last_name: string;
  }) => void;
  onInviteStatusChanged: (memberId: string, invitedAt: string) => void;
}

export function EditEmployeeDialog({
  member,
  open,
  onOpenChange,
  onSaved,
  onInviteStatusChanged,
}: EditEmployeeDialogProps) {
  const { memberLabel } = useMemberLabel();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [inviteSuccess, setInviteSuccess] = useState(false);

  useEffect(() => {
    if (member) {
      setFirstName(member.first_name);
      setLastName(member.last_name);
      setError(null);
      setInviteSuccess(false);
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
    });

    if (!result.success) {
      setError(result.error ?? "Failed to update");
      setLoading(false);
      return;
    }

    setLoading(false);
    onSaved({
      member_id: member.member_id,
      first_name: firstName,
      last_name: lastName,
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
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              required
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={handleInvite}
              disabled={isAccepted || inviting}
            >
              {getInviteButtonLabel()}
            </Button>
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
