"use client";

import { useState, useRef } from "react";
import { SlidersHorizontal, GripVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { ColPref } from "@/lib/grid-prefs-actions";

// ---------------------------------------------------------------------------
// Trigger button
// ---------------------------------------------------------------------------

interface TriggerProps {
  onClick: () => void;
}

export function ColumnCustomiserTrigger({ onClick }: TriggerProps) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClick}>
            <SlidersHorizontal className="h-4 w-4" />
            <span className="sr-only">Customise</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">Customise</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// ---------------------------------------------------------------------------
// Dialog
// ---------------------------------------------------------------------------

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prefs: ColPref[];
  colLabels: Record<string, string>;
  defaultCols: string[];
  allStandardCols?: string[];
  onChange: (prefs: ColPref[]) => void;
  /** All column IDs available for Group By (should exclude avatar). If omitted, Group By section is hidden. */
  allColIds?: string[];
  groupBy?: string;
  onGroupByChange?: (groupBy: string) => void;
}

export function ColumnCustomiserDialog({
  open,
  onOpenChange,
  prefs,
  colLabels,
  defaultCols,
  allStandardCols,
  onChange,
  allColIds,
  groupBy,
  onGroupByChange,
}: DialogProps) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const dragNodeRef = useRef<HTMLDivElement | null>(null);

  const showGroupBy = !!(allColIds && onGroupByChange);

  function toggleVisible(id: string) {
    onChange(prefs.map((c) => (c.id === id ? { ...c, visible: !c.visible } : c)));
  }

  function resetToDefault() {
    const defaultSet = new Set(defaultCols);
    const defaults = defaultCols.map((id) => ({ id, visible: true }));
    if (allStandardCols) {
      const standardSet = new Set(allStandardCols);
      const standardOthers = allStandardCols
        .filter((id) => !defaultSet.has(id))
        .map((id) => ({ id, visible: false }));
      const extraOthers = prefs
        .filter((c) => !defaultSet.has(c.id) && !standardSet.has(c.id))
        .map((c) => ({ ...c, visible: false }));
      onChange([...defaults, ...standardOthers, ...extraOthers]);
    } else {
      const others = prefs
        .filter((c) => !defaultSet.has(c.id))
        .map((c) => ({ ...c, visible: false }));
      onChange([...defaults, ...others]);
    }
  }

  function handleDragStart(e: React.DragEvent<HTMLDivElement>, index: number) {
    setDragIndex(index);
    dragNodeRef.current = e.currentTarget;
    e.dataTransfer.effectAllowed = "move";
    setTimeout(() => {
      if (dragNodeRef.current) dragNodeRef.current.style.opacity = "0.4";
    }, 0);
  }

  function handleDragEnter(index: number) {
    if (dragIndex === null || index === dragIndex) return;
    setOverIndex(index);
  }

  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>, dropIndex: number) {
    e.preventDefault();
    if (dragIndex === null || dragIndex === dropIndex) return;
    const next = [...prefs];
    const [removed] = next.splice(dragIndex, 1);
    next.splice(dropIndex, 0, removed);
    onChange(next);
  }

  function handleDragEnd() {
    if (dragNodeRef.current) dragNodeRef.current.style.opacity = "";
    dragNodeRef.current = null;
    setDragIndex(null);
    setOverIndex(null);
  }

  // Group By options: all cols except avatar, sorted by label
  const groupByOptions = allColIds
    ? allColIds
        .filter((id) => id !== "avatar")
        .map((id) => ({ id, label: colLabels[id] ?? id }))
        .sort((a, b) => a.label.localeCompare(b.label))
    : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={showGroupBy ? "max-w-2xl" : "max-w-sm"}>
        <DialogHeader>
          <DialogTitle>Customise</DialogTitle>
        </DialogHeader>

        <div className={cn("py-2", showGroupBy ? "grid grid-cols-2 gap-6" : "")}>
          {/* Left column — column list */}
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Columns
            </p>
            <div className="flex flex-col gap-0.5">
              {prefs.map((col, i) => {
                const isCustom = col.id.startsWith("cf_");
                return (
                  <div
                    key={col.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, i)}
                    onDragEnter={() => handleDragEnter(i)}
                    onDragOver={handleDragOver}
                    onDrop={(e) => handleDrop(e, i)}
                    onDragEnd={handleDragEnd}
                    className={cn(
                      "flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors cursor-grab active:cursor-grabbing select-none",
                      overIndex === i && dragIndex !== i
                        ? "border-t-2 border-primary bg-muted/30"
                        : "hover:bg-muted/50"
                    )}
                  >
                    <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <input
                      type="checkbox"
                      id={`col-${col.id}`}
                      checked={col.visible}
                      onChange={() => toggleVisible(col.id)}
                      className="h-4 w-4 cursor-pointer accent-primary"
                      onMouseDown={(e) => e.stopPropagation()}
                    />
                    <label
                      htmlFor={`col-${col.id}`}
                      className={cn(
                        "flex-1 text-sm",
                        isCustom
                          ? col.visible ? "text-blue-600 dark:text-blue-400" : "text-blue-400 dark:text-blue-600"
                          : !col.visible && "text-muted-foreground"
                      )}
                      onMouseDown={(e) => e.stopPropagation()}
                    >
                      {colLabels[col.id] ?? col.id}
                    </label>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right column — PDF options */}
          {showGroupBy && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                PDF Options
              </p>

              <div className="space-y-1">
                <label className="text-sm font-medium">Group By</label>
                <p className="text-xs text-muted-foreground mb-2">
                  Rows in the downloaded PDF will be sorted and grouped by the chosen column.
                </p>
                <Select
                  value={groupBy || "__none__"}
                  onValueChange={(v) => onGroupByChange!(v === "__none__" ? "" : v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="None" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">None</SelectItem>
                    {groupByOptions.map((opt) => (
                      <SelectItem key={opt.id} value={opt.id}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={resetToDefault}>
            Reset to default
          </Button>
          <Button size="sm" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
