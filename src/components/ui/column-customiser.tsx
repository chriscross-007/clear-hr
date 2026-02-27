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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { ColPref } from "@/app/(dashboard)/employees/grid-prefs-actions";

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
            <span className="sr-only">Customise Columns</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">Customise Columns</TooltipContent>
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
  onChange: (prefs: ColPref[]) => void;
}

export function ColumnCustomiserDialog({
  open,
  onOpenChange,
  prefs,
  colLabels,
  defaultCols,
  onChange,
}: DialogProps) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const dragNodeRef = useRef<HTMLDivElement | null>(null);

  function toggleVisible(id: string) {
    onChange(prefs.map((c) => (c.id === id ? { ...c, visible: !c.visible } : c)));
  }

  function resetToDefault() {
    onChange(defaultCols.map((id) => ({ id, visible: true })));
  }

  function handleDragStart(e: React.DragEvent<HTMLDivElement>, index: number) {
    setDragIndex(index);
    dragNodeRef.current = e.currentTarget;
    // Minimal ghost image — use the row itself but faded
    e.dataTransfer.effectAllowed = "move";
    // Slight delay so the row doesn't disappear immediately
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Customise Columns</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-0.5 py-2">
          {prefs.map((col, i) => (
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
                // Prevent drag from firing when clicking checkbox
                onMouseDown={(e) => e.stopPropagation()}
              />
              <label
                htmlFor={`col-${col.id}`}
                className={cn(
                  "flex-1 text-sm",
                  !col.visible && "text-muted-foreground"
                )}
                // Allow label click but don't start drag
                onMouseDown={(e) => e.stopPropagation()}
              >
                {colLabels[col.id] ?? col.id}
              </label>
            </div>
          ))}
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
