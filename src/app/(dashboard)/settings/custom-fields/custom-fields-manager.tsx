"use client";

// CLE-194 — Relocated from `organisation-edit-dialog-custom-fields.tsx`
// after the legacy dialog was deleted. Same component, new home next to
// its only consumer (`settings/custom-fields/custom-fields-client.tsx`).
//
// Data model (post the 20260824 migration):
//   • field_type  → the underlying data type (nine values below)
//   • input_mode  → the entry mechanism (three values below); when set
//                   to single_choice / multi_choice the OptionsEditor
//                   collects the allowed picks and stores them on the
//                   definition's `options` text[] column.
//
// This split replaces the legacy `dropdown` / `multiselect` field types,
// which conflated data type and entry mode into a single field. Any
// combination is allowed (checkbox + single_choice is silly but
// harmless — an admin can just avoid it). See CLAUDE.md for the schema.

import { useState, useRef } from "react";
import { GripVertical, Shield, Trash2, Plus, X, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { FieldDef, InputMode } from "@/app/(dashboard)/employees/custom-field-actions";
import {
  createCustomFieldDef,
  updateCustomFieldDef,
  deleteCustomFieldDef,
  reorderCustomFieldDefs,
} from "@/app/(dashboard)/employees/custom-field-actions";
import { formatOptionForDisplay } from "@/components/custom-field-multiselect";

// ---------------------------------------------------------------------------
// Field type + input mode configs
// ---------------------------------------------------------------------------
const FIELD_TYPES = [
  { value: "text",       label: "Text" },
  { value: "multiline",  label: "Multi-line Text" },
  { value: "email",      label: "Email" },
  { value: "url",        label: "URL" },
  { value: "phone",      label: "Phone" },
  { value: "number",     label: "Number" },
  { value: "currency",   label: "Currency" },
  { value: "date",       label: "Date" },
  { value: "checkbox",   label: "Checkbox" },
] as const;

type FieldTypeValue = (typeof FIELD_TYPES)[number]["value"];

const INPUT_MODES: { value: InputMode; label: string }[] = [
  { value: "freeform",      label: "Free-form entry" },
  { value: "single_choice", label: "Single choice from list" },
  { value: "multi_choice",  label: "Multi choice from list" },
];

function fieldTypeLabel(type: string): string {
  return FIELD_TYPES.find((t) => t.value === type)?.label ?? type;
}

function inputModeLabel(mode: InputMode): string {
  return INPUT_MODES.find((m) => m.value === mode)?.label ?? mode;
}

/** Options apply when the caller wants a picklist — not for free-form. */
function usesOptions(mode: InputMode): boolean {
  return mode === "single_choice" || mode === "multi_choice";
}

/** Convert a human label to a snake_case field_key */
function toFieldKey(label: string): string {
  return label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s_]/g, "")
    .replace(/\s+/g, "_")
    .replace(/_{2,}/g, "_")
    .replace(/^_|_$/g, "");
}

// ---------------------------------------------------------------------------
// Options editor — type-aware
// ---------------------------------------------------------------------------
// Each option is stored as a `string`, but the input control adapts to
// the base field_type so an admin building e.g. a currency picklist
// gets a numeric input rather than a raw text field. Display of each
// existing option runs through `formatOptionForDisplay()` (shared with
// the value-editor sites) so what's shown in the manager matches what
// employees will see.

interface OptionsEditorProps {
  options: string[];
  onChange: (opts: string[]) => void;
  fieldType: FieldTypeValue;
  /** Passed through for currency-symbol prefixing + number formatting. */
  currencySymbol: string;
  maxDecimalPlaces: number | null;
}

function OptionsEditor({
  options,
  onChange,
  fieldType,
  currencySymbol,
  maxDecimalPlaces,
}: OptionsEditorProps) {
  const [newOpt, setNewOpt] = useState("");

  function normalise(raw: string): string | null {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    if (fieldType === "number" || fieldType === "currency") {
      const n = Number(trimmed);
      if (Number.isNaN(n)) return null;
      // Round to max_decimal_places if set (currency defaults to 2)
      const dp = fieldType === "currency" ? 2 : maxDecimalPlaces;
      if (dp !== null && dp !== undefined) return n.toFixed(dp);
      return String(n);
    }
    // For date, checkbox, text-family: store as-is (ISO date, "true"/"false"
    // or free text). Validation is loose — the input control below already
    // constrains the shape.
    return trimmed;
  }

  function addOption() {
    const stored = normalise(newOpt);
    if (!stored || options.includes(stored)) return;
    onChange([...options, stored]);
    setNewOpt("");
  }

  function removeOption(idx: number) {
    onChange(options.filter((_, i) => i !== idx));
  }

  // Pick an HTML input type that matches the base field_type. Text-family
  // types collapse to plain text; number/currency use number; date uses
  // date; checkbox degenerates to text (odd combo, but allowed).
  const inputType =
    fieldType === "number" || fieldType === "currency"
      ? "number"
      : fieldType === "date"
        ? "date"
        : "text";

  return (
    <div className="flex flex-col gap-1.5 pl-1">
      <Label className="text-xs text-muted-foreground">Options</Label>
      {options.map((opt, i) => (
        <div key={i} className="flex items-center gap-1">
          <span className="flex-1 text-sm truncate">
            {formatOptionForDisplay(opt, fieldType, { currencySymbol, maxDecimalPlaces })}
          </span>
          <button
            type="button"
            onClick={() => removeOption(i)}
            className="text-muted-foreground hover:text-destructive"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}
      <div className="flex gap-1">
        {fieldType === "currency" && (
          <span className="flex items-center text-xs text-muted-foreground pl-1">
            {currencySymbol}
          </span>
        )}
        <Input
          type={inputType}
          step={fieldType === "currency" ? "0.01" : undefined}
          value={newOpt}
          onChange={(e) => setNewOpt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); addOption(); }
          }}
          placeholder="Add option…"
          className="h-7 text-xs"
        />
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={addOption}>
          <Plus className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add field form
// ---------------------------------------------------------------------------
interface AddFieldFormProps {
  onAdd: (def: Omit<FieldDef, "id">, nextOrder: number) => Promise<{ success: boolean; error?: string } | undefined>;
  nextOrder: number;
  existingKeys: Set<string>;
  currencySymbol: string;
}

function AddFieldForm({ onAdd, nextOrder, existingKeys, currencySymbol }: AddFieldFormProps) {
  const [label, setLabel] = useState("");
  const [fieldType, setFieldType] = useState<FieldTypeValue>("text");
  const [inputMode, setInputMode] = useState<InputMode>("freeform");
  const [required, setRequired] = useState(false);
  // CLE-198 — When true, values in this field are redacted for viewers
  // without `can_view_sensitive_fields` and every write always audits.
  const [isSensitive, setIsSensitive] = useState(false);
  const [options, setOptions] = useState<string[]>([]);
  const [maxDecimalPlaces, setMaxDecimalPlaces] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const fieldKey = toFieldKey(label);
  const parsedDecimalPlaces =
    fieldType === "number" && maxDecimalPlaces !== ""
      ? parseInt(maxDecimalPlaces, 10)
      : null;

  async function handleAdd() {
    setError(null);
    if (!label.trim()) { setError("Label is required"); return; }
    if (!fieldKey) { setError("Label must contain at least one letter or number"); return; }
    if (existingKeys.has(fieldKey)) { setError("A field with that key already exists"); return; }
    if (usesOptions(inputMode) && options.length === 0) { setError("Add at least one option"); return; }

    setSaving(true);
    const result = await onAdd(
      {
        label: label.trim(),
        field_key: fieldKey,
        field_type: fieldType,
        input_mode: inputMode,
        options: usesOptions(inputMode) ? options : null,
        required,
        sort_order: nextOrder,
        max_decimal_places: parsedDecimalPlaces,
        is_sensitive: isSensitive,
      },
      nextOrder
    );
    setSaving(false);
    if (!result || result.success) {
      setLabel("");
      setFieldType("text");
      setInputMode("freeform");
      setRequired(false);
      setIsSensitive(false);
      setOptions([]);
      setMaxDecimalPlaces("");
    } else {
      setError(result.error ?? "Failed to add field");
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-dashed p-3 mt-2">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">New field</p>
      <div className="flex flex-col gap-1">
        <Label className="text-xs">Label</Label>
        <Input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="e.g. Emergency Contact"
          className="h-8 text-sm"
        />
        {fieldKey && (
          <p className="text-[11px] text-muted-foreground">Key: <span className="font-mono">{fieldKey}</span></p>
        )}
      </div>
      <div className="flex flex-col gap-1">
        <Label className="text-xs">Type</Label>
        <Select value={fieldType} onValueChange={(v) => {
          setFieldType(v as FieldTypeValue);
          if (v !== "number") setMaxDecimalPlaces("");
          // Changing the base type invalidates the picklist because the
          // options were typed against the old type — safer to clear.
          setOptions([]);
        }}>
          <SelectTrigger className="h-8 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FIELD_TYPES.map((t) => (
              <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1">
        <Label className="text-xs">Input mode</Label>
        <Select value={inputMode} onValueChange={(v) => {
          setInputMode(v as InputMode);
          if (v === "freeform") setOptions([]);
        }}>
          <SelectTrigger className="h-8 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {INPUT_MODES.map((m) => (
              <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {fieldType === "number" && (
        <div className="flex flex-col gap-1">
          <Label className="text-xs">Max decimal places</Label>
          <Input
            type="number"
            min={0}
            max={10}
            value={maxDecimalPlaces}
            onChange={(e) => setMaxDecimalPlaces(e.target.value)}
            placeholder="Unrestricted"
            className="h-8 text-sm"
          />
        </div>
      )}
      {fieldType === "currency" && (
        <p className="text-xs text-muted-foreground">Currency symbol: <span className="font-medium">{currencySymbol}</span></p>
      )}
      {usesOptions(inputMode) && (
        <OptionsEditor
          options={options}
          onChange={setOptions}
          fieldType={fieldType}
          currencySymbol={currencySymbol}
          maxDecimalPlaces={parsedDecimalPlaces}
        />
      )}
      <div className="flex items-center gap-2">
        <Switch id="add-required" checked={required} onCheckedChange={setRequired} />
        <Label htmlFor="add-required" className="text-sm cursor-pointer">Required</Label>
      </div>
      <div className="flex items-center gap-2">
        <Switch id="add-sensitive" checked={isSensitive} onCheckedChange={setIsSensitive} />
        <Label htmlFor="add-sensitive" className="text-sm cursor-pointer">
          Sensitive
          <span className="text-xs text-muted-foreground ml-1">
            (redact for users without &ldquo;View sensitive fields&rdquo;; all changes audited)
          </span>
        </Label>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <Button size="sm" onClick={handleAdd} disabled={saving}>
        {saving ? "Adding…" : "Add field"}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
interface CustomFieldsManagerProps {
  defs: FieldDef[];
  onDefsChange: (defs: FieldDef[]) => void;
  currencySymbol: string;
  /**
   * Hide write affordances (Add form, row editing, delete, drag-reorder)
   * when false. Default true. Server actions still enforce the gate as
   * defence in depth via `requireCustomFieldDefWriteAccess()`.
   */
  canEdit?: boolean;
}

export function CustomFieldsManager({
  defs,
  onDefsChange,
  currencySymbol,
  canEdit = true,
}: CustomFieldsManagerProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editRequired, setEditRequired] = useState(false);
  // CLE-198 — is_sensitive toggle in the row-edit form.
  const [editIsSensitive, setEditIsSensitive] = useState(false);
  const [editInputMode, setEditInputMode] = useState<InputMode>("freeform");
  const [editOptions, setEditOptions] = useState<string[]>([]);
  const [editMaxDecimalPlaces, setEditMaxDecimalPlaces] = useState<string>("");
  const [editError, setEditError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // DnD state
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const dragNodeRef = useRef<HTMLDivElement | null>(null);

  const existingKeys = new Set(defs.map((d) => d.field_key));

  // ---- edit handlers ----
  function startEdit(def: FieldDef) {
    setEditingId(def.id);
    setEditLabel(def.label);
    setEditRequired(def.required);
    setEditIsSensitive(def.is_sensitive ?? false);
    setEditInputMode(def.input_mode ?? "freeform");
    setEditOptions(def.options ?? []);
    setEditMaxDecimalPlaces(def.max_decimal_places !== null && def.max_decimal_places !== undefined ? String(def.max_decimal_places) : "");
    setEditError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditError(null);
  }

  async function saveEdit(def: FieldDef) {
    if (!editLabel.trim()) { setEditError("Label is required"); return; }
    if (usesOptions(editInputMode) && editOptions.length === 0) { setEditError("Add at least one option"); return; }
    setSaving(true);

    const parsedDecimalPlaces =
      def.field_type === "number" && editMaxDecimalPlaces !== ""
        ? parseInt(editMaxDecimalPlaces, 10)
        : null;

    const result = await updateCustomFieldDef(def.id, {
      label: editLabel.trim(),
      required: editRequired,
      input_mode: editInputMode,
      options: usesOptions(editInputMode) ? editOptions : null,
      max_decimal_places: def.field_type === "number" ? parsedDecimalPlaces : undefined,
      is_sensitive: editIsSensitive,
    });
    setSaving(false);
    if (!result.success) { setEditError(result.error ?? "Failed to save"); return; }
    onDefsChange(defs.map((d) => d.id === def.id ? {
      ...d,
      label: editLabel.trim(),
      required: editRequired,
      is_sensitive: editIsSensitive,
      input_mode: editInputMode,
      options: usesOptions(editInputMode) ? editOptions : null,
      max_decimal_places: def.field_type === "number" ? parsedDecimalPlaces : d.max_decimal_places,
    } : d));
    setEditingId(null);
  }

  async function handleDelete(id: string) {
    await deleteCustomFieldDef(id);
    onDefsChange(defs.filter((d) => d.id !== id));
  }

  // ---- add handler ----
  async function handleAdd(newDef: Omit<FieldDef, "id">) {
    const result = await createCustomFieldDef(newDef);
    if (!result.success) return result; // signal error to form
    // Re-fetch to get the server-generated id
    const { getCustomFieldDefs } = await import("@/app/(dashboard)/employees/custom-field-actions");
    const fresh = await getCustomFieldDefs();
    onDefsChange(fresh);
    return undefined; // signal success
  }

  // ---- DnD handlers ----
  function handleDragStart(e: React.DragEvent<HTMLDivElement>, index: number) {
    setDragIndex(index);
    dragNodeRef.current = e.currentTarget;
    e.dataTransfer.effectAllowed = "move";
    setTimeout(() => { if (dragNodeRef.current) dragNodeRef.current.style.opacity = "0.4"; }, 0);
  }

  function handleDragEnter(index: number) {
    if (dragIndex === null || index === dragIndex) return;
    setOverIndex(index);
  }

  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }

  async function handleDrop(e: React.DragEvent<HTMLDivElement>, dropIndex: number) {
    e.preventDefault();
    if (dragIndex === null || dragIndex === dropIndex) return;
    const next = [...defs];
    const [removed] = next.splice(dragIndex, 1);
    next.splice(dropIndex, 0, removed);
    onDefsChange(next);
    await reorderCustomFieldDefs(next.map((d) => d.id));
  }

  function handleDragEnd() {
    if (dragNodeRef.current) dragNodeRef.current.style.opacity = "";
    dragNodeRef.current = null;
    setDragIndex(null);
    setOverIndex(null);
  }

  return (
    <div className="flex flex-col gap-1 py-1">
      {defs.length === 0 && (
        <p className="text-sm text-muted-foreground py-2">No custom fields defined yet.</p>
      )}

      {defs.map((def, i) => {
        const parsedEditDecimalPlaces =
          def.field_type === "number" && editMaxDecimalPlaces !== ""
            ? parseInt(editMaxDecimalPlaces, 10)
            : null;
        return (
        <div
          key={def.id}
          draggable={canEdit && editingId !== def.id}
          onDragStart={(e) => handleDragStart(e, i)}
          onDragEnter={() => handleDragEnter(i)}
          onDragOver={handleDragOver}
          onDrop={(e) => handleDrop(e, i)}
          onDragEnd={handleDragEnd}
          className={cn(
            "rounded-md border transition-colors",
            overIndex === i && dragIndex !== i
              ? "border-t-2 border-primary bg-muted/30"
              : "border-border"
          )}
        >
          {editingId === def.id ? (
            // Edit mode
            <div className="flex flex-col gap-2 p-3">
              <div className="flex flex-col gap-1">
                <Label className="text-xs">Label</Label>
                <Input
                  value={editLabel}
                  onChange={(e) => setEditLabel(e.target.value)}
                  className="h-8 text-sm"
                />
                <p className="text-[11px] text-muted-foreground">Key: <span className="font-mono">{def.field_key}</span> (fixed)</p>
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-xs">Type</Label>
                <Input
                  value={fieldTypeLabel(def.field_type)}
                  disabled
                  className="h-8 text-sm bg-muted"
                />
                <p className="text-[11px] text-muted-foreground">
                  Type is fixed after creation. Delete + recreate to change it.
                </p>
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-xs">Input mode</Label>
                <Select value={editInputMode} onValueChange={(v) => {
                  setEditInputMode(v as InputMode);
                  if (v === "freeform") setEditOptions([]);
                }}>
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {INPUT_MODES.map((m) => (
                      <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {def.field_type === "number" && (
                <div className="flex flex-col gap-1">
                  <Label className="text-xs">Max decimal places</Label>
                  <Input
                    type="number"
                    min={0}
                    max={10}
                    value={editMaxDecimalPlaces}
                    onChange={(e) => setEditMaxDecimalPlaces(e.target.value)}
                    placeholder="Unrestricted"
                    className="h-8 text-sm"
                  />
                </div>
              )}
              {def.field_type === "currency" && (
                <p className="text-xs text-muted-foreground">Currency symbol: <span className="font-medium">{currencySymbol}</span></p>
              )}
              {usesOptions(editInputMode) && (
                <OptionsEditor
                  options={editOptions}
                  onChange={setEditOptions}
                  fieldType={def.field_type as FieldTypeValue}
                  currencySymbol={currencySymbol}
                  maxDecimalPlaces={parsedEditDecimalPlaces}
                />
              )}
              <div className="flex items-center gap-2">
                <Switch id={`edit-req-${def.id}`} checked={editRequired} onCheckedChange={setEditRequired} />
                <Label htmlFor={`edit-req-${def.id}`} className="text-sm cursor-pointer">Required</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch id={`edit-sens-${def.id}`} checked={editIsSensitive} onCheckedChange={setEditIsSensitive} />
                <Label htmlFor={`edit-sens-${def.id}`} className="text-sm cursor-pointer">
                  Sensitive
                  <span className="text-xs text-muted-foreground ml-1">
                    (redact for users without &ldquo;View sensitive fields&rdquo;; all changes audited)
                  </span>
                </Label>
              </div>
              {editError && <p className="text-xs text-destructive">{editError}</p>}
              <div className="flex gap-2">
                <Button size="sm" onClick={() => saveEdit(def)} disabled={saving}>
                  <Check className="h-3.5 w-3.5 mr-1" />
                  {saving ? "Saving…" : "Save"}
                </Button>
                <Button size="sm" variant="ghost" onClick={cancelEdit}>Cancel</Button>
              </div>
            </div>
          ) : (
            // Display mode — click anywhere on the row to edit (write only).
            <div
              className={cn(
                "flex items-center gap-2 px-2 py-2 select-none",
                canEdit ? "cursor-pointer hover:bg-muted/50" : "cursor-default",
              )}
              onClick={canEdit ? () => startEdit(def) : undefined}
            >
              {canEdit && (
                <GripVertical
                  className="h-4 w-4 shrink-0 text-muted-foreground cursor-grab active:cursor-grabbing"
                  onClick={(e) => e.stopPropagation()}
                />
              )}
              <span className="flex-1 text-sm font-medium flex items-center gap-1.5">
                {def.label}
                {def.is_sensitive && (
                  <Shield
                    className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400"
                    aria-label="Sensitive field"
                  />
                )}
              </span>
              <div className="flex items-center gap-1 shrink-0">
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                  {fieldTypeLabel(def.field_type)}
                </Badge>
                {def.input_mode && def.input_mode !== "freeform" && (
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                    {inputModeLabel(def.input_mode)}
                  </Badge>
                )}
                {def.field_type === "number" && def.max_decimal_places !== null && def.max_decimal_places !== undefined && (
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                    {def.max_decimal_places === 0 ? "Integer" : `${def.max_decimal_places}dp`}
                  </Badge>
                )}
                {def.required && (
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-destructive text-destructive">
                    Required
                  </Badge>
                )}
              </div>
              {canEdit && (
                <button
                  type="button"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); handleDelete(def.id); }}
                  className="text-muted-foreground hover:text-destructive p-1"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          )}
        </div>
        );
      })}

      {canEdit && (
        <AddFieldForm
          onAdd={handleAdd}
          nextOrder={defs.length}
          existingKeys={existingKeys}
          currencySymbol={currencySymbol}
        />
      )}
    </div>
  );
}
