"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  createWorkProfile, updateWorkProfile, deleteWorkProfile,
  type WorkProfile, type WorkProfileInput,
} from "../work-profile-actions";

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DAY_FULL = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const DEFAULT_HOURS = [8, 8, 8, 8, 8, 0, 0];

function totalHours(p: WorkProfile | number[]): number {
  if (Array.isArray(p)) return p.reduce((a, b) => a + b, 0);
  return DAYS.reduce((sum, d) => sum + Number(p[`hours_${d}`]), 0);
}

export function WorkProfilesClient({ initialProfiles }: { initialProfiles: WorkProfile[] }) {
  const router = useRouter();
  const [profiles, setProfiles] = useState(initialProfiles);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<WorkProfile | null>(null);
  const [deleting, setDeleting] = useState<WorkProfile | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [formName, setFormName] = useState("");
  const [formHours, setFormHours] = useState<number[]>([...DEFAULT_HOURS]);
  const [formLoading, setFormLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  function openCreate() {
    setEditing(null);
    setFormName("");
    setFormHours([...DEFAULT_HOURS]);
    setFormError(null);
    setSheetOpen(true);
  }

  function openEdit(p: WorkProfile) {
    setEditing(p);
    setFormName(p.name);
    setFormHours(DAYS.map((d) => Number(p[`hours_${d}`])));
    setFormError(null);
    setSheetOpen(true);
  }

  async function handleSave() {
    setFormLoading(true);
    setFormError(null);
    const input: WorkProfileInput = {
      name: formName,
      hours_monday: formHours[0],
      hours_tuesday: formHours[1],
      hours_wednesday: formHours[2],
      hours_thursday: formHours[3],
      hours_friday: formHours[4],
      hours_saturday: formHours[5],
      hours_sunday: formHours[6],
    };
    const result = editing
      ? await updateWorkProfile(editing.id, input)
      : await createWorkProfile(input);
    setFormLoading(false);
    if (!result.success) { setFormError(result.error ?? "An error occurred"); return; }
    if (result.profile) {
      if (editing) {
        setProfiles((prev) => prev.map((p) => p.id === editing.id ? { ...result.profile!, employee_count: p.employee_count } : p));
      } else {
        setProfiles((prev) => [...prev, result.profile!]);
      }
    }
    setSheetOpen(false);
    router.refresh();
  }

  async function handleDelete() {
    if (!deleting) return;
    setDeleteLoading(true);
    setDeleteError(null);
    const result = await deleteWorkProfile(deleting.id);
    setDeleteLoading(false);
    if (!result.success) { setDeleteError(result.error ?? "An error occurred"); return; }
    setProfiles((prev) => prev.filter((p) => p.id !== deleting.id));
    setDeleting(null);
    router.refresh();
  }

  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <div>
          <p className="text-sm text-muted-foreground">Absence Management</p>
          <h1 className="text-2xl font-bold">Work Profiles</h1>
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
                  {DAY_LABELS.map((d) => <TableHead key={d}>{d}</TableHead>)}
                  <TableHead>Total</TableHead>
                  <TableHead>Employees</TableHead>
                  <TableHead className="w-16" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {profiles.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={11} className="h-24 text-center text-muted-foreground">
                      No work profiles defined.
                    </TableCell>
                  </TableRow>
                ) : profiles.map((p) => (
                  <TableRow key={p.id} className="cursor-pointer hover:bg-muted/50" onClick={() => openEdit(p)}>
                    <TableCell className="font-medium">{p.name}</TableCell>
                    {DAYS.map((d) => {
                      const h = Number(p[`hours_${d}`]);
                      return <TableCell key={d}>{h > 0 ? `${h}h` : "—"}</TableCell>;
                    })}
                    <TableCell className="font-medium">{totalHours(p)}h</TableCell>
                    <TableCell>{p.employee_count ?? 0}</TableCell>
                    <TableCell>
                      <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
                        <Button variant="ghost" size="icon" onClick={() => { setDeleteError(null); setDeleting(p); }}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>

      {/* Create/Edit Sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>{editing ? "Edit Work Profile" : "New Work Profile"}</SheetTitle>
            <SheetDescription>Define working hours for each day of the week.</SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-5 px-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="wp-name">Name</Label>
              <Input id="wp-name" value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="e.g. Full Time 37.5h" />
            </div>
            {DAYS.map((d, i) => (
              <div key={d} className="flex items-center justify-between">
                <Label>{DAY_FULL[i]}</Label>
                <Input
                  type="number"
                  min={0}
                  max={24}
                  step={0.5}
                  className="w-24 text-right"
                  value={formHours[i]}
                  onChange={(e) => {
                    const next = [...formHours];
                    next[i] = Number(e.target.value) || 0;
                    setFormHours(next);
                  }}
                />
              </div>
            ))}
            <div className="flex items-center justify-between border-t pt-3">
              <Label className="font-medium">Total hours/week</Label>
              <span className="font-bold tabular-nums">{totalHours(formHours)}h</span>
            </div>
            {formError && <p className="text-sm text-destructive">{formError}</p>}
          </div>
          <SheetFooter>
            <Button variant="outline" onClick={() => setSheetOpen(false)} disabled={formLoading}>Cancel</Button>
            <Button onClick={handleSave} disabled={formLoading || !formName.trim()}>
              {formLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {editing ? "Save Changes" : "Create"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleting} onOpenChange={(open) => { if (!open) { setDeleting(null); setDeleteError(null); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Work Profile</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteError ? <span className="text-destructive">{deleteError}</span> : <>Are you sure you want to delete <strong>{deleting?.name}</strong>?</>}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteLoading}>Cancel</AlertDialogCancel>
            {!deleteError && (
              <AlertDialogAction disabled={deleteLoading} className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={(e) => { e.preventDefault(); handleDelete(); }}>
                {deleteLoading ? "Deleting..." : "Delete"}
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
