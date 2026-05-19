"use client";

// Shared form fields for booking / requesting an absence. Used by both the
// employee-facing Request Absence sheet (`holiday/book-holiday-sheet.tsx`)
// and the admin-facing Book Absence For Employee sheet (in
// `members/[memberId]/calendar/admin-calendar-client.tsx`).
//
// What lives here:
//   • Absence Type select (built from the available non-deprecated reasons)
//   • Absence Reason select (filtered to the selected Type)
//   • Start / End date inputs (End nullable when `allowOpenEnded`)
//   • Half-day selects (days mode)
//   • Hours input (hours mode)
//   • Note textarea
//
// What stays in the parent sheet:
//   • Title / description / chrome
//   • Validation, balance preview, notice + cover previews, sick details
//     panel, conversation panel, footer buttons, submit logic.
//
// The parent owns a single `AbsenceFormState` and passes a patch-style
// `onChange` so this component never holds state of its own. That keeps
// both sheets in control of derived values like dayCount, projected
// remaining, "sick-type" detection, etc.

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AbsenceReasonOption } from "@/app/(dashboard)/holiday-booking-actions";

export type HalfOption = "full" | "am" | "pm";

export interface AbsenceFormState {
  typeId: string;
  reasonId: string;
  startDate: string;
  /** `null` represents an open-ended booking. Only reachable when the
   *  caller passes `allowOpenEnded`. */
  endDate: string | null;
  startHalf: HalfOption;
  endHalf: HalfOption;
  /** String, not number, so partial input ("12.") doesn't reset cursor. */
  hours: string;
  note: string;
}

export interface AbsenceFormFieldsProps {
  state: AbsenceFormState;
  /** Patch-style setter. Receives only the fields that changed. */
  onChange: (patch: Partial<AbsenceFormState>) => void;
  /** All reasons available to the current user/org. The component derives
   *  the Type list and the per-type Reason list from this. */
  reasons: AbsenceReasonOption[];
  /** `"days"` shows the two half-day selects, `"hours"` shows the hours
   *  input instead. Driven by the member's current Holiday Period. */
  measurementMode: "days" | "hours";
  /** When true, an "Open" checkbox next to the end date lets the user
   *  clear it (open-ended booking). Currently used by the admin sheet for
   *  sick bookings whose return date isn't known yet. */
  allowOpenEnded?: boolean;
  /** Whole-form disable for read-only views (e.g. existing-booking mode
   *  on the employee side, or a non-routed admin looking at a pending
   *  request). */
  disabled?: boolean;
  /** Lock the Type + Reason selects independently of the rest of the
   *  form. Used when an existing booking's type is fixed but the parent
   *  still wants other fields editable (rare — mainly future-proofing). */
  lockTypeAndReason?: boolean;
  /** Suppress the note textarea. The admin sheet uses a richer
   *  Conversation panel for free-text and doesn't want a separate note
   *  field. */
  hideNote?: boolean;
}

export function AbsenceFormFields({
  state,
  onChange,
  reasons,
  measurementMode,
  allowOpenEnded = false,
  disabled = false,
  lockTypeAndReason = false,
  hideNote = false,
}: AbsenceFormFieldsProps) {
  // --- Derive Type list + Reason list -------------------------------------
  // Only types with at least one non-deprecated reason are offered.
  const typesById = new Map<string, { id: string; name: string }>();
  for (const r of reasons) {
    if (r.is_deprecated) continue;
    if (!r.absence_type_id) continue;
    if (!typesById.has(r.absence_type_id)) {
      typesById.set(r.absence_type_id, { id: r.absence_type_id, name: r.absence_type_name });
    }
  }
  const absenceTypes = Array.from(typesById.values()).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const activeReasons = reasons.filter(
    (r) => r.absence_type_id === state.typeId && !r.is_deprecated,
  );

  // --- Helpers ------------------------------------------------------------
  // Switching type implicitly switches reason: pick the first active
  // reason inside the new type so the Reason select is never left pointing
  // at a value that's no longer in its options.
  function handleTypeChange(nextTypeId: string) {
    const firstReason = reasons.find(
      (r) => r.absence_type_id === nextTypeId && !r.is_deprecated,
    );
    onChange({ typeId: nextTypeId, reasonId: firstReason?.id ?? "" });
  }

  const sameDay =
    state.endDate !== null && state.startDate !== "" && state.startDate === state.endDate;
  const isOpenEnded = state.endDate === null;
  const fieldsDisabled = disabled;
  const typeReasonDisabled = disabled || lockTypeAndReason;
  const isHoursMode = measurementMode === "hours";

  return (
    <div className="flex flex-col gap-5">
      {/* Absence Type */}
      <div className="flex flex-col gap-1.5">
        <Label>Absence Type</Label>
        <Select
          value={state.typeId}
          onValueChange={handleTypeChange}
          disabled={typeReasonDisabled}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select a type" />
          </SelectTrigger>
          <SelectContent>
            {absenceTypes.length === 0 ? (
              <div className="px-2 py-3 text-sm text-muted-foreground text-center">
                No absence types available.
              </div>
            ) : (
              absenceTypes.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))
            )}
          </SelectContent>
        </Select>
      </div>

      {/* Absence Reason — filtered to selected Type */}
      <div className="flex flex-col gap-1.5">
        <Label>Absence Reason</Label>
        <Select
          value={state.reasonId}
          onValueChange={(v) => onChange({ reasonId: v })}
          disabled={typeReasonDisabled}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select a reason" />
          </SelectTrigger>
          <SelectContent>
            {activeReasons.length === 0 ? (
              <div className="px-2 py-3 text-sm text-muted-foreground text-center">
                No active reasons for this absence type.
              </div>
            ) : (
              activeReasons.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  <div className="flex items-center gap-2">
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: r.colour }}
                    />
                    {r.name}
                  </div>
                </SelectItem>
              ))
            )}
          </SelectContent>
        </Select>
      </div>

      {/* Dates */}
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="absence-start">Start Date</Label>
          <Input
            id="absence-start"
            type="date"
            value={state.startDate}
            onChange={(e) => {
              const v = e.target.value;
              if (!v) return;
              // Bump end forward when start moves past it (open-ended OK).
              const nextEnd =
                state.endDate !== null && v > state.endDate ? v : state.endDate;
              onChange({ startDate: v, endDate: nextEnd });
            }}
            disabled={fieldsDisabled}
            required
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="absence-end">End Date</Label>
          <div className="flex items-center gap-2">
            <Input
              id="absence-end"
              type="date"
              value={state.endDate ?? ""}
              min={state.startDate}
              onChange={(e) => {
                const v = e.target.value;
                if (!v) {
                  if (allowOpenEnded) onChange({ endDate: null });
                  return;
                }
                onChange({
                  endDate: v < state.startDate ? state.startDate : v,
                });
              }}
              disabled={fieldsDisabled || isOpenEnded}
              required={!allowOpenEnded}
            />
            {allowOpenEnded && (
              <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs">
                <Checkbox
                  checked={isOpenEnded}
                  disabled={fieldsDisabled}
                  onCheckedChange={(v) => {
                    if (v) {
                      onChange({ endDate: null });
                    } else {
                      // Restore end = start when un-checking "Open".
                      onChange({ endDate: state.startDate });
                    }
                  }}
                />
                <span>Open</span>
              </label>
            )}
          </div>
        </div>
      </div>

      {/* Half-day selects (days mode only). End select disables for
          same-day bookings and for open-ended bookings (no meaningful
          "end half" in either case). */}
      {!isHoursMode && (
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>Start</Label>
            <Select
              value={state.startHalf}
              onValueChange={(v) => onChange({ startHalf: v as HalfOption })}
              disabled={fieldsDisabled}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="full">Full day</SelectItem>
                <SelectItem value="am">AM only</SelectItem>
                <SelectItem value="pm">PM only</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>End</Label>
            <Select
              value={sameDay || isOpenEnded ? "full" : state.endHalf}
              onValueChange={(v) => onChange({ endHalf: v as HalfOption })}
              disabled={fieldsDisabled || sameDay || isOpenEnded}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="full">Full day</SelectItem>
                <SelectItem value="am">AM only</SelectItem>
                <SelectItem value="pm">PM only</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      {/* Hours input (hours mode only) */}
      {isHoursMode && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="absence-hours">Hours</Label>
          <Input
            id="absence-hours"
            type="number"
            min={0}
            step={0.5}
            value={state.hours}
            onChange={(e) => onChange({ hours: e.target.value })}
            disabled={fieldsDisabled}
            required
          />
        </div>
      )}

      {/* Note */}
      {!hideNote && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="absence-note">Note (optional)</Label>
          <Textarea
            id="absence-note"
            value={state.note}
            onChange={(e) => onChange({ note: e.target.value })}
            rows={2}
            placeholder="Any additional details..."
            disabled={fieldsDisabled}
          />
        </div>
      )}
    </div>
  );
}
