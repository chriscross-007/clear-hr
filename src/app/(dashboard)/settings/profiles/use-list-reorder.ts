"use client";

// Shared drag-reorder hook used by every Profile list tab.
//
// HTML5 native drag-and-drop. Optimistic local reorder, server-action call
// to persist, revert on failure. Pattern mirrors CustomFieldsManager's
// inline DnD — extracted here so the four profile clients don't each
// re-implement 40 lines of identical state.
//
// Each row spreads `rowProps(index)` onto its wrapper <div>; that wires up
// `draggable` + the five drag handlers. `rowClassExtra(index)` returns the
// extra class names for drop-target highlighting.
//
// Use `canDrag(item, index)` to suppress the drag handle on rows that
// shouldn't move (e.g. the Default Notice profile which is pinned).

import { useRef, useState, type DragEvent, type HTMLAttributes } from "react";

interface ReorderResult {
  success: boolean;
  error?: string;
}

interface UseListReorderArgs<T extends { id: string }> {
  items: T[];
  setItems: (next: T[]) => void;
  onReorder: (orderedIds: string[]) => Promise<ReorderResult | void>;
  /** Whether this index can be picked up. Defaults to true for all. */
  canDrag?: (item: T, index: number) => boolean;
  /** Surface persist errors back to the parent. */
  onError?: (error: string) => void;
}

interface RowDragProps extends HTMLAttributes<HTMLDivElement> {
  draggable: boolean;
}

export function useListReorder<T extends { id: string }>({
  items,
  setItems,
  onReorder,
  canDrag,
  onError,
}: UseListReorderArgs<T>) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const dragNodeRef = useRef<HTMLElement | null>(null);

  function rowProps(index: number): RowDragProps {
    const item = items[index];
    const draggable = canDrag ? canDrag(item, index) : true;
    return {
      draggable,
      onDragStart: (e: DragEvent<HTMLDivElement>) => {
        if (!draggable) return;
        setDragIndex(index);
        dragNodeRef.current = e.currentTarget;
        e.dataTransfer.effectAllowed = "move";
        // Fade the row slightly while it's being dragged.
        setTimeout(() => {
          if (dragNodeRef.current) dragNodeRef.current.style.opacity = "0.4";
        }, 0);
      },
      onDragEnter: () => {
        if (dragIndex === null || index === dragIndex) return;
        // canDrag protects the source. Also protect the drop target so a
        // pinned row can't be replaced (avoid swapping a Default to position N).
        if (canDrag && !canDrag(items[index], index)) return;
        setOverIndex(index);
      },
      onDragOver: (e: DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      },
      onDrop: async (e: DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        if (dragIndex === null || dragIndex === index) return;
        if (canDrag && !canDrag(items[index], index)) return;
        const prev = items;
        const next = [...items];
        const [removed] = next.splice(dragIndex, 1);
        next.splice(index, 0, removed);
        setItems(next);
        const result = await onReorder(next.map((it) => it.id));
        if (result && result.success === false) {
          setItems(prev);
          onError?.(result.error ?? "Failed to reorder");
        }
      },
      onDragEnd: () => {
        if (dragNodeRef.current) dragNodeRef.current.style.opacity = "";
        dragNodeRef.current = null;
        setDragIndex(null);
        setOverIndex(null);
      },
    };
  }

  function rowClassExtra(index: number): string {
    return overIndex === index && dragIndex !== index
      ? "border-t-2 border-primary bg-muted/30"
      : "";
  }

  return { rowProps, rowClassExtra, dragIndex, overIndex };
}
