"use client";

import { useState, useRef } from "react";
import { GripVertical, Pencil, Trash2, Plus, X, Check } from "lucide-react";
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
import type { FieldDef } from "./employees/custom-field-actions";
import {
  createCustomFieldDef,
  updateCustomFieldDef,
  deleteCustomFieldDef,
  reorderCustomFieldDefs,
} from "./employees/custom-field-actions";

// ---------------------------------------------------------------------------
// Field type options
// ---------------------------------------------------------------------------
const FIELD_TYPES = [
  { value: "text",      label: "Text" },
  { value: "multiline", label: "Multi-line Text" },
  { value: "email",     label: "Email" },
  { value: "url",       label: "URL" },
  { value: "phone",     label: "Phone" },
  { value: "number",    label: "Number" },
  { value: "date",      label: "Date" },
  { value: "checkbox",  label: "Checkbox" },
  { value: "dropdown",  label: "Dropdown" },
] as const;

type FieldTypeValue = (typeof FIELD_TYPES)[number]["value"];

function fieldTypeLabel(type: string): string {
  return FIELD_TYPES.find((t) => t.value === type)?.label ?? type;
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
// Dropdown options editor
// ---------------------------------------------------------------------------
interface OptionsEditorProps {
  options: string[];
  onChange: (opts: string[]) => void;
}

function OptionsEditor({ options, onChange }: OptionsEditorProps) {
  const [newOpt, setNewOpt] = useState("");

  function addOption() {
    const trimmed = newOpt.trim();
    if (!trimmed || options.includes(trimmed)) return;
    onChange([...options, trimmed]);
    setNewOpt("");
  }

  function removeOption(idx: number) {
    onChange(options.filter((_, i) => i !== idx));
  }

  return (
    <div className="flex flex-col gap-1.5 pl-1">
      <Label className="text-xs text-muted-foreground">Options</Label>
      {options.map((opt, i) => (
        <div key={i} className="flex items-center gap-1">
          <span className="flex-1 text-sm truncate">{opt}</span>
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
        <Input
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
}

function AddFieldForm({ onAdd, nextOrder, existingKeys }: AddFieldFormProps) {
  const [label, setLabel] = useState("");
  const [fieldType, setFieldType] = useState<FieldTypeValue>("text");
  const [required, setRequired] = useState(false);
  const [options, setOptions] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const fieldKey = toFieldKey(label);

  async function handleAdd() {
    setError(null);
    if (!label.trim()) { setError("Label is required"); return; }
    if (!fieldKey) { setError("Label must contain at least one letter or number"); return; }
    if (existingKeys.has(fieldKey)) { setError("A field with that key already exists"); return; }
    if (fieldType === "dropdown" && options.length === 0) { setError("Add at least one option"); return; }

    setSaving(true);
    const result = await onAdd(
      { label: label.trim(), field_key: fieldKey, field_type: fieldType, options: fieldType === "dropdown" ? options : null, required, sort_order: nextOrder },
      nextOrder
    );
    setSaving(false);
    if (!result || result.success) {
      setLabel("");
      setFieldType("text");
      setRequired(false);
      setOptions([]);
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
        <Select value={fieldType} onValueChange={(v) => { setFieldType(v as FieldTypeValue); if (v !== "dropdown") setOptions([]); }}>
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
      {fieldType === "dropdown" && (
        <OptionsEditor options={options} onChange={setOptions} />
      )}
      <div className="flex items-center gap-2">
        <Switch id="add-required" checked={required} onCheckedChange={setRequired} />
        <Label htmlFor="add-required" className="text-sm cursor-pointer">Required</Label>
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
}

export function CustomFieldsManager({ defs, onDefsChange }: CustomFieldsManagerProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editRequired, setEditRequired] = useState(false);
  const [editOptions, setEditOptions] = useState<string[]>([]);
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
    setEditOptions(def.options ?? []);
    setEditError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditError(null);
  }

  async function saveEdit(def: FieldDef) {
    if (!editLabel.trim()) { setEditError("Label is required"); return; }
    if (def.field_type === "dropdown" && editOptions.length === 0) { setEditError("Add at least one option"); return; }
    setSaving(true);
    const result = await updateCustomFieldDef(def.id, {
      label: editLabel.trim(),
      required: editRequired,
      options: def.field_type === "dropdown" ? editOptions : null,
    });
    setSaving(false);
    if (!result.success) { setEditError(result.error ?? "Failed to save"); return; }
    onDefsChange(defs.map((d) => d.id === def.id ? { ...d, label: editLabel.trim(), required: editRequired, options: def.field_type === "dropdown" ? editOptions : null } : d));
    setEditingId(null);
  }

  async function handleDelete(id: string) {
    await deleteCustomFieldDef(id);
    onDefsChange(defs.filter((d) => d.id !== id));
  }

  // ---- add handler ----
  async function handleAdd(newDef: Omit<FieldDef, "id">, _nextOrder: number) {
    const result = await createCustomFieldDef(newDef);
    if (!result.success) return result; // signal error to form
    // Re-fetch to get the server-generated id
    const { getCustomFieldDefs } = await import("./employees/custom-field-actions");
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

      {defs.map((def, i) => (
        <div
          key={def.id}
          draggable={editingId !== def.id}
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
              {def.field_type === "dropdown" && (
                <OptionsEditor options={editOptions} onChange={setEditOptions} />
              )}
              <div className="flex items-center gap-2">
                <Switch id={`edit-req-${def.id}`} checked={editRequired} onCheckedChange={setEditRequired} />
                <Label htmlFor={`edit-req-${def.id}`} className="text-sm cursor-pointer">Required</Label>
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
            // Display mode
            <div
              className={cn(
                "flex items-center gap-2 px-2 py-2 cursor-grab active:cursor-grabbing select-none",
                "hover:bg-muted/50"
              )}
            >
              <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="flex-1 text-sm font-medium">{def.label}</span>
              <div className="flex items-center gap-1 shrink-0">
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                  {fieldTypeLabel(def.field_type)}
                </Badge>
                {def.required && (
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-destructive text-destructive">
                    Required
                  </Badge>
                )}
              </div>
              <button
                type="button"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); startEdit(def); }}
                className="text-muted-foreground hover:text-foreground p-1"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); handleDelete(def.id); }}
                className="text-muted-foreground hover:text-destructive p-1"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>
      ))}

      <AddFieldForm
        onAdd={handleAdd}
        nextOrder={defs.length}
        existingKeys={existingKeys}
      />
    </div>
  );
}
