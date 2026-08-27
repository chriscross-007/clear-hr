"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { capitalize, pluralize } from "@/lib/label-utils";
import {
  CustomFieldMultiSelect,
  formatOptionForDisplay,
  normaliseMultiselectValue,
} from "@/components/custom-field-multiselect";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { bulkUpdateMembers, type BulkUpdatePayload } from "./actions";
import type { FieldDef } from "./custom-field-actions";

interface BulkEditSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedCount: number;
  selectedIds: Set<string>;
  teams: { id: string; name: string }[];
  memberLabel: string;
  customFieldDefs: FieldDef[];
  currencySymbol: string;
  /** CLE-186 — Annual Leave absence_type id; null if the org has none. */
  holidayAbsenceTypeId: string | null;
  /** CLE-186 — Holiday (Annual Leave) approval profiles to choose from. */
  holidayApprovalProfiles: { id: string; name: string; isDefault: boolean }[];
  /** CLE-201 — User Rights profiles the caller can assign. Empty when
   *  the caller lacks canEditRightsProfiles or the picker should be hidden. */
  rightsProfiles?: { id: string; name: string }[];
  onBulkUpdate: (updatedIds: string[], updates: BulkUpdatePayload) => void;
}

const NO_CHANGE = "no-change";
// Sentinel for checkbox fields — distinct from true/false
const CHECKBOX_NO_CHANGE = "no-change";
// CLE-186 — bulk Approval Profile picker uses string sentinels because
// Select can't hold a JS `null`. NO_CHANGE = leave alone, LEGACY = clear
// the pointer ("Any admin"), any other value = profile id.
const APPROVAL_LEGACY = "approval-legacy";

export function BulkEditSheet({
  open,
  onOpenChange,
  selectedCount,
  selectedIds,
  teams,
  memberLabel,
  customFieldDefs,
  currencySymbol,
  holidayAbsenceTypeId,
  holidayApprovalProfiles,
  rightsProfiles = [],
  onBulkUpdate,
}: BulkEditSheetProps) {
  const [selectedTeamId, setSelectedTeamId] = useState(NO_CHANGE);
  const [selectedApprovalProfile, setSelectedApprovalProfile] = useState(NO_CHANGE);
  const [selectedRightsProfile, setSelectedRightsProfile] = useState(NO_CHANGE);
  const [customFieldValues, setCustomFieldValues] = useState<Map<string, unknown>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rightsProfileErrors, setRightsProfileErrors] = useState<{ memberId: string; memberName: string; error: string }[] | null>(null);

  const hasCustomChanges = customFieldValues.size > 0;
  const hasChanges =
    selectedTeamId !== NO_CHANGE ||
    selectedApprovalProfile !== NO_CHANGE ||
    selectedRightsProfile !== NO_CHANGE ||
    hasCustomChanges;
  const canShowApprovalProfile =
    holidayAbsenceTypeId !== null && holidayApprovalProfiles.length > 0;

  // --- Summary ---
  const summaryParts: string[] = [];
  if (selectedTeamId !== NO_CHANGE) {
    const teamName = teams.find((t) => t.id === selectedTeamId)?.name ?? "Unknown";
    summaryParts.push(`Team → ${teamName}`);
  }
  if (selectedApprovalProfile !== NO_CHANGE) {
    let label = "Any admin";
    if (selectedApprovalProfile !== APPROVAL_LEGACY) {
      const found = holidayApprovalProfiles.find((p) => p.id === selectedApprovalProfile);
      label = found?.name ?? "Unknown";
    }
    summaryParts.push(`Approver Profile → ${label}`);
  }
  if (selectedRightsProfile !== NO_CHANGE) {
    const found = rightsProfiles.find((p) => p.id === selectedRightsProfile);
    summaryParts.push(`User Rights → ${found?.name ?? "Unknown"}`);
  }
  for (const [fieldKey, value] of customFieldValues) {
    const def = customFieldDefs.find((d) => d.field_key === fieldKey);
    if (!def) continue;
    let displayValue: string;
    if (def.field_type === "checkbox") {
      displayValue = value === true ? "Yes" : "No";
    } else if (def.field_type === "currency") {
      displayValue = value !== "" ? `${currencySymbol}${value}` : "—";
    } else {
      displayValue = String(value || "—");
    }
    summaryParts.push(`${def.label} → ${displayValue}`);
  }

  // --- Custom field helpers ---
  function setCustomField(fieldKey: string, value: unknown) {
    setCustomFieldValues((prev) => {
      const next = new Map(prev);
      next.set(fieldKey, value);
      return next;
    });
  }

  function clearCustomField(fieldKey: string) {
    setCustomFieldValues((prev) => {
      const next = new Map(prev);
      next.delete(fieldKey);
      return next;
    });
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      setSelectedTeamId(NO_CHANGE);
      setSelectedApprovalProfile(NO_CHANGE);
      setSelectedRightsProfile(NO_CHANGE);
      setRightsProfileErrors(null);
      setCustomFieldValues(new Map());
      setError(null);
    }
    onOpenChange(nextOpen);
  }

  async function handleApply() {
    setLoading(true);
    setError(null);
    try {
      const updates: BulkUpdatePayload = {};
      if (selectedTeamId !== NO_CHANGE) updates.team_id = selectedTeamId;
      if (selectedApprovalProfile !== NO_CHANGE) {
        updates.approval_profile_id =
          selectedApprovalProfile === APPROVAL_LEGACY ? null : selectedApprovalProfile;
      }
      if (selectedRightsProfile !== NO_CHANGE) {
        updates.rights_profile_id = selectedRightsProfile;
      }

      if (hasCustomChanges) {
        const cfUpdates: Record<string, unknown> = {};
        for (const [fieldKey, value] of customFieldValues) {
          cfUpdates[fieldKey] = value;
        }
        updates.custom_fields = cfUpdates;
      }

      const memberIdArray = Array.from(selectedIds);
      const result = await bulkUpdateMembers(memberIdArray, updates);
      setRightsProfileErrors(result.rightsProfileErrors ?? null);

      // CLE-201 follow-up — Partial-success handling. When only the
      // rights_profile leg failed on some rows, the team/custom/
      // approval writes already went through server-side, so apply
      // the optimistic update for the members that WEREN'T blocked
      // and keep the sheet open showing the per-member errors.
      const failedIds = new Set(
        (result.rightsProfileErrors ?? []).map((r) => r.memberId),
      );
      const succeededIds = memberIdArray.filter((id) => !failedIds.has(id));
      if (succeededIds.length > 0) {
        onBulkUpdate(succeededIds, updates);
      }

      if (result.success) {
        // Everything worked — close the sheet.
        handleOpenChange(false);
      } else {
        // Sheet stays open, selection preserved. Show top-level error
        // plus the per-member error list (rendered below).
        setError(result.error ?? "An error occurred");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  }

  const label = selectedCount === 1
    ? capitalize(memberLabel)
    : pluralize(capitalize(memberLabel));

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Edit {selectedCount} {label}</SheetTitle>
          <SheetDescription>
            Update fields for the selected {label.toLowerCase()}. Only fields changed from &quot;No change&quot; will be updated.
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-5 overflow-y-auto px-4">
          {/* Team field */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">Team</label>
            <Select value={selectedTeamId} onValueChange={setSelectedTeamId}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_CHANGE}>No change</SelectItem>
                {teams.map((team) => (
                  <SelectItem key={team.id} value={team.id}>
                    {team.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* CLE-201 — Bulk User Rights picker. Empty rightsProfiles
              means the caller doesn't have canEditRightsProfiles or the
              list hasn't been fetched — either way, hide. */}
          {rightsProfiles.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium">User Rights</label>
              <Select value={selectedRightsProfile} onValueChange={setSelectedRightsProfile}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_CHANGE}>No change</SelectItem>
                  {rightsProfiles.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Assigns each selected {memberLabel.toLowerCase()} to this profile.
                Members that would drop the rights-editor count below 2 will be
                skipped and reported.
              </p>
            </div>
          )}

          {/* CLE-186 — Approver Profile (Holiday) */}
          {canShowApprovalProfile && (
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium">Approver Profile</label>
              <Select value={selectedApprovalProfile} onValueChange={setSelectedApprovalProfile}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_CHANGE}>No change</SelectItem>
                  {holidayApprovalProfiles.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}{p.isDefault ? " (default)" : ""}
                    </SelectItem>
                  ))}
                  <SelectItem value={APPROVAL_LEGACY}>Any admin (no profile)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Sets the Holiday (Annual Leave) approval profile for each selected {memberLabel.toLowerCase()}.
              </p>
            </div>
          )}

          {/* Custom fields */}
          {customFieldDefs.length > 0 && (
            <>
              <div className="border-t pt-4">
                <p className="text-sm font-medium text-muted-foreground mb-3">Custom Fields</p>
                <div className="flex flex-col gap-4">
                  {customFieldDefs.map((def) => (
                    <CustomFieldInput
                      key={def.field_key}
                      def={def}
                      value={customFieldValues.get(def.field_key)}
                      isChanged={customFieldValues.has(def.field_key)}
                      currencySymbol={currencySymbol}
                      onChange={(val) => setCustomField(def.field_key, val)}
                      onReset={() => clearCustomField(def.field_key)}
                    />
                  ))}
                </div>
              </div>
            </>
          )}

          {/* Summary */}
          {hasChanges && (
            <p className="text-sm text-muted-foreground">
              {summaryParts.join(", ")}
            </p>
          )}

          {/* Error */}
          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
          {rightsProfileErrors && rightsProfileErrors.length > 0 && (
            <div className="rounded-md border border-destructive/50 bg-destructive/5 px-3 py-2 text-xs">
              <div className="font-medium text-destructive mb-1">
                User Rights update skipped {rightsProfileErrors.length} member{rightsProfileErrors.length === 1 ? "" : "s"}:
              </div>
              <ul className="list-disc pl-4 space-y-0.5 text-destructive/90">
                {rightsProfileErrors.map((r) => (
                  <li key={r.memberId}>
                    <span className="font-medium">{r.memberName}:</span> {r.error}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <SheetFooter>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button
            onClick={handleApply}
            disabled={!hasChanges || loading}
          >
            {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Apply Changes
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Per-field input — renders the right control based on field_type
// ---------------------------------------------------------------------------

function CustomFieldInput({
  def,
  value,
  isChanged,
  currencySymbol,
  onChange,
  onReset,
}: {
  def: FieldDef;
  value: unknown;
  isChanged: boolean;
  currencySymbol: string;
  onChange: (val: unknown) => void;
  onReset: () => void;
}) {
  const { field_type, input_mode, label, options, max_decimal_places } = def;

  // Checkbox field — use a Select with No change / Yes / No
  if (field_type === "checkbox") {
    const selectValue = !isChanged ? CHECKBOX_NO_CHANGE : value === true ? "true" : "false";
    return (
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium">{label}</label>
        <Select
          value={selectValue}
          onValueChange={(v) => {
            if (v === CHECKBOX_NO_CHANGE) onReset();
            else onChange(v === "true");
          }}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={CHECKBOX_NO_CHANGE}>No change</SelectItem>
            <SelectItem value="true">Yes</SelectItem>
            <SelectItem value="false">No</SelectItem>
          </SelectContent>
        </Select>
      </div>
    );
  }

  // Single-choice picklist — Select with a "No change" sentinel plus
  // each option formatted through the base-type formatter (so a
  // currency picklist shows £N, a date picklist shows "12 Jan 2027",
  // etc.).
  if (input_mode === "single_choice" && options) {
    const selectValue = isChanged ? String(value ?? "") : NO_CHANGE;
    return (
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium">{label}</label>
        <Select
          value={selectValue}
          onValueChange={(v) => {
            if (v === NO_CHANGE) onReset();
            else onChange(v);
          }}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_CHANGE}>No change</SelectItem>
            {options.map((opt) => (
              <SelectItem key={opt} value={opt}>
                {formatOptionForDisplay(opt, field_type, { currencySymbol, maxDecimalPlaces: max_decimal_places })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }

  // Multi-choice picklist — Reset-button pattern (same as the date
  // field). The underlying CustomFieldMultiSelect formats each option
  // through the base-type formatter.
  if (input_mode === "multi_choice" && options) {
    const arrValue = normaliseMultiselectValue(value);
    return (
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium">{label}</label>
        <div className="flex items-start gap-2">
          <div className="flex-1">
            <CustomFieldMultiSelect
              options={options}
              value={isChanged ? arrValue : []}
              onChange={(next) => {
                // Any explicit pick counts as "changed" — even clearing
                // to empty (which is different from No change).
                onChange(next);
              }}
              placeholder={isChanged ? "None selected" : "No change"}
              fieldType={field_type}
              currencySymbol={currencySymbol}
              maxDecimalPlaces={max_decimal_places}
            />
          </div>
          {isChanged && (
            <Button variant="ghost" size="sm" onClick={onReset} className="text-xs px-2">
              Reset
            </Button>
          )}
        </div>
      </div>
    );
  }

  // Date field
  if (field_type === "date") {
    return (
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium">{label}</label>
        <div className="flex items-center gap-2">
          <Input
            type="date"
            className="flex-1"
            value={isChanged ? String(value ?? "") : ""}
            onChange={(e) => {
              if (e.target.value) onChange(e.target.value);
              else onReset();
            }}
          />
          {isChanged && (
            <Button variant="ghost" size="sm" onClick={onReset} className="text-xs px-2">
              Reset
            </Button>
          )}
        </div>
      </div>
    );
  }

  // Number / currency field
  if (field_type === "number" || field_type === "currency") {
    const step = field_type === "currency"
      ? "0.01"
      : def.max_decimal_places === 0
      ? "1"
      : def.max_decimal_places
      ? `0.${"0".repeat(def.max_decimal_places - 1)}1`
      : "any";
    return (
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium">
          {label}{field_type === "currency" ? ` (${currencySymbol})` : ""}
        </label>
        <div className="flex items-center gap-2">
          <Input
            type="number"
            step={step}
            className="flex-1"
            placeholder="No change"
            value={isChanged ? String(value ?? "") : ""}
            onChange={(e) => {
              if (e.target.value !== "") onChange(Number(e.target.value));
              else onReset();
            }}
          />
          {isChanged && (
            <Button variant="ghost" size="sm" onClick={onReset} className="text-xs px-2">
              Reset
            </Button>
          )}
        </div>
      </div>
    );
  }

  // Text / multiline / email / url / phone — all render as text input
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium">{label}</label>
      <div className="flex items-center gap-2">
        <Input
          type={field_type === "email" ? "email" : field_type === "url" ? "url" : field_type === "phone" ? "tel" : "text"}
          className="flex-1"
          placeholder="No change"
          value={isChanged ? String(value ?? "") : ""}
          onChange={(e) => {
            if (e.target.value !== "") onChange(e.target.value);
            else onReset();
          }}
        />
        {isChanged && (
          <Button variant="ghost" size="sm" onClick={onReset} className="text-xs px-2">
            Reset
          </Button>
        )}
      </div>
    </div>
  );
}
