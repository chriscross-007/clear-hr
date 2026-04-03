"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Info, Plus, Trash2 } from "lucide-react";
import { updateOrganisation } from "./organisation-actions";
import { getTeams, createTeam, deleteTeam, renameTeams } from "./employees/team-actions";
import { getProfiles } from "./employees/profile-actions";
import type { Profile } from "./employees/profile-actions";
import { ADMIN_RIGHTS, EMPLOYEE_RIGHTS } from "@/lib/rights-config";
import { ProfileManager } from "./organisation-edit-dialog-profiles";
import { CustomFieldsManager } from "./organisation-edit-dialog-custom-fields";
import { BackupsManager } from "./organisation-edit-dialog-backups";
import { RatesManager } from "./organisation-edit-dialog-rates";
import { getCustomFieldDefs } from "./employees/custom-field-actions";
import type { FieldDef } from "./employees/custom-field-actions";
import { getRates } from "./rates-actions";
import type { Rate } from "./rates-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface OrganisationEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgName: string;
  memberLabel: string;
  plan: string;
  requireMfa: boolean;
  role: string;
  canDefineCustomFields: boolean;
  currencySymbol: string;
  tsMaxShiftHours: number;
  tsMaxBreakMinutes: number;
  tsShiftStartVarianceMinutes: number;
  tsRoundFirstInMins: number | null;
  tsRoundFirstInGraceMins: number | null;
  tsRoundBreakOutMins: number | null;
  tsRoundBreakOutGraceMins: number | null;
  tsRoundBreakInMins: number | null;
  tsRoundBreakInGraceMins: number | null;
  tsRoundLastOutMins: number | null;
  tsRoundLastOutGraceMins: number | null;
  holidayYearStartType: string;
  holidayYearStartDay: number;
  holidayYearStartMonth: number;
  bankHolidayHandling: string;
}

export function OrganisationEditDialog({
  open,
  onOpenChange,
  orgName,
  memberLabel,
  plan,
  requireMfa,
  role,
  canDefineCustomFields,
  currencySymbol: initialCurrencySymbol,
  tsMaxShiftHours: initialTsMaxShiftHours,
  tsMaxBreakMinutes: initialTsMaxBreakMinutes,
  tsShiftStartVarianceMinutes: initialTsShiftStartVarianceMinutes,
  tsRoundFirstInMins: initialTsRoundFirstInMins,
  tsRoundFirstInGraceMins: initialTsRoundFirstInGraceMins,
  tsRoundBreakOutMins: initialTsRoundBreakOutMins,
  tsRoundBreakOutGraceMins: initialTsRoundBreakOutGraceMins,
  tsRoundBreakInMins: initialTsRoundBreakInMins,
  tsRoundBreakInGraceMins: initialTsRoundBreakInGraceMins,
  tsRoundLastOutMins: initialTsRoundLastOutMins,
  tsRoundLastOutGraceMins: initialTsRoundLastOutGraceMins,
  holidayYearStartType: initialHolidayYearStartType,
  holidayYearStartDay: initialHolidayYearStartDay,
  holidayYearStartMonth: initialHolidayYearStartMonth,
  bankHolidayHandling: initialBankHolidayHandling,
}: OrganisationEditDialogProps) {
  const [name, setName] = useState(orgName);
  const [label, setLabel] = useState(memberLabel);
  const [currencySymbol, setCurrencySymbol] = useState(initialCurrencySymbol);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [teams, setTeams] = useState<{ id: string; name: string }[]>([]);
  const [originalTeams, setOriginalTeams] = useState<{ id: string; name: string }[]>([]);
  const [newTeamName, setNewTeamName] = useState("");
  const [teamLoading, setTeamLoading] = useState(false);
  const [teamError, setTeamError] = useState<string | null>(null);
  const [editingTeamId, setEditingTeamId] = useState<string | null>(null);
  const [editingTeamName, setEditingTeamName] = useState("");
  const [mfaRequired, setMfaRequired] = useState(requireMfa);
  const [tsMaxShiftHours, setTsMaxShiftHours] = useState(initialTsMaxShiftHours);
  const [tsMaxBreakMinutes, setTsMaxBreakMinutes] = useState(initialTsMaxBreakMinutes);
  const [tsShiftStartVarianceMinutes, setTsShiftStartVarianceMinutes] = useState(initialTsShiftStartVarianceMinutes);
  const [tsRoundFirstInMins, setTsRoundFirstInMins] = useState<number | null>(initialTsRoundFirstInMins);
  const [tsRoundFirstInGraceMins, setTsRoundFirstInGraceMins] = useState<number | null>(initialTsRoundFirstInGraceMins);
  const [tsRoundBreakOutMins, setTsRoundBreakOutMins] = useState<number | null>(initialTsRoundBreakOutMins);
  const [tsRoundBreakOutGraceMins, setTsRoundBreakOutGraceMins] = useState<number | null>(initialTsRoundBreakOutGraceMins);
  const [tsRoundBreakInMins, setTsRoundBreakInMins] = useState<number | null>(initialTsRoundBreakInMins);
  const [tsRoundBreakInGraceMins, setTsRoundBreakInGraceMins] = useState<number | null>(initialTsRoundBreakInGraceMins);
  const [tsRoundLastOutMins, setTsRoundLastOutMins] = useState<number | null>(initialTsRoundLastOutMins);
  const [tsRoundLastOutGraceMins, setTsRoundLastOutGraceMins] = useState<number | null>(initialTsRoundLastOutGraceMins);
  const [holidayYearStartType, setHolidayYearStartType] = useState(initialHolidayYearStartType);
  const [holidayYearStartDay, setHolidayYearStartDay] = useState(initialHolidayYearStartDay);
  const [holidayYearStartMonth, setHolidayYearStartMonth] = useState(initialHolidayYearStartMonth);
  const [bankHolidayHandling, setBankHolidayHandling] = useState(initialBankHolidayHandling);
  const [adminProfiles, setAdminProfiles] = useState<Profile[]>([]);
  const [employeeProfiles, setEmployeeProfiles] = useState<Profile[]>([]);
  const [userRightsType, setUserRightsType] = useState<"admin" | "employee">("admin");
  const [fieldDefs, setFieldDefs] = useState<FieldDef[]>([]);
  const [fieldDefsModified, setFieldDefsModified] = useState(false);
  const [rates, setRates] = useState<Rate[]>([]);
  const router = useRouter();
  const isOwner = role === "owner";
  const showCustomFields = isOwner || canDefineCustomFields;

  const hasChanges =
    name !== orgName ||
    label !== memberLabel ||
    currencySymbol !== initialCurrencySymbol ||
    mfaRequired !== requireMfa ||
    tsMaxShiftHours !== initialTsMaxShiftHours ||
    tsMaxBreakMinutes !== initialTsMaxBreakMinutes ||
    tsShiftStartVarianceMinutes !== initialTsShiftStartVarianceMinutes ||
    tsRoundFirstInMins !== initialTsRoundFirstInMins ||
    tsRoundFirstInGraceMins !== initialTsRoundFirstInGraceMins ||
    tsRoundBreakOutMins !== initialTsRoundBreakOutMins ||
    tsRoundBreakOutGraceMins !== initialTsRoundBreakOutGraceMins ||
    tsRoundBreakInMins !== initialTsRoundBreakInMins ||
    tsRoundBreakInGraceMins !== initialTsRoundBreakInGraceMins ||
    tsRoundLastOutMins !== initialTsRoundLastOutMins ||
    tsRoundLastOutGraceMins !== initialTsRoundLastOutGraceMins ||
    holidayYearStartType !== initialHolidayYearStartType ||
    holidayYearStartDay !== initialHolidayYearStartDay ||
    holidayYearStartMonth !== initialHolidayYearStartMonth ||
    bankHolidayHandling !== initialBankHolidayHandling ||
    fieldDefsModified ||
    teams.some((t) => {
      const orig = originalTeams.find((o) => o.id === t.id);
      return orig && orig.name !== t.name;
    });

  useEffect(() => {
    if (open) {
      setName(orgName);
      setLabel(memberLabel);
      setError(null);
      setTeamError(null);
      setNewTeamName("");
      setEditingTeamId(null);
      setEditingTeamName("");
      setMfaRequired(requireMfa);
      setCurrencySymbol(initialCurrencySymbol);
      setTsMaxShiftHours(initialTsMaxShiftHours);
      setTsMaxBreakMinutes(initialTsMaxBreakMinutes);
      setTsShiftStartVarianceMinutes(initialTsShiftStartVarianceMinutes);
      setTsRoundFirstInMins(initialTsRoundFirstInMins);
      setTsRoundFirstInGraceMins(initialTsRoundFirstInGraceMins);
      setTsRoundBreakOutMins(initialTsRoundBreakOutMins);
      setTsRoundBreakOutGraceMins(initialTsRoundBreakOutGraceMins);
      setTsRoundBreakInMins(initialTsRoundBreakInMins);
      setTsRoundBreakInGraceMins(initialTsRoundBreakInGraceMins);
      setTsRoundLastOutMins(initialTsRoundLastOutMins);
      setTsRoundLastOutGraceMins(initialTsRoundLastOutGraceMins);
      setHolidayYearStartType(initialHolidayYearStartType);
      setHolidayYearStartDay(initialHolidayYearStartDay);
      setHolidayYearStartMonth(initialHolidayYearStartMonth);
      setBankHolidayHandling(initialBankHolidayHandling);
      setFieldDefsModified(false);
      // Load teams
      getTeams().then((result) => {
        if (result.success && result.teams) {
          setTeams(result.teams);
          setOriginalTeams(result.teams);
        }
      });
      // Load profiles
      getProfiles("admin").then((result) => {
        if (result.success && result.profiles) setAdminProfiles(result.profiles);
      });
      getProfiles("employee").then((result) => {
        if (result.success && result.profiles) setEmployeeProfiles(result.profiles);
      });
      // Load custom field definitions
      if (showCustomFields) {
        getCustomFieldDefs().then(setFieldDefs);
      }
      // Load rates
      if (isOwner) {
        getRates().then(setRates);
      }
    }
  }, [open, orgName, memberLabel, requireMfa, showCustomFields, isOwner, initialCurrencySymbol, initialTsMaxShiftHours, initialTsMaxBreakMinutes, initialTsShiftStartVarianceMinutes, initialTsRoundFirstInMins, initialTsRoundFirstInGraceMins, initialTsRoundBreakOutMins, initialTsRoundBreakOutGraceMins, initialTsRoundBreakInMins, initialTsRoundBreakInGraceMins, initialTsRoundLastOutMins, initialTsRoundLastOutGraceMins, initialHolidayYearStartType, initialHolidayYearStartDay, initialHolidayYearStartMonth, initialBankHolidayHandling]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    // Save any pending team renames
    const pendingRenames = teams
      .filter((t) => {
        const orig = originalTeams.find((o) => o.id === t.id);
        return orig && orig.name !== t.name;
      })
      .map((t) => ({ id: t.id, newName: t.name }));

    if (pendingRenames.length > 0) {
      const renameResult = await renameTeams(pendingRenames);
      if (!renameResult.success) {
        setTeamError(renameResult.error ?? "Failed to rename teams");
        setLoading(false);
        return;
      }
    }

    const result = await updateOrganisation({
      name,
      memberLabel: label,
      requireMfa: mfaRequired,
      currencySymbol,
      tsMaxShiftHours,
      tsMaxBreakMinutes,
      tsShiftStartVarianceMinutes,
      tsRoundFirstInMins,
      tsRoundFirstInGraceMins,
      tsRoundBreakOutMins,
      tsRoundBreakOutGraceMins,
      tsRoundBreakInMins,
      tsRoundBreakInGraceMins,
      tsRoundLastOutMins,
      tsRoundLastOutGraceMins,
      holidayYearStartType,
      holidayYearStartDay,
      holidayYearStartMonth,
      bankHolidayHandling,
    });

    if (!result.success) {
      setError(result.error ?? "Failed to update organisation");
      setLoading(false);
    } else {
      setLoading(false);
      setFieldDefsModified(false);
      onOpenChange(false);
      router.refresh();
    }
  }

  async function handleAddTeam() {
    if (!newTeamName.trim()) return;
    setTeamLoading(true);
    setTeamError(null);

    const result = await createTeam(newTeamName.trim());

    if (!result.success) {
      setTeamError(result.error ?? "Failed to create team");
    } else if (result.team) {
      setTeams((prev) => [...prev, result.team!].sort((a, b) => a.name.localeCompare(b.name)));
      setNewTeamName("");
    }
    setTeamLoading(false);
  }

  async function handleDeleteTeam(teamId: string) {
    setTeamError(null);
    const result = await deleteTeam(teamId);

    if (!result.success) {
      setTeamError(result.error ?? "Failed to delete team");
    } else {
      setTeams((prev) => prev.filter((t) => t.id !== teamId));
    }
  }

  function startEditingTeam(team: { id: string; name: string }) {
    setEditingTeamId(team.id);
    setEditingTeamName(team.name);
    setTeamError(null);
  }

  function handleDefsChange(newDefs: FieldDef[]) {
    setFieldDefs(newDefs);
    setFieldDefsModified(true);
  }

  function handleClose() {
    if (fieldDefsModified) router.refresh();
    onOpenChange(false);
  }

  function handleRenameTeam(teamId: string) {
    const trimmed = editingTeamName.trim();
    if (!trimmed) {
      // Revert to current name if empty
      setEditingTeamId(null);
      return;
    }
    setTeams((prev) =>
      prev
        .map((t) => (t.id === teamId ? { ...t, name: trimmed } : t))
        .sort((a, b) => a.name.localeCompare(b.name))
    );
    setEditingTeamId(null);
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) handleClose(); else onOpenChange(true); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Organisation Settings</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <Tabs defaultValue={isOwner ? "general" : "custom-fields"} className="w-full">
            <TabsList className="!h-auto w-full flex-wrap [&>button]:flex-none">
              {isOwner && <TabsTrigger value="general">General</TabsTrigger>}
              {isOwner && <TabsTrigger value="teams">Teams</TabsTrigger>}
              {isOwner && <TabsTrigger value="user-rights">User Rights</TabsTrigger>}
              {isOwner && <TabsTrigger value="timesheet">Timesheet</TabsTrigger>}
              {isOwner && <TabsTrigger value="holiday-year">Holiday Year</TabsTrigger>}
              {isOwner && <TabsTrigger value="rates">Rates</TabsTrigger>}
              {showCustomFields && <TabsTrigger value="custom-fields">Custom Fields</TabsTrigger>}
              {isOwner && <TabsTrigger value="backups">Backups</TabsTrigger>}
            </TabsList>

            {/* General tab */}
            <TabsContent value="general" className="space-y-4 mt-4">
              {error && (
                <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                  {error}
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="org-name">Organisation Name</Label>
                <Input
                  id="org-name"
                  type="text"
                  maxLength={50}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="org-member-label">Member Type</Label>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="h-4 w-4 text-muted-foreground cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent side="right" className="max-w-xs">
                      <p>
                        How you refer to employees e.g. colleague, employee, member
                        etc. This word will be used throughout the app.
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </div>
                <Input
                  id="org-member-label"
                  type="text"
                  placeholder="e.g. employee, colleague, member"
                  maxLength={50}
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="org-currency-symbol">Currency Symbol</Label>
                <Input
                  id="org-currency-symbol"
                  type="text"
                  maxLength={5}
                  placeholder="£"
                  value={currencySymbol}
                  onChange={(e) => setCurrencySymbol(e.target.value)}
                />
              </div>
              <div className="flex items-center justify-between rounded-md border px-3 py-3">
                <div className="space-y-0.5">
                  <Label htmlFor="org-require-mfa">Require Two-Factor Authentication</Label>
                  <p className="text-xs text-muted-foreground">
                    All members must verify with an authenticator app when signing in
                  </p>
                </div>
                <Switch
                  id="org-require-mfa"
                  checked={mfaRequired}
                  onCheckedChange={setMfaRequired}
                />
              </div>
              <div className="space-y-2">
                <Label>Plan</Label>
                <div className="flex items-center justify-between rounded-md border px-3 py-2">
                  <span className="text-sm">{plan} plan</span>
                  <Link
                    href="/billing"
                    className="text-sm text-primary underline-offset-4 hover:underline"
                    onClick={() => onOpenChange(false)}
                  >
                    Manage billing
                  </Link>
                </div>
              </div>
            </TabsContent>

            {/* Teams tab */}
            <TabsContent value="teams" className="space-y-3 mt-4">
              {teamError && (
                <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                  {teamError}
                </div>
              )}
              {teams.length === 0 && (
                <p className="text-sm text-muted-foreground">No teams yet</p>
              )}
              {teams.map((team) => (
                <div
                  key={team.id}
                  className={`flex items-center justify-between rounded-md border px-3 py-1.5 ${editingTeamId !== team.id ? "cursor-pointer hover:bg-muted/50" : ""}`}
                  onClick={() => editingTeamId !== team.id && startEditingTeam(team)}
                >
                  {editingTeamId === team.id ? (
                    <Input
                      type="text"
                      maxLength={50}
                      value={editingTeamName}
                      onChange={(e) => setEditingTeamName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleRenameTeam(team.id);
                        }
                        if (e.key === "Escape") {
                          setEditingTeamId(null);
                        }
                      }}
                      onBlur={() => handleRenameTeam(team.id)}
                      autoFocus
                      className="h-7 text-sm"
                    />
                  ) : (
                    <span className="text-sm">{team.name}</span>
                  )}
                  <div className="flex items-center shrink-0 ml-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteTeam(team.id);
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
              <div className="flex gap-2">
                <Input
                  type="text"
                  placeholder="New team name"
                  maxLength={50}
                  value={newTeamName}
                  onChange={(e) => setNewTeamName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleAddTeam();
                    }
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={handleAddTeam}
                  disabled={teamLoading || !newTeamName.trim()}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </TabsContent>

            {/* User Rights tab */}
            {isOwner && (
              <TabsContent value="user-rights" className="mt-4 space-y-3">
                <div className="flex overflow-hidden rounded-md border border-input text-sm w-fit">
                  {(["admin", "employee"] as const).map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setUserRightsType(type)}
                      className={`px-3 py-1.5 transition-colors ${
                        userRightsType === type
                          ? "bg-primary text-primary-foreground"
                          : "bg-background text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      {type === "admin" ? "Admin" : "Employee"}
                    </button>
                  ))}
                </div>
                {userRightsType === "admin" ? (
                  <ProfileManager
                    type="admin"
                    rightDefs={ADMIN_RIGHTS}
                    profiles={adminProfiles}
                    onProfilesChange={setAdminProfiles}
                    teams={teams}
                  />
                ) : (
                  <ProfileManager
                    type="employee"
                    rightDefs={EMPLOYEE_RIGHTS}
                    profiles={employeeProfiles}
                    onProfilesChange={setEmployeeProfiles}
                  />
                )}
              </TabsContent>
            )}

            {/* Timesheet tab */}
            {isOwner && (
              <TabsContent value="timesheet" className="space-y-4 mt-4">
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5">
                    <Label htmlFor="ts-max-shift-hours">Maximum Shift Length (hours)</Label>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="h-4 w-4 text-muted-foreground cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent side="right" className="max-w-xs">
                        <p>The longest a single shift can be. Clockings beyond this duration from a shift start are treated as a new shift.</p>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <Input
                    id="ts-max-shift-hours"
                    type="number"
                    min={1}
                    max={24}
                    step={1}
                    value={tsMaxShiftHours}
                    onChange={(e) => setTsMaxShiftHours(Number(e.target.value))}
                  />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5">
                    <Label htmlFor="ts-max-break-minutes">Maximum Break Length (minutes)</Label>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="h-4 w-4 text-muted-foreground cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent side="right" className="max-w-xs">
                        <p>The maximum gap between clockings that can be treated as a break. Longer gaps indicate the end of a shift.</p>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <Input
                    id="ts-max-break-minutes"
                    type="number"
                    min={1}
                    max={480}
                    step={1}
                    value={tsMaxBreakMinutes}
                    onChange={(e) => setTsMaxBreakMinutes(Number(e.target.value))}
                  />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5">
                    <Label htmlFor="ts-shift-start-variance">Shift Start Variance (minutes)</Label>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="h-4 w-4 text-muted-foreground cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent side="right" className="max-w-xs">
                        <p>How many minutes either side of a scheduled shift start a clocking can be treated as a shift start.</p>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <Input
                    id="ts-shift-start-variance"
                    type="number"
                    min={0}
                    max={120}
                    step={1}
                    value={tsShiftStartVarianceMinutes}
                    onChange={(e) => setTsShiftStartVarianceMinutes(Number(e.target.value))}
                  />
                </div>

                {/* Time rounding */}
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5">
                    <Label>Time Rounding (minutes)</Label>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="h-4 w-4 text-muted-foreground cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent side="right" className="max-w-xs">
                        <p>Round clocking times when calculating hours. Clock-in times round forward (later); clock-out times round backward (earlier). Leave blank for no rounding.</p>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <div className="rounded-md border border-border divide-y divide-border text-sm">
                    {/* Header row */}
                    <div className="flex items-center px-3 py-1.5 gap-3 bg-muted/40">
                      <span className="w-24 shrink-0" />
                      <span className="w-20 text-right text-xs text-muted-foreground font-medium">Interval</span>
                      <span className="w-20 text-right text-xs text-muted-foreground font-medium">Grace</span>
                    </div>
                    {([
                      { label: "1st IN",    interval: tsRoundFirstInMins,  setInterval: setTsRoundFirstInMins,  grace: tsRoundFirstInGraceMins,  setGrace: setTsRoundFirstInGraceMins },
                      { label: "Break OUT", interval: tsRoundBreakOutMins, setInterval: setTsRoundBreakOutMins, grace: tsRoundBreakOutGraceMins, setGrace: setTsRoundBreakOutGraceMins },
                      { label: "Break IN",  interval: tsRoundBreakInMins,  setInterval: setTsRoundBreakInMins,  grace: tsRoundBreakInGraceMins,  setGrace: setTsRoundBreakInGraceMins },
                      { label: "Last OUT",  interval: tsRoundLastOutMins,  setInterval: setTsRoundLastOutMins,  grace: tsRoundLastOutGraceMins,  setGrace: setTsRoundLastOutGraceMins },
                    ] as const).map(({ label, interval, setInterval, grace, setGrace }) => (
                      <div key={label} className="flex items-center px-3 py-2 gap-3">
                        <span className="text-muted-foreground w-24 shrink-0">{label}</span>
                        <Input
                          type="number"
                          min={1}
                          max={60}
                          step={1}
                          placeholder="None"
                          value={interval ?? ""}
                          onChange={(e) => {
                            const v = e.target.value;
                            setInterval(v === "" ? null : Math.max(1, Math.min(60, parseInt(v, 10))));
                          }}
                          className="h-7 w-20 text-right"
                        />
                        <Input
                          type="number"
                          min={0}
                          max={30}
                          step={1}
                          placeholder="0"
                          value={grace ?? ""}
                          onChange={(e) => {
                            const v = e.target.value;
                            setGrace(v === "" ? null : Math.max(0, Math.min(30, parseInt(v, 10))));
                          }}
                          className="h-7 w-20 text-right"
                          disabled={!interval}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              </TabsContent>
            )}

            {/* Holiday Year tab */}
            {isOwner && (
              <TabsContent value="holiday-year" className="space-y-4 mt-4">
                <div className="space-y-3">
                  <Label className="text-sm font-medium">Holiday year starts on</Label>
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="holidayYearType"
                        value="fixed"
                        checked={holidayYearStartType === "fixed"}
                        onChange={() => setHolidayYearStartType("fixed")}
                        className="accent-primary"
                      />
                      <span className="text-sm">Fixed date (same for all employees)</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="holidayYearType"
                        value="employee_start_date"
                        checked={holidayYearStartType === "employee_start_date"}
                        onChange={() => setHolidayYearStartType("employee_start_date")}
                        className="accent-primary"
                      />
                      <span className="text-sm">Employee start date (individual anniversary)</span>
                    </label>
                  </div>
                </div>

                {holidayYearStartType === "fixed" && (
                  <div className="flex items-center gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Day</Label>
                      <select
                        className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                        value={holidayYearStartDay}
                        onChange={(e) => setHolidayYearStartDay(parseInt(e.target.value, 10))}
                      >
                        {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                          <option key={d} value={d}>{d}</option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Month</Label>
                      <select
                        className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                        value={holidayYearStartMonth}
                        onChange={(e) => setHolidayYearStartMonth(parseInt(e.target.value, 10))}
                      >
                        {["January","February","March","April","May","June","July","August","September","October","November","December"].map((name, i) => (
                          <option key={i + 1} value={i + 1}>{name}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}

                <p className="text-xs text-muted-foreground">
                  {holidayYearStartType === "fixed"
                    ? `All employees share the same holiday year starting ${holidayYearStartDay} ${["January","February","March","April","May","June","July","August","September","October","November","December"][holidayYearStartMonth - 1]}.`
                    : "Each employee's holiday year starts on the anniversary of their start date."}
                </p>

                <div className="border-t pt-4 space-y-3">
                  <Label className="text-sm font-medium">Bank holiday handling</Label>
                  <div className="space-y-2">
                    <label className="flex items-start gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="bankHolidayHandling"
                        value="additional"
                        checked={bankHolidayHandling === "additional"}
                        onChange={() => setBankHolidayHandling("additional")}
                        className="accent-primary mt-0.5"
                      />
                      <div>
                        <span className="text-sm font-medium">Additional</span>
                        <p className="text-xs text-muted-foreground">Bank holidays are added on top of employees&apos; annual leave allowance.</p>
                      </div>
                    </label>
                    <label className="flex items-start gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="bankHolidayHandling"
                        value="deducted"
                        checked={bankHolidayHandling === "deducted"}
                        onChange={() => setBankHolidayHandling("deducted")}
                        className="accent-primary mt-0.5"
                      />
                      <div>
                        <span className="text-sm font-medium">Deducted</span>
                        <p className="text-xs text-muted-foreground">Bank holidays are deducted from employees&apos; annual leave allowance when taken.</p>
                      </div>
                    </label>
                  </div>
                </div>
              </TabsContent>
            )}

            {/* Rates tab */}
            {isOwner && (
              <TabsContent value="rates" className="mt-4 max-h-[400px] overflow-y-auto">
                <RatesManager rates={rates} onRatesChange={setRates} />
              </TabsContent>
            )}

            {/* Custom Fields tab */}
            {showCustomFields && (
              <TabsContent value="custom-fields" className="mt-4 max-h-[400px] overflow-y-auto">
                <CustomFieldsManager defs={fieldDefs} onDefsChange={handleDefsChange} currencySymbol={currencySymbol} />
              </TabsContent>
            )}

            {/* Backups tab */}
            {isOwner && (
              <TabsContent value="backups" className="mt-4 max-h-[400px] overflow-y-auto">
                <BackupsManager orgName={name} />
              </TabsContent>
            )}
          </Tabs>

          {isOwner && (
            <DialogFooter className="mt-4">
              <Button
                type="button"
                variant="outline"
                onClick={handleClose}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={loading || !hasChanges}>
                {loading ? "Saving..." : "Save changes"}
              </Button>
            </DialogFooter>
          )}
          {!isOwner && (
            <DialogFooter className="mt-4">
              <Button type="button" variant="outline" onClick={handleClose}>
                Close
              </Button>
            </DialogFooter>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}
