"use client";

import { useState, useRef } from "react";
import { GripVertical, Trash2, Plus, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { Rate } from "./rates-actions";
import { createRate, updateRate, deleteRate, reorderRates } from "./rates-actions";

interface RatesManagerProps {
  rates: Rate[];
  onRatesChange: (rates: Rate[]) => void;
}

export function RatesManager({ rates, onRatesChange }: RatesManagerProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editMultiplier, setEditMultiplier] = useState("1.00");
  const [editError, setEditError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [newName, setNewName] = useState("");
  const [newMultiplier, setNewMultiplier] = useState("1.00");
  const [addError, setAddError] = useState<string | null>(null);
  const [addLoading, setAddLoading] = useState(false);

  // DnD state
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const dragNodeRef = useRef<HTMLDivElement | null>(null);

  function startEdit(rate: Rate) {
    setEditingId(rate.id);
    setEditName(rate.name);
    setEditMultiplier(Number(rate.rate_multiplier).toFixed(2));
    setEditError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditError(null);
  }

  async function saveEdit(id: string) {
    if (!editName.trim()) { setEditError("Name is required"); return; }
    const multiplier = parseFloat(editMultiplier);
    if (isNaN(multiplier) || multiplier < 0) { setEditError("Invalid multiplier"); return; }
    setSaving(true);
    const result = await updateRate(id, editName.trim(), multiplier);
    setSaving(false);
    if (!result.success) { setEditError(result.error ?? "Failed to save"); return; }
    onRatesChange(rates.map((r) => (r.id === id ? { ...r, name: editName.trim(), rate_multiplier: multiplier } : r)));
    setEditingId(null);
  }

  async function handleDelete(id: string) {
    const result = await deleteRate(id);
    if (result.success) onRatesChange(rates.filter((r) => r.id !== id));
  }

  async function handleAdd() {
    if (!newName.trim()) return;
    const multiplier = parseFloat(newMultiplier);
    if (isNaN(multiplier) || multiplier < 0) { setAddError("Invalid multiplier"); return; }
    setAddLoading(true);
    setAddError(null);
    const result = await createRate(newName.trim(), multiplier);
    setAddLoading(false);
    if (!result.success || !result.rate) { setAddError(result.error ?? "Failed to create rate"); return; }
    onRatesChange([...rates, result.rate]);
    setNewName("");
    setNewMultiplier("1.00");
  }

  // DnD handlers
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
    const next = [...rates];
    const [removed] = next.splice(dragIndex, 1);
    next.splice(dropIndex, 0, removed);
    onRatesChange(next);
    await reorderRates(next.map((r) => r.id));
  }

  function handleDragEnd() {
    if (dragNodeRef.current) dragNodeRef.current.style.opacity = "";
    dragNodeRef.current = null;
    setDragIndex(null);
    setOverIndex(null);
  }

  return (
    <div className="flex flex-col gap-1 py-1">
      <p className="text-xs text-muted-foreground pb-1">
        Rates appear on timesheets in the order shown. Drag to reorder.
      </p>

      {rates.length === 0 && (
        <p className="text-sm text-muted-foreground py-2">No rates defined yet.</p>
      )}

      {rates.map((rate, i) => (
        <div
          key={rate.id}
          draggable={editingId !== rate.id}
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
          {editingId === rate.id ? (
            <div className="flex items-center gap-2 px-2 py-1.5 flex-wrap">
              <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground opacity-30" />
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); saveEdit(rate.id); }
                  if (e.key === "Escape") cancelEdit();
                }}
                autoFocus
                placeholder="Name"
                className="h-7 text-sm flex-1 min-w-24"
              />
              <div className="flex items-center gap-1 shrink-0">
                <span className="text-sm text-muted-foreground">×</span>
                <Input
                  type="number"
                  value={editMultiplier}
                  onChange={(e) => setEditMultiplier(e.target.value)}
                  min={0}
                  step={0.01}
                  className="h-7 w-20 text-right"
                />
              </div>
              {editError && <span className="text-xs text-destructive w-full pl-6">{editError}</span>}
              <Button type="button" size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={() => saveEdit(rate.id)} disabled={saving}>
                <Check className="h-3.5 w-3.5 text-primary" />
              </Button>
              <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs shrink-0" onClick={cancelEdit}>
                Cancel
              </Button>
            </div>
          ) : (
            <div
              className="flex items-center gap-2 px-2 py-2 cursor-pointer hover:bg-muted/50 select-none"
              onClick={() => startEdit(rate)}
            >
              <GripVertical
                className="h-4 w-4 shrink-0 text-muted-foreground cursor-grab active:cursor-grabbing"
                onClick={(e) => e.stopPropagation()}
              />
              <span className="flex-1 text-sm">{rate.name}</span>
              <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                ×{Number(rate.rate_multiplier).toFixed(2)}
              </span>
              <button
                type="button"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); handleDelete(rate.id); }}
                className="text-muted-foreground hover:text-destructive p-1"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>
      ))}

      {/* Add new rate */}
      <div className="flex gap-2 mt-1 items-center">
        <Input
          type="text"
          placeholder="Name"
          maxLength={50}
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAdd(); } }}
          className="flex-1"
        />
        <div className="flex items-center gap-1 shrink-0">
          <Label className="text-xs text-muted-foreground whitespace-nowrap">×</Label>
          <Input
            type="number"
            value={newMultiplier}
            onChange={(e) => setNewMultiplier(e.target.value)}
            min={0}
            step={0.01}
            className="w-20 text-right"
          />
        </div>
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={handleAdd}
          disabled={addLoading || !newName.trim()}
          className="shrink-0"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      {addError && <p className="text-xs text-destructive">{addError}</p>}
    </div>
  );
}
