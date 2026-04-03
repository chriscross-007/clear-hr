"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  createAbsenceProfile,
  updateAbsenceProfile,
  deleteAbsenceProfile,
  type AbsenceProfile,
  type AbsenceType,
} from "../absence-actions";

const PROFILE_TYPE_LABELS: Record<string, string> = {
  fixed: "Fixed",
  fixed_accrued: "Fixed (Accrued)",
  flexible: "Flexible",
  flexible_accrued: "Flexible (Accrued)",
};

interface HolidayProfilesClientProps {
  initialProfiles: AbsenceProfile[];
  absenceTypes: AbsenceType[];
}

export function HolidayProfilesClient({
  initialProfiles,
  absenceTypes,
}: HolidayProfilesClientProps) {
  const router = useRouter();
  const [profiles, setProfiles] = useState(initialProfiles);

  // Sheet state
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingProfile, setEditingProfile] = useState<AbsenceProfile | null>(null);
  const [formLoading, setFormLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Form fields
  const [formName, setFormName] = useState("");
  const [formTypeId, setFormTypeId] = useState("");
  const [formProfileType, setFormProfileType] = useState("fixed");
  const [formAllowance, setFormAllowance] = useState<string>("0");
  const [formMeasurementMode, setFormMeasurementMode] = useState("days");
  const [formCarryOverEnabled, setFormCarryOverEnabled] = useState(false);
  const [formCarryOverMax, setFormCarryOverMax] = useState<string>("");
  const [formCarryOverMaxPeriod, setFormCarryOverMaxPeriod] = useState<string>("");
  const [formCarryOverMinEnabled, setFormCarryOverMinEnabled] = useState(false);
  const [formCarryOverMin, setFormCarryOverMin] = useState<string>("");
  const [formBorrowEnabled, setFormBorrowEnabled] = useState(false);
  const [formBorrowMax, setFormBorrowMax] = useState<string>("0");
  const [formBorrowMaxPeriod, setFormBorrowMaxPeriod] = useState<string>("");

  // Delete state
  const [deletingProfile, setDeletingProfile] = useState<AbsenceProfile | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  function openCreate() {
    setEditingProfile(null);
    setFormName("");
    setFormTypeId(absenceTypes[0]?.id ?? "");
    setFormProfileType("fixed");
    setFormAllowance("0");
    setFormMeasurementMode("days");
    setFormCarryOverEnabled(false);
    setFormCarryOverMax("0");
    setFormCarryOverMaxPeriod("0");
    setFormCarryOverMinEnabled(false);
    setFormCarryOverMin("");
    setFormBorrowEnabled(false);
    setFormBorrowMax("0");
    setFormBorrowMaxPeriod("");
    setFormError(null);
    setSheetOpen(true);
  }

  function openEdit(profile: AbsenceProfile) {
    setEditingProfile(profile);
    setFormName(profile.name);
    setFormTypeId(profile.absence_type_id);
    setFormProfileType(profile.type);
    setFormAllowance(String(profile.allowance));
    setFormMeasurementMode(profile.measurement_mode);
    setFormCarryOverEnabled(profile.carry_over_max !== null);
    setFormCarryOverMax(profile.carry_over_max !== null ? String(profile.carry_over_max) : "");
    setFormCarryOverMaxPeriod(profile.carry_over_max_period !== null ? String(profile.carry_over_max_period) : "");
    setFormCarryOverMinEnabled(profile.carry_over_min !== null);
    setFormCarryOverMin(profile.carry_over_min !== null ? String(profile.carry_over_min) : "");
    setFormBorrowEnabled(profile.borrow_ahead_max > 0 || profile.borrow_ahead_max_period !== null);
    setFormBorrowMax(String(profile.borrow_ahead_max));
    setFormBorrowMaxPeriod(profile.borrow_ahead_max_period !== null ? String(profile.borrow_ahead_max_period) : "");
    setFormError(null);
    setSheetOpen(true);
  }

  async function handleSave() {
    setFormLoading(true);
    setFormError(null);

    const input = {
      name: formName,
      absence_type_id: formTypeId,
      type: formProfileType,
      allowance: Number(formAllowance) || 0,
      measurement_mode: formMeasurementMode,
      carry_over_max: formCarryOverEnabled ? (formCarryOverMax ? Number(formCarryOverMax) : null) : null,
      carry_over_max_period: formCarryOverEnabled && formCarryOverMaxPeriod ? Number(formCarryOverMaxPeriod) : null,
      carry_over_min: formCarryOverMinEnabled && formCarryOverMin ? Number(formCarryOverMin) : null,
      borrow_ahead_max: formBorrowEnabled ? Number(formBorrowMax) || 0 : 0,
      borrow_ahead_max_period: formBorrowEnabled && formBorrowMaxPeriod ? Number(formBorrowMaxPeriod) : null,
    };

    const result = editingProfile
      ? await updateAbsenceProfile(editingProfile.id, input)
      : await createAbsenceProfile(input);

    setFormLoading(false);

    if (!result.success) {
      setFormError(result.error ?? "An error occurred");
      return;
    }

    if (result.profile) {
      const typeName = absenceTypes.find((t) => t.id === result.profile!.absence_type_id)?.name ?? "—";
      const enriched = { ...result.profile, absence_type_name: typeName };
      if (editingProfile) {
        setProfiles((prev) => prev.map((p) => (p.id === editingProfile.id ? enriched : p)));
      } else {
        setProfiles((prev) => [...prev, enriched]);
      }
    }

    setSheetOpen(false);
    router.refresh();
  }

  async function handleDelete() {
    if (!deletingProfile) return;
    setDeleteLoading(true);
    setDeleteError(null);

    const result = await deleteAbsenceProfile(deletingProfile.id);
    setDeleteLoading(false);

    if (!result.success) {
      setDeleteError(result.error ?? "An error occurred");
      return;
    }

    setProfiles((prev) => prev.filter((p) => p.id !== deletingProfile.id));
    setDeletingProfile(null);
    router.refresh();
  }

  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <div>
          <p className="text-sm text-muted-foreground">Absence Management</p>
          <h1 className="text-2xl font-bold">Holiday Profiles</h1>
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4 mr-1.5" />
          Add Profile
        </Button>
      </div>

      <div className="flex justify-center w-full">
        <div className="w-auto max-w-[90%] min-w-0">
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Absence Type</TableHead>
                  <TableHead>Profile Type</TableHead>
              <TableHead>Allowance</TableHead>
              <TableHead>Carry-over Max</TableHead>
              <TableHead>Carry-over Min</TableHead>
              <TableHead>Carry-over Period</TableHead>
              <TableHead>Borrow Ahead Max</TableHead>
              <TableHead>Borrow-ahead Period</TableHead>
              <TableHead className="w-16" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {profiles.length === 0 ? (
              <TableRow>
                <TableCell colSpan={10} className="h-24 text-center text-muted-foreground">
                  No holiday profiles defined.
                </TableCell>
              </TableRow>
            ) : (
              profiles.map((profile) => (
                <TableRow
                  key={profile.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => openEdit(profile)}
                >
                  <TableCell className="font-medium">{profile.name}</TableCell>
                  <TableCell>{profile.absence_type_name ?? "—"}</TableCell>
                  <TableCell>{PROFILE_TYPE_LABELS[profile.type] ?? profile.type}</TableCell>
                  <TableCell>{profile.allowance} {profile.measurement_mode}</TableCell>
                  <TableCell>
                    {profile.carry_over_max !== null ? profile.carry_over_max : "Unlimited"}
                  </TableCell>
                  <TableCell>
                    {profile.carry_over_min ? `${profile.carry_over_min} ${profile.measurement_mode}` : "None"}
                  </TableCell>
                  <TableCell>
                    {profile.carry_over_max_period ? `${profile.carry_over_max_period} days` : "No expiry"}
                  </TableCell>
                  <TableCell>
                    {profile.borrow_ahead_max > 0 ? profile.borrow_ahead_max : "—"}
                  </TableCell>
                  <TableCell>
                    {profile.borrow_ahead_max_period ? `${profile.borrow_ahead_max_period} days` : "No limit"}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          setDeleteError(null);
                          setDeletingProfile(profile);
                        }}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                        <span className="sr-only">Delete</span>
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
            </Table>
          </div>
        </div>
      </div>

      {/* Create / Edit Sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{editingProfile ? "Edit Holiday Profile" : "New Holiday Profile"}</SheetTitle>
            <SheetDescription>
              {editingProfile
                ? "Update this holiday profile's settings."
                : "Create a new holiday profile for your organisation."}
            </SheetDescription>
          </SheetHeader>

          <div className="flex flex-col gap-6 px-4">
            {/* Basic settings */}
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="profile-name">Name</Label>
                <Input
                  id="profile-name"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="e.g. UK Standard 25 days"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label>Absence Type</Label>
                <Select value={formTypeId} onValueChange={setFormTypeId}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select absence type" />
                  </SelectTrigger>
                  <SelectContent>
                    {absenceTypes.map((t) => (
                      <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label>Profile Type</Label>
                <Select value={formProfileType} onValueChange={setFormProfileType}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fixed">Fixed — full entitlement from day one</SelectItem>
                    <SelectItem value="fixed_accrued">Fixed (Accrued) — accrued monthly</SelectItem>
                    <SelectItem value="flexible">Flexible — based on hours worked</SelectItem>
                    <SelectItem value="flexible_accrued">Flexible (Accrued) — accrued over time</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label>Measurement Mode</Label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="measurementMode"
                      value="days"
                      checked={formMeasurementMode === "days"}
                      onChange={() => setFormMeasurementMode("days")}
                      className="accent-primary"
                    />
                    <span className="text-sm">Days</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="measurementMode"
                      value="hours"
                      checked={formMeasurementMode === "hours"}
                      onChange={() => setFormMeasurementMode("hours")}
                      className="accent-primary"
                    />
                    <span className="text-sm">Hours</span>
                  </label>
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="profile-allowance">
                  Allowance ({formMeasurementMode})
                </Label>
                <Input
                  id="profile-allowance"
                  type="number"
                  min={0}
                  step={formMeasurementMode === "days" ? "0.5" : "1"}
                  value={formAllowance}
                  onChange={(e) => setFormAllowance(e.target.value)}
                />
              </div>
            </div>

            {/* Carry-over rules */}
            <div className="border-t pt-4 space-y-4">
              <p className="text-sm font-medium text-muted-foreground">Carry-over Rules</p>

              <div className="flex items-center justify-between">
                <div>
                  <Label>Max carry-over</Label>
                  <p className="text-xs text-muted-foreground">Limit how much can be carried into the next year</p>
                </div>
                <Switch checked={formCarryOverEnabled} onCheckedChange={setFormCarryOverEnabled} />
              </div>

              {formCarryOverEnabled && (
                <div className="flex gap-3 pl-4">
                  <div className="flex flex-col gap-1 flex-1">
                    <Label className="text-xs text-muted-foreground">Max {formMeasurementMode} (blank = unlimited)</Label>
                    <Input
                      type="number"
                      min={0}
                      step="0.5"
                      value={formCarryOverMax}
                      onChange={(e) => setFormCarryOverMax(e.target.value)}
                      placeholder="Unlimited"
                    />
                  </div>
                  <div className="flex flex-col gap-1 flex-1">
                    <Label className="text-xs text-muted-foreground">Expiry (days after year-end)</Label>
                    <Input
                      type="number"
                      min={0}
                      value={formCarryOverMaxPeriod}
                      onChange={(e) => setFormCarryOverMaxPeriod(e.target.value)}
                      placeholder="No expiry"
                    />
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between">
                <div>
                  <Label>Min carry-over</Label>
                  <p className="text-xs text-muted-foreground">Minimum that must be carried over</p>
                </div>
                <Switch checked={formCarryOverMinEnabled} onCheckedChange={setFormCarryOverMinEnabled} />
              </div>

              {formCarryOverMinEnabled && (
                <div className="pl-4">
                  <div className="flex flex-col gap-1 max-w-48">
                    <Label className="text-xs text-muted-foreground">Min {formMeasurementMode}</Label>
                    <Input
                      type="number"
                      min={0}
                      step="0.5"
                      value={formCarryOverMin}
                      onChange={(e) => setFormCarryOverMin(e.target.value)}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Borrow ahead */}
            <div className="border-t pt-4 space-y-4">
              <p className="text-sm font-medium text-muted-foreground">Borrow Ahead</p>

              <div className="flex items-center justify-between">
                <div>
                  <Label>Allow borrowing from next period</Label>
                  <p className="text-xs text-muted-foreground">Let employees use future entitlement</p>
                </div>
                <Switch checked={formBorrowEnabled} onCheckedChange={setFormBorrowEnabled} />
              </div>

              {formBorrowEnabled && (
                <div className="flex gap-3 pl-4">
                  <div className="flex flex-col gap-1 flex-1">
                    <Label className="text-xs text-muted-foreground">Max {formMeasurementMode}</Label>
                    <Input
                      type="number"
                      min={0}
                      step="0.5"
                      value={formBorrowMax}
                      onChange={(e) => setFormBorrowMax(e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-1 flex-1">
                    <Label className="text-xs text-muted-foreground">Days into new period</Label>
                    <Input
                      type="number"
                      min={0}
                      value={formBorrowMaxPeriod}
                      onChange={(e) => setFormBorrowMaxPeriod(e.target.value)}
                      placeholder="No limit"
                    />
                  </div>
                </div>
              )}
            </div>

            {formError && <p className="text-sm text-destructive">{formError}</p>}
          </div>

          <SheetFooter>
            <Button variant="outline" onClick={() => setSheetOpen(false)} disabled={formLoading}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={formLoading || !formName.trim() || !formTypeId}>
              {formLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {editingProfile ? "Save Changes" : "Create"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Delete Confirmation */}
      <AlertDialog
        open={!!deletingProfile}
        onOpenChange={(open) => { if (!open) { setDeletingProfile(null); setDeleteError(null); } }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Holiday Profile</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteError ? (
                <span className="text-destructive">{deleteError}</span>
              ) : (
                <>
                  Are you sure you want to delete <strong>{deletingProfile?.name}</strong>?
                  This action cannot be undone.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteLoading}>Cancel</AlertDialogCancel>
            {!deleteError && (
              <AlertDialogAction
                disabled={deleteLoading}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={(e) => {
                  e.preventDefault();
                  handleDelete();
                }}
              >
                {deleteLoading ? "Deleting..." : "Delete"}
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
