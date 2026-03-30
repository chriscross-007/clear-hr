"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { capitalize, pluralize } from "@/lib/label-utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
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
  onBulkUpdate: (updatedIds: string[], updates: BulkUpdatePayload) => void;
}

const NO_CHANGE = "no-change";
// Sentinel for checkbox fields — distinct from true/false
const CHECKBOX_NO_CHANGE = "no-change";

export function BulkEditSheet({
  open,
  onOpenChange,
  selectedCount,
  selectedIds,
  teams,
  memberLabel,
  customFieldDefs,
  currencySymbol,
  onBulkUpdate,
}: BulkEditSheetProps) {
  const [selectedTeamId, setSelectedTeamId] = useState(NO_CHANGE);
  const [selectedRole, setSelectedRole] = useState(NO_CHANGE);
  const [customFieldValues, setCustomFieldValues] = useState<Map<string, unknown>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasCustomChanges = customFieldValues.size > 0;
  const hasChanges = selectedTeamId !== NO_CHANGE || selectedRole !== NO_CHANGE || hasCustomChanges;

  // --- Summary ---
  const summaryParts: string[] = [];
  if (selectedTeamId !== NO_CHANGE) {
    const teamName = teams.find((t) => t.id === selectedTeamId)?.name ?? "Unknown";
    summaryParts.push(`Team → ${teamName}`);
  }
  if (selectedRole !== NO_CHANGE) {
    summaryParts.push(`Role → ${selectedRole === "admin" ? "Admin" : capitalize(memberLabel)}`);
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
      setSelectedRole(NO_CHANGE);
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
      if (selectedRole !== NO_CHANGE) updates.role = selectedRole as "admin" | "employee";

      if (hasCustomChanges) {
        const cfUpdates: Record<string, unknown> = {};
        for (const [fieldKey, value] of customFieldValues) {
          cfUpdates[fieldKey] = value;
        }
        updates.custom_fields = cfUpdates;
      }

      const memberIdArray = Array.from(selectedIds);
      const result = await bulkUpdateMembers(memberIdArray, updates);
      if (result.success) {
        // Optimistic update — instant UI feedback, then background refresh
        onBulkUpdate(memberIdArray, updates);
        // Close sheet and show success (selection preserved)
        handleOpenChange(false);
      } else {
        // Sheet stays open, selection preserved
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

          {/* Role field */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">Role</label>
            <Select value={selectedRole} onValueChange={setSelectedRole}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_CHANGE}>No change</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
                <SelectItem value="employee">{capitalize(memberLabel)}</SelectItem>
              </SelectContent>
            </Select>
          </div>

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
  const { field_type, label, options } = def;

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

  // Dropdown field — use a Select with No change + defined options
  if (field_type === "dropdown" && options) {
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
                {opt}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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
