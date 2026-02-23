"use client";

import { useState } from "react";
import { useMemberLabel } from "@/contexts/member-label-context";
import { capitalize } from "@/lib/label-utils";
import { addEmployee } from "./actions";
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
  onAdded: (member: Member) => void;
}

export function AddEmployeeDialog({
  open,
  onOpenChange,
  teams,
  onAdded,
}: AddEmployeeDialogProps) {
  const { memberLabel } = useMemberLabel();
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [payrollNumber, setPayrollNumber] = useState("");
  const [teamId, setTeamId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function resetForm() {
    setEmail("");
    setFirstName("");
    setLastName("");
    setPayrollNumber("");
    setTeamId(null);
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
