"use client";

// Shared value-editor components for custom fields that use a picklist
// (i.e. `input_mode` is single_choice or multi_choice). Both components
// take the raw `options: string[]` from the definition and use
// `formatOptionForDisplay()` to render each option in the correct
// visual form for the base `field_type` (currency-prefixed number,
// locale date, etc.).
//
// Used by every value-editor site that touches custom fields:
//   • members/[memberId]/employment/employment-form.tsx
//   • employees/add-employee-dialog.tsx
//   • employees/edit-employee-dialog.tsx
//   • employees/bulk-edit-sheet.tsx
//
// Storage on `members.custom_fields`:
//   • single_choice → the raw option string  (e.g. "500")
//   • multi_choice  → an array of option strings  (e.g. ["500","1000"])
// Options are always stored as `string[]` on the definition regardless
// of base type; parsing/display happens at render time.

import { useState } from "react";
import { Check, X } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Option formatter — mirrors the free-form input's display rules so a
// picklist of numbers/dates/currencies looks the same as a typed value
// of the same field_type. Consumers pass the base field_type + a bit of
// context (currency symbol, max decimal places).
// ---------------------------------------------------------------------------

interface FormatOptions {
  currencySymbol?: string;
  maxDecimalPlaces?: number | null;
}

export function formatOptionForDisplay(
  raw: string,
  fieldType: string,
  opts: FormatOptions = {},
): string {
  if (raw === null || raw === undefined || raw === "") return "";
  switch (fieldType) {
    case "currency": {
      const n = Number(raw);
      if (Number.isNaN(n)) return raw;
      return `${opts.currencySymbol ?? ""}${n.toLocaleString("en-GB", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;
    }
    case "number": {
      const n = Number(raw);
      if (Number.isNaN(n)) return raw;
      if (opts.maxDecimalPlaces === 0) return String(Math.round(n));
      if (opts.maxDecimalPlaces !== null && opts.maxDecimalPlaces !== undefined) {
        return n.toFixed(opts.maxDecimalPlaces);
      }
      return String(n);
    }
    case "date": {
      try {
        return new Date(String(raw)).toLocaleDateString("en-GB", {
          day: "numeric",
          month: "short",
          year: "numeric",
        });
      } catch {
        return raw;
      }
    }
    case "checkbox": {
      return raw === "true" ? "Yes" : raw === "false" ? "No" : raw;
    }
    default:
      return raw;
  }
}

// ---------------------------------------------------------------------------
// Shared props for both selectors
// ---------------------------------------------------------------------------

interface BaseSelectProps {
  /** All allowed choices, from the field definition's `options` array. */
  options: string[];
  /** Read-only mode — trigger is disabled. */
  disabled?: boolean;
  /** Base data type of the field — drives how each option is displayed. */
  fieldType?: string;
  /** For currency-typed options. */
  currencySymbol?: string;
  /** For number-typed options. */
  maxDecimalPlaces?: number | null;
  /** Passed through to the trigger for form-label association. */
  id?: string;
  /** Placeholder shown when nothing is selected. */
  placeholder?: string;
}

// ---------------------------------------------------------------------------
// Single-choice — shadcn Select, formatted labels.
// ---------------------------------------------------------------------------

export interface CustomFieldSingleSelectProps extends BaseSelectProps {
  /** Currently-selected raw option string, or empty to mean "none". */
  value: string;
  /** Called with the new raw option string (or "" to clear). */
  onChange: (next: string) => void;
  /** Show the "—" sentinel that clears the selection. Defaults to true.
   *  Callers can hide it when the field is `required`. */
  allowClear?: boolean;
}

const NONE_SENTINEL = "__none__";

export function CustomFieldSingleSelect({
  options,
  value,
  onChange,
  disabled,
  fieldType,
  currencySymbol,
  maxDecimalPlaces,
  id,
  placeholder = "None selected",
  allowClear = true,
}: CustomFieldSingleSelectProps) {
  const formatOpts: FormatOptions = { currencySymbol, maxDecimalPlaces };
  return (
    <Select
      value={value || NONE_SENTINEL}
      onValueChange={(v) => onChange(v === NONE_SENTINEL ? "" : v)}
      disabled={disabled}
    >
      <SelectTrigger id={id}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {allowClear && <SelectItem value={NONE_SENTINEL}>—</SelectItem>}
        {options.map((opt) => (
          <SelectItem key={opt} value={opt}>
            {formatOptionForDisplay(opt, fieldType ?? "text", formatOpts)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ---------------------------------------------------------------------------
// Multi-choice — compact Popover trigger showing "N selected" (or the
// single value) with a checkbox list of options inside.
// ---------------------------------------------------------------------------

export interface CustomFieldMultiSelectProps extends BaseSelectProps {
  /** Currently-selected raw option strings (subset of `options`). */
  value: string[];
  /** Called with the new full selection array. */
  onChange: (next: string[]) => void;
}

export function CustomFieldMultiSelect({
  options,
  value,
  onChange,
  disabled,
  fieldType,
  currencySymbol,
  maxDecimalPlaces,
  id,
  placeholder = "None selected",
}: CustomFieldMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const formatOpts: FormatOptions = { currencySymbol, maxDecimalPlaces };

  function toggle(opt: string) {
    if (value.includes(opt)) {
      onChange(value.filter((v) => v !== opt));
    } else {
      onChange([...value, opt]);
    }
  }

  const triggerLabel =
    value.length === 0
      ? placeholder
      : value.length === 1
        ? formatOptionForDisplay(value[0], fieldType ?? "text", formatOpts)
        : `${value.length} selected`;

  return (
    <div className="space-y-1.5">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            id={id}
            type="button"
            disabled={disabled}
            className={cn(
              "h-9 w-full rounded-md border border-input bg-background px-3 text-left text-sm",
              "flex items-center justify-between",
              "disabled:opacity-50 disabled:cursor-not-allowed",
            )}
          >
            <span className={cn("truncate", value.length === 0 && "text-muted-foreground")}>
              {triggerLabel}
            </span>
            {value.length > 0 && !disabled && (
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  onChange([]);
                }}
                className="ml-2 rounded-sm p-0.5 hover:bg-muted"
                aria-label="Clear selection"
              >
                <X className="h-3.5 w-3.5" />
              </span>
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-0" align="start">
          <div className="max-h-64 overflow-y-auto py-1">
            {options.length === 0 ? (
              <div className="px-3 py-2 text-sm text-muted-foreground">
                No options available.
              </div>
            ) : (
              options.map((opt) => {
                const checked = value.includes(opt);
                return (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => toggle(opt)}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-muted/40"
                  >
                    <span
                      className={cn(
                        "flex h-4 w-4 items-center justify-center rounded border shrink-0",
                        checked ? "bg-primary border-primary" : "border-input",
                      )}
                    >
                      {checked && <Check className="h-3 w-3 text-primary-foreground" />}
                    </span>
                    <span className="flex-1 truncate">
                      {formatOptionForDisplay(opt, fieldType ?? "text", formatOpts)}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </PopoverContent>
      </Popover>

      {/* Chip summary when more than one value is picked, so the user
          can see (and remove) each selection without opening the popover. */}
      {value.length > 1 && (
        <div className="flex flex-wrap gap-1">
          {value.map((v) => (
            <span
              key={v}
              className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-xs"
            >
              {formatOptionForDisplay(v, fieldType ?? "text", formatOpts)}
              {!disabled && (
                <button
                  type="button"
                  onClick={() => onChange(value.filter((x) => x !== v))}
                  aria-label={`Remove ${v}`}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Read-only display + value normalisation helpers
// ---------------------------------------------------------------------------

/** Read-only inline chip list — used in the Employees grid + PDF /
 *  report contexts where the value is display-only. */
export function CustomFieldMultiSelectDisplay({
  value,
  fieldType,
  currencySymbol,
  maxDecimalPlaces,
}: {
  value: string[];
  fieldType?: string;
  currencySymbol?: string;
  maxDecimalPlaces?: number | null;
}) {
  if (!value || value.length === 0) return <span className="text-muted-foreground">—</span>;
  const formatOpts: FormatOptions = { currencySymbol, maxDecimalPlaces };
  return (
    <div className="flex flex-wrap gap-1">
      {value.map((v) => (
        <span
          key={v}
          className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-xs"
        >
          {formatOptionForDisplay(v, fieldType ?? "text", formatOpts)}
        </span>
      ))}
    </div>
  );
}

/** Normalise whatever the JSONB blob contains into a `string[]`. Old
 *  values from before the multi_choice input mode existed might come
 *  in as a single string or `null`; new ones will always be an array. */
export function normaliseMultiselectValue(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((v): v is string => typeof v === "string");
  if (typeof raw === "string" && raw.length > 0) return [raw];
  return [];
}

/** Join a multi-choice value array through the base-type formatter for
 *  contexts that need a plain string (grid cell text, PDF, CSV export).
 *  Returns "" for empty arrays so callers can supply their own "—". */
export function formatMultiselectValueAsText(
  value: string[],
  fieldType?: string,
  opts: FormatOptions = {},
): string {
  if (!value || value.length === 0) return "";
  return value.map((v) => formatOptionForDisplay(v, fieldType ?? "text", opts)).join(", ");
}
