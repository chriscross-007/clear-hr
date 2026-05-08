// CLE-170 — Employee Holiday page (client). Profileless Holiday Management.
//
// Manages Holiday Periods for one employee:
//   - Lists every period with stored + computed (Brought Forward / Worked /
//     Toil / Allowance / Taken / Booked / Balance / Carry Forward) values.
//   - Editable fields (Name, Start, End, Type, Units, Allowance, Factor,
//     Adjust, Max CF, Min CF) are edited INLINE in the table — click a
//     cell to edit, Enter/blur commits, Escape cancels. The slide-out
//     edit form was removed because it visually clashed with the cog
//     form (which sets defaults), causing admins to confuse the two.
//   - "Add Period" creates a row directly from the cog defaults
//     (getNewPeriodDefaults) without a form — the admin then refines any
//     fields inline. No slide-out at all.
//   - Delete with confirmation (refused if locked).
//   - Lock toggle: locking is silent; unlocking requires confirmation
//     because downstream Carry Forward will recompute.
//
// Spec: Profileless Holiday Management — settled spec.

"use client";

import { useState, useMemo, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Loader2, Lock, Plus, Trash2, Unlock } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { StickyPageHeader } from "@/components/ui/sticky-page-header";
import { HolidayUnitsPill } from "@/components/holiday-units-pill";
import { cn } from "@/lib/utils";

import {
  createHolidayPeriod,
  updateHolidayPeriod,
  deleteHolidayPeriod,
  setHolidayPeriodLock,
  updateMemberStartDate,
  type HolidayPeriod,
  type HolidayPeriodInput,
  type NewPeriodDefaults,
} from "@/app/(dashboard)/holiday-period-actions";
import {
  formatHolidayValue,
  type ComputedPeriodValues,
} from "@/app/(dashboard)/holiday-period-compute";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtDate(iso: string): string {
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

// ---------------------------------------------------------------------------
// Form state (used by the inline-edit cells; one row's worth of values)
// ---------------------------------------------------------------------------

type FormState = {
  name: string;
  startDate: string;
  endDate: string;
  type: "fixed" | "earned";
  units: "days" | "hours";
  allowance: string;
  earnedFactor: string;
  adjust: string;
  maxCarryForward: string;
  minCarryForward: string;
};

function periodToForm(p: HolidayPeriod): FormState {
  return {
    name: p.name,
    startDate: p.startDate,
    endDate: p.endDate,
    type: p.type,
    units: p.units,
    allowance: p.allowance === null ? "" : String(p.allowance),
    earnedFactor: String(p.earnedFactor),
    adjust: String(p.adjust),
    maxCarryForward: String(p.maxCarryForward),
    minCarryForward: String(p.minCarryForward),
  };
}

function formToInput(f: FormState): HolidayPeriodInput {
  return {
    name: f.name,
    startDate: f.startDate,
    endDate: f.endDate,
    type: f.type,
    units: f.units,
    allowance: f.type === "earned" ? null : (Number(f.allowance) || 0),
    earnedFactor: Number(f.earnedFactor) || 0,
    adjust: Number(f.adjust) || 0,
    maxCarryForward: Number(f.maxCarryForward) || 0,
    minCarryForward: Number(f.minCarryForward) || 0,
  };
}

// Regex filters reused from CLE-169 (Org Settings Holiday tab)
function acceptNonNegative(v: string): boolean {
  return /^\d*\.?\d*$/.test(v);
}
function acceptNonPositive(v: string): boolean {
  return (
    v === "" ||
    v === "-" ||
    /^0\.?0*$/.test(v) ||
    /^-(\d*\.?\d*|\.\d*)$/.test(v)
  );
}
function acceptAnyNumber(v: string): boolean {
  return v === "" || v === "-" || /^-?\d*\.?\d*$/.test(v);
}

// Inline-edit field discriminator
type EditableField =
  | "name"
  | "startDate"
  | "endDate"
  | "type"
  | "units"
  | "allowance"
  | "earnedFactor"
  | "adjust"
  | "maxCarryForward"
  | "minCarryForward";

/**
 * Bundle of inline-edit state + handlers passed to the cell components.
 * Defining the cells as top-level components (rather than nested inside
 * EmployeeHolidayClient) is essential — nested function components get a
 * fresh function identity every render, which makes React unmount and
 * remount the input, dropping focus and the user's keystrokes.
 */
type InlineEditState = {
  editing: { periodId: string; field: EditableField } | null;
  draft: string;
  cellSaving: boolean;
  cellError: { periodId: string; field: EditableField; message: string } | null;
  setDraft: (v: string) => void;
  startEdit: (p: HolidayPeriod, field: EditableField) => void;
  cancelEdit: () => void;
  commitEdit: (p: HolidayPeriod, valueOverride?: string) => void;
};

function isEditingCell(s: InlineEditState, p: HolidayPeriod, field: EditableField): boolean {
  return s.editing?.periodId === p.id && s.editing.field === field;
}

function errorAtCell(
  s: InlineEditState,
  p: HolidayPeriod,
  field: EditableField,
): string | null {
  return s.cellError?.periodId === p.id && s.cellError.field === field
    ? s.cellError.message
    : null;
}

// ---------------------------------------------------------------------------
// Inline cell components (top-level so input focus is preserved across
// re-renders).
// ---------------------------------------------------------------------------

function TextCell({
  p,
  field,
  display,
  state,
  accept,
  align = "left",
  notApplicable = false,
}: {
  p: HolidayPeriod;
  field: EditableField;
  display: ReactNode;
  state: InlineEditState;
  accept?: (v: string) => boolean;
  align?: "left" | "right";
  /** Optional suffix; only used by the at-rest button so the cell width
   *  measures the suffix too. */
  suffix?: string;
  notApplicable?: boolean;
}) {
  const editingThis = isEditingCell(state, p, field);
  const error = errorAtCell(state, p, field);

  if (editingThis) {
    return (
      <div className="flex flex-col gap-1">
        {/* Ghost-span layout: the invisible span carries the at-rest display
            text so the cell is sized by it. The input is absolutely
            positioned on top — switching into edit mode does not change the
            column width. */}
        <div className="relative">
          <span
            aria-hidden
            className={cn(
              "invisible block whitespace-pre px-1 py-0.5 text-sm",
              align === "right" && "tabular-nums",
            )}
          >
            {display ?? " "}
          </span>
          <input
            autoFocus
            type="text"
            inputMode={accept ? "decimal" : undefined}
            value={state.draft}
            onChange={(e) => {
              if (accept && !accept(e.target.value)) return;
              state.setDraft(e.target.value);
            }}
            onBlur={() => state.commitEdit(p)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                (e.currentTarget as HTMLInputElement).blur();
              } else if (e.key === "Escape") {
                e.preventDefault();
                state.cancelEdit();
              }
            }}
            disabled={state.cellSaving}
            size={1}
            className={cn(
              "absolute inset-0 box-border w-full min-w-0 rounded border border-input bg-background px-1 text-sm",
              "focus:outline-none focus:ring-1 focus:ring-ring",
              align === "right" && "text-right tabular-nums",
            )}
          />
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    );
  }

  const editable = !p.locked && !notApplicable;

  return (
    <button
      type="button"
      onClick={() => editable && state.startEdit(p, field)}
      disabled={!editable}
      className={cn(
        "block w-full -mx-1 px-1 py-0.5 rounded text-sm",
        editable
          ? "cursor-text hover:bg-muted/40 hover:ring-1 hover:ring-border"
          : "cursor-default",
        align === "right" && "text-right tabular-nums",
      )}
    >
      {display}
    </button>
  );
}

function DateCell({
  p,
  field,
  iso,
  state,
}: {
  p: HolidayPeriod;
  field: "startDate" | "endDate";
  iso: string;
  state: InlineEditState;
}) {
  const editingThis = isEditingCell(state, p, field);
  const error = errorAtCell(state, p, field);

  if (editingThis) {
    return (
      <div className="flex flex-col gap-1">
        {/* Ghost-span keeps cell width identical to at-rest. Date inputs
            have a calendar icon that may compress when the cell is narrow,
            but click-to-pick still works. */}
        <div className="relative">
          <span
            aria-hidden
            className="invisible block whitespace-nowrap px-1 py-0.5 text-sm"
          >
            {fmtDate(iso)}
          </span>
          <input
            autoFocus
            type="date"
            value={state.draft}
            onChange={(e) => state.setDraft(e.target.value)}
            onBlur={() => state.commitEdit(p)}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
              else if (e.key === "Escape") {
                e.preventDefault();
                state.cancelEdit();
              }
            }}
            disabled={state.cellSaving}
            className="absolute inset-0 box-border w-full min-w-0 rounded border border-input bg-background px-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => !p.locked && state.startEdit(p, field)}
      disabled={p.locked}
      className={cn(
        "block w-full -mx-1 px-1 py-0.5 rounded text-sm whitespace-nowrap text-left",
        !p.locked
          ? "cursor-text hover:bg-muted/40 hover:ring-1 hover:ring-border"
          : "cursor-default",
      )}
    >
      {fmtDate(iso)}
    </button>
  );
}

function SelectCell({
  p,
  field,
  options,
  display,
  state,
}: {
  p: HolidayPeriod;
  field: "type" | "units";
  options: { value: string; label: string }[];
  display: ReactNode;
  state: InlineEditState;
}) {
  const editingThis = isEditingCell(state, p, field);
  const error = errorAtCell(state, p, field);

  if (editingThis) {
    return (
      <div className="flex flex-col gap-1">
        {/* Ghost-span keeps cell width identical to at-rest. Native select
            dropdown still pops on click. */}
        <div className="relative">
          <span
            aria-hidden
            className="invisible block whitespace-pre px-1 py-0.5 text-sm capitalize"
          >
            {display ?? " "}
          </span>
          <select
            autoFocus
            value={state.draft}
            onChange={(e) => {
              const v = e.target.value;
              state.setDraft(v);
              // Native selects close on change — commit immediately.
              state.commitEdit(p, v);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                state.cancelEdit();
              }
            }}
            disabled={state.cellSaving}
            className="absolute inset-0 box-border w-full min-w-0 rounded border border-input bg-background px-1 text-sm capitalize focus:outline-none focus:ring-1 focus:ring-ring"
          >
            {options.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => !p.locked && state.startEdit(p, field)}
      disabled={p.locked}
      className={cn(
        "block w-full -mx-1 px-1 py-0.5 rounded text-sm capitalize text-left",
        !p.locked
          ? "cursor-text hover:bg-muted/40 hover:ring-1 hover:ring-border"
          : "cursor-default",
      )}
    >
      {display}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface EmployeeHolidayClientProps {
  memberId: string;
  memberName: string;
  memberStartDate: string | null;
  periods: HolidayPeriod[];
  computed: Record<string, ComputedPeriodValues>;
  newPeriodDefaults: NewPeriodDefaults | null;
  newPeriodDefaultsError: string | null;
}

export function EmployeeHolidayClient({
  memberId,
  memberName,
  memberStartDate,
  periods,
  computed,
  newPeriodDefaults,
  newPeriodDefaultsError,
}: EmployeeHolidayClientProps) {
  const router = useRouter();

  // -- Add Period state ------------------------------------------------------
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  // -- Inline-edit state -----------------------------------------------------
  const [editing, setEditing] = useState<
    | { periodId: string; field: EditableField }
    | null
  >(null);
  const [draft, setDraft] = useState<string>("");
  const [cellSaving, setCellSaving] = useState(false);
  const [cellError, setCellError] = useState<
    | { periodId: string; field: EditableField; message: string }
    | null
  >(null);

  // -- Delete / Unlock -------------------------------------------------------
  const [deleting, setDeleting] = useState<HolidayPeriod | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [unlocking, setUnlocking] = useState<HolidayPeriod | null>(null);
  const [unlockLoading, setUnlockLoading] = useState(false);

  // -- Inline Start Date entry (when memberStartDate is null) ---------------
  const [startDateInput, setStartDateInput] = useState<string>("");
  const [savingStartDate, setSavingStartDate] = useState(false);
  const [startDateError, setStartDateError] = useState<string | null>(null);

  async function saveStartDate() {
    if (!startDateInput) return;
    setSavingStartDate(true);
    setStartDateError(null);
    const result = await updateMemberStartDate(memberId, startDateInput);
    setSavingStartDate(false);
    if (!result.success) {
      setStartDateError(result.error ?? "Could not save Start Date");
      return;
    }
    router.refresh();
  }

  const sortedPeriods = useMemo(
    () => [...periods].sort((a, b) => a.startDate.localeCompare(b.startDate)),
    [periods],
  );

  // CLE-175 — Worked / Factor% columns are only relevant when at least one
  // period is Earned. Hide them entirely otherwise.
  const hasEarnedPeriod = useMemo(
    () => sortedPeriods.some((p) => p.type === "earned"),
    [sortedPeriods],
  );

  // -------------------------------------------------------------------------
  // Add Period — creates a row directly from the cog defaults. Admin then
  // refines any field inline.
  // -------------------------------------------------------------------------

  async function handleAdd() {
    if (!newPeriodDefaults || adding) return;
    setAdding(true);
    setAddError(null);

    const d = newPeriodDefaults;
    const input: HolidayPeriodInput = {
      name: d.name,
      startDate: d.startDate,
      endDate: d.endDate,
      type: d.type,
      units: d.units,
      allowance: d.type === "earned" ? null : (d.allowance ?? 0),
      earnedFactor: d.earnedFactor,
      adjust: d.adjust,
      maxCarryForward: d.maxCarryForward,
      minCarryForward: d.minCarryForward,
    };

    const result = await createHolidayPeriod(memberId, input);
    setAdding(false);

    if (!result.success) {
      setAddError(result.error ?? "Failed to add Holiday Period");
      return;
    }

    router.refresh();
  }

  // -------------------------------------------------------------------------
  // Inline-edit handlers
  // -------------------------------------------------------------------------

  function startEdit(p: HolidayPeriod, field: EditableField) {
    if (p.locked || cellSaving) return;
    // Allowance is only meaningful for fixed periods; Earned Factor for earned.
    if (field === "allowance" && p.type !== "fixed") return;
    if (field === "earnedFactor" && p.type !== "earned") return;
    const f = periodToForm(p);
    setEditing({ periodId: p.id, field });
    setDraft(f[field]);
    setCellError(null);
  }

  function cancelEdit() {
    setEditing(null);
    setDraft("");
    setCellError(null);
  }

  async function commitEdit(p: HolidayPeriod, valueOverride?: string) {
    if (!editing || editing.periodId !== p.id || cellSaving) return;
    const field = editing.field;
    const value = valueOverride ?? draft;

    // Per-field validation
    if (field === "name" && !value.trim()) {
      setCellError({ periodId: p.id, field, message: "Name required" });
      return;
    }

    const f = periodToForm(p);
    const newF: FormState = { ...f, [field]: value };

    if (field === "startDate" || field === "endDate") {
      if (!newF.startDate || !newF.endDate || newF.endDate <= newF.startDate) {
        setCellError({
          periodId: p.id,
          field,
          message: field === "startDate"
            ? "Start must be before End"
            : "End must be after Start",
        });
        return;
      }
    }
    if (field === "minCarryForward" && (Number(value) || 0) > 0) {
      setCellError({ periodId: p.id, field, message: "Must be ≤ 0" });
      return;
    }
    if (field === "maxCarryForward" && (Number(value) || 0) < 0) {
      setCellError({ periodId: p.id, field, message: "Must be ≥ 0" });
      return;
    }

    // No change → just close
    if (f[field] === value) {
      cancelEdit();
      return;
    }

    setCellSaving(true);
    const result = await updateHolidayPeriod(p.id, formToInput(newF));
    setCellSaving(false);

    if (!result.success) {
      setCellError({ periodId: p.id, field, message: result.error ?? "Save failed" });
      return;
    }

    setEditing(null);
    setDraft("");
    setCellError(null);
    router.refresh();
  }

  // -------------------------------------------------------------------------
  // Delete
  // -------------------------------------------------------------------------

  async function handleDelete() {
    if (!deleting) return;
    setDeleteLoading(true);
    setDeleteError(null);
    const result = await deleteHolidayPeriod(deleting.id);
    setDeleteLoading(false);
    if (!result.success) {
      setDeleteError(result.error ?? "Delete failed");
      return;
    }
    setDeleting(null);
    router.refresh();
  }

  // -------------------------------------------------------------------------
  // Lock / Unlock
  // -------------------------------------------------------------------------

  async function handleLock(p: HolidayPeriod) {
    const result = await setHolidayPeriodLock(p.id, true);
    if (result.success) router.refresh();
  }

  async function confirmUnlock() {
    if (!unlocking) return;
    setUnlockLoading(true);
    const result = await setHolidayPeriodLock(unlocking.id, false);
    setUnlockLoading(false);
    if (result.success) {
      setUnlocking(null);
      router.refresh();
    }
  }

  // -------------------------------------------------------------------------
  // Inline-edit state bundle (passed to top-level TextCell/DateCell/SelectCell)
  // -------------------------------------------------------------------------

  const inlineEditState: InlineEditState = {
    editing,
    draft,
    cellSaving,
    cellError,
    setDraft,
    startEdit,
    cancelEdit,
    commitEdit,
  };

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <>
      <StickyPageHeader>
        <Link
          href="/employees"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-2"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to directory
        </Link>
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">{memberName}</h1>
            <p className="text-sm text-muted-foreground">Holiday Periods</p>
          </div>
          <Button
            onClick={handleAdd}
            disabled={!newPeriodDefaults || adding}
            title={newPeriodDefaultsError ?? undefined}
          >
            {adding ? (
              <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
            ) : (
              <Plus className="h-4 w-4 mr-1.5" />
            )}
            Add Period
          </Button>
        </div>
      </StickyPageHeader>

      {/* Add Period error banner */}
      {addError && (
        <div className="mt-4 flex items-start justify-between gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <span>{addError}</span>
          <button
            type="button"
            onClick={() => setAddError(null)}
            className="text-xs underline hover:no-underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Inline Start Date entry / defaults error banner */}
      {!memberStartDate ? (
        <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="mb-2">
            This employee has no Start Date set. Add it here to enable Holiday Period creation.
          </p>
          <div className="flex items-center gap-2">
            <Input
              type="date"
              value={startDateInput}
              onChange={(e) => setStartDateInput(e.target.value)}
              className="w-44 bg-background"
            />
            <Button
              onClick={saveStartDate}
              disabled={!startDateInput || savingStartDate}
              size="sm"
            >
              {savingStartDate && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              Save Start Date
            </Button>
          </div>
          {startDateError && (
            <p className="mt-2 text-destructive">{startDateError}</p>
          )}
        </div>
      ) : (
        newPeriodDefaultsError && (
          <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            {newPeriodDefaultsError}
          </div>
        )
      )}

      {/* Periods table */}
      <div className="mt-6 mb-8">
        {sortedPeriods.length === 0 ? (
          <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
            No Holiday Periods yet. Click <strong>Add Period</strong> to set one up.
          </div>
        ) : (
          <>
            <p className="mb-2 text-xs text-muted-foreground">
              Click any cell to edit. Press <kbd className="rounded border bg-muted px-1">Enter</kbd> to save or
              {" "}<kbd className="rounded border bg-muted px-1">Esc</kbd> to cancel. Locked rows are read-only.
            </p>
            <div className="rounded-md border">
              <Table containerClassName="overflow-x-auto">
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Start</TableHead>
                    <TableHead>End</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Units</TableHead>
                    <TableHead className="text-right">Brought&nbsp;Fwd</TableHead>
                    {hasEarnedPeriod && (
                      <>
                        <TableHead className="text-right">Worked</TableHead>
                        <TableHead className="text-right">Factor&nbsp;%</TableHead>
                      </>
                    )}
                    <TableHead className="text-right">Allowance</TableHead>
                    <TableHead className="text-right">Adjust</TableHead>
                    <TableHead className="text-right">Toil</TableHead>
                    <TableHead className="text-right">Taken</TableHead>
                    <TableHead className="text-right">Booked</TableHead>
                    <TableHead className="text-right font-semibold">Balance</TableHead>
                    <TableHead className="text-right">Max&nbsp;CF</TableHead>
                    <TableHead className="text-right">Min&nbsp;CF</TableHead>
                    <TableHead className="text-right">Carry&nbsp;Fwd</TableHead>
                    <TableHead className="w-20" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedPeriods.map((p) => {
                    const c = computed[p.id];
                    return (
                      <TableRow key={p.id}>
                        {/* Name */}
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-1.5">
                            {p.locked && (
                              <Lock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                            )}
                            <div className="min-w-0 flex-1">
                              <TextCell
                                p={p}
                                field="name"
                                display={p.name}
                                state={inlineEditState}
                              />
                            </div>
                          </div>
                        </TableCell>

                        {/* Start */}
                        <TableCell>
                          <DateCell p={p} field="startDate" iso={p.startDate} state={inlineEditState} />
                        </TableCell>

                        {/* End */}
                        <TableCell>
                          <DateCell p={p} field="endDate" iso={p.endDate} state={inlineEditState} />
                        </TableCell>

                        {/* Type */}
                        <TableCell>
                          <SelectCell
                            p={p}
                            field="type"
                            options={[
                              { value: "fixed", label: "Fixed" },
                              { value: "earned", label: "Earned" },
                            ]}
                            display={p.type}
                            state={inlineEditState}
                          />
                        </TableCell>

                        {/* Units */}
                        <TableCell>
                          <SelectCell
                            p={p}
                            field="units"
                            options={[
                              { value: "days", label: "Days" },
                              { value: "hours", label: "Hours" },
                            ]}
                            display={<HolidayUnitsPill units={p.units} />}
                            state={inlineEditState}
                          />
                        </TableCell>

                        {/* Brought Forward (computed, read-only) */}
                        <TableCell className="text-right tabular-nums">
                          {c ? formatHolidayValue(c.broughtForward) : "—"}
                        </TableCell>

                        {/* Worked + Factor% — only shown when at least one
                            period is Earned. Fixed rows show "—". */}
                        {hasEarnedPeriod && (
                          <>
                            <TableCell className="text-right tabular-nums">
                              {p.type === "earned" && c
                                ? formatHolidayValue(c.worked)
                                : <span className="text-muted-foreground">—</span>}
                            </TableCell>
                            <TableCell>
                              {p.type === "earned" ? (
                                <TextCell
                                  p={p}
                                  field="earnedFactor"
                                  display={`${formatHolidayValue(p.earnedFactor)}%`}
                                  accept={acceptNonNegative}
                                  align="right"
                                  suffix="%"
                                  state={inlineEditState}
                                />
                              ) : (
                                <span className="block w-full text-right tabular-nums text-muted-foreground">
                                  —
                                </span>
                              )}
                            </TableCell>
                          </>
                        )}

                        {/* Allowance — editable for fixed; computed display for earned */}
                        <TableCell>
                          {p.type === "fixed" ? (
                            <TextCell
                              p={p}
                              field="allowance"
                              display={
                                c ? formatHolidayValue(c.allowance) : "—"
                              }
                              accept={acceptNonNegative}
                              align="right"
                              state={inlineEditState}
                            />
                          ) : (
                            <span className="block w-full text-right tabular-nums text-muted-foreground">
                              {c ? formatHolidayValue(c.allowance) : "—"}
                            </span>
                          )}
                        </TableCell>

                        {/* Adjust */}
                        <TableCell>
                          <TextCell
                            p={p}
                            field="adjust"
                            display={formatHolidayValue(p.adjust)}
                            accept={acceptAnyNumber}
                            align="right"
                            state={inlineEditState}
                          />
                        </TableCell>

                        {/* Toil (computed, read-only) */}
                        <TableCell className="text-right tabular-nums">
                          {c ? formatHolidayValue(c.toil) : "—"}
                        </TableCell>

                        {/* Taken (computed, read-only) */}
                        <TableCell className="text-right tabular-nums">
                          {c ? formatHolidayValue(c.taken) : "—"}
                        </TableCell>

                        {/* Booked (computed, read-only) */}
                        <TableCell className="text-right tabular-nums">
                          {c ? formatHolidayValue(c.booked) : "—"}
                        </TableCell>

                        {/* Balance (computed, read-only) */}
                        <TableCell className="text-right font-semibold tabular-nums">
                          {c ? formatHolidayValue(c.balance) : "—"}
                        </TableCell>

                        {/* Max CF */}
                        <TableCell>
                          <TextCell
                            p={p}
                            field="maxCarryForward"
                            display={formatHolidayValue(p.maxCarryForward)}
                            accept={acceptNonNegative}
                            align="right"
                            state={inlineEditState}
                          />
                        </TableCell>

                        {/* Min CF */}
                        <TableCell>
                          <TextCell
                            p={p}
                            field="minCarryForward"
                            display={formatHolidayValue(p.minCarryForward)}
                            accept={acceptNonPositive}
                            align="right"
                            state={inlineEditState}
                          />
                        </TableCell>

                        {/* Carry Forward (computed, read-only) */}
                        <TableCell className="text-right tabular-nums">
                          {c ? formatHolidayValue(c.carryForward) : "—"}
                        </TableCell>

                        {/* Actions */}
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-0.5">
                            {p.locked ? (
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => setUnlocking(p)}
                                title="Unlock"
                              >
                                <Lock className="h-4 w-4" />
                              </Button>
                            ) : (
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleLock(p)}
                                title="Lock"
                              >
                                <Unlock className="h-4 w-4" />
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => {
                                setDeleteError(null);
                                setDeleting(p);
                              }}
                              disabled={p.locked}
                              title={p.locked ? "Locked — unlock to delete" : "Delete"}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </div>

      {/* Delete confirmation */}
      <AlertDialog
        open={deleting !== null}
        onOpenChange={(o) => { if (!o) { setDeleting(null); setDeleteError(null); } }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Holiday Period</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteError ? (
                <span className="text-destructive">{deleteError}</span>
              ) : (
                <>
                  Are you sure you want to delete <strong>{deleting?.name}</strong>?
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

      {/* Unlock confirmation */}
      <AlertDialog
        open={unlocking !== null}
        onOpenChange={(o) => { if (!o) setUnlocking(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unlock Holiday Period</AlertDialogTitle>
            <AlertDialogDescription>
              Unlocking <strong>{unlocking?.name}</strong> will allow it to be edited.
              Downstream periods will recompute Carry Forward based on any changes you
              subsequently make. Continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={unlockLoading}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={unlockLoading}
              onClick={(e) => {
                e.preventDefault();
                confirmUnlock();
              }}
            >
              {unlockLoading ? "Unlocking..." : "Unlock"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
