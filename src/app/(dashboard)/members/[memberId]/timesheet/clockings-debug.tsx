"use client";

import { useState, useTransition } from "react";
import { ChevronDown, Plus, Pencil, Trash2, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  debugCreateClocking,
  debugUpdateClocking,
  debugDeleteClocking,
} from "@/app/(dashboard)/timesheet-actions";

export interface DebugClocking {
  id:           string;
  clockedAt:    string;
  rawType:      string | null;
  inferredType: string | null;
  overrideType: string | null;
  workPeriodId: string | null;
  isDeleted:    boolean;
}

const RAW_TYPES = [
  { value: "",         label: "— (null)" },
  { value: "IN",       label: "IN" },
  { value: "OUT",      label: "OUT" },
  { value: "BreakIN",  label: "BreakIN" },
  { value: "BreakOUT", label: "BreakOUT" },
];

/** Convert ISO timestamptz to datetime-local value (UTC, strips seconds) */
function toLocalInput(iso: string): string {
  return iso.slice(0, 16); // "YYYY-MM-DDTHH:MM"
}

/** Convert datetime-local value to UTC ISO string */
function fromLocalInput(val: string): string {
  return val ? `${val}:00Z` : new Date().toISOString();
}

interface EditState {
  id:        string | null; // null = new row
  clockedAt: string;        // datetime-local value
  rawType:   string;
}

export function ClockingsDebug({
  memberId,
  clockings,
  onRefresh,
}: {
  memberId:  string;
  clockings: DebugClocking[];
  onRefresh: () => void | Promise<void>;
}) {
  const [open, setOpen]         = useState(false);
  const [edit, setEdit]         = useState<EditState | null>(null);
  const [error, setError]       = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function startNew() {
    const today = new Date().toISOString().slice(0, 10);
    setEdit({ id: null, clockedAt: `${today}T09:00`, rawType: "" });
    setError(null);
  }

  function startEdit(c: DebugClocking) {
    setEdit({ id: c.id, clockedAt: toLocalInput(c.clockedAt), rawType: c.rawType ?? "" });
    setError(null);
  }

  function cancelEdit() {
    setEdit(null);
    setError(null);
  }

  function handleSave() {
    if (!edit) return;
    setError(null);

    startTransition(async () => {
      const clockedAt = fromLocalInput(edit.clockedAt);
      const rawType   = edit.rawType || null;

      const result = edit.id === null
        ? await debugCreateClocking(memberId, clockedAt, rawType)
        : await debugUpdateClocking(edit.id, clockedAt, rawType);

      if (result.success) {
        setEdit(null);
        onRefresh();
      } else {
        setError(result.error ?? "Save failed");
      }
    });
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      const result = await debugDeleteClocking(id);
      if (result.success) {
        onRefresh();
      } else {
        setError(result.error ?? "Delete failed");
      }
    });
  }

  const isEditingNew = edit?.id === null;

  return (
    <div className="mt-8 rounded-md border border-dashed border-border">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-4 py-3 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
        <span className="font-medium">Debug: Clockings</span>
        <span className="ml-auto text-xs">
          {clockings.length} clocking{clockings.length !== 1 ? "s" : ""} this week
        </span>
      </button>

      {open && (
        <div className="border-t border-border px-4 pb-4 pt-3 space-y-3">
          <p className="text-xs text-muted-foreground">
            Dates and times are UTC. Use this to simulate terminal clockings for testing.
          </p>

          {error && <p className="text-xs text-destructive">{error}</p>}

          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-sm border-collapse min-w-[640px]">
              <thead>
                <tr className="bg-muted/50 border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2 text-left">Date / Time (UTC)</th>
                  <th className="px-3 py-2 text-left">Raw Type</th>
                  <th className="px-3 py-2 text-left">Inferred</th>
                  <th className="px-3 py-2 text-left">Override</th>
                  <th className="px-3 py-2 text-left">Work Period</th>
                  <th className="px-2 py-2 text-left">Del</th>
                  <th className="px-2 py-2 w-8" />
                </tr>
              </thead>
              <tbody>
                {clockings.map((c) => {
                  const isEditing = edit?.id === c.id;
                  return (
                    <tr
                      key={c.id}
                      className={cn(
                        "border-b border-border/50 last:border-0",
                        c.isDeleted && "opacity-40",
                        isEditing && "bg-accent/30",
                      )}
                    >
                      <td className="px-3 py-1.5">
                        {isEditing ? (
                          <input
                            type="datetime-local"
                            value={edit.clockedAt}
                            onChange={(e) => setEdit({ ...edit, clockedAt: e.target.value })}
                            className="text-xs rounded border border-border bg-background px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-ring"
                          />
                        ) : (
                          <span className="tabular-nums text-xs">{toLocalInput(c.clockedAt).replace("T", " ")}</span>
                        )}
                      </td>
                      <td className="px-3 py-1.5">
                        {isEditing ? (
                          <select
                            value={edit.rawType}
                            onChange={(e) => setEdit({ ...edit, rawType: e.target.value })}
                            className="text-xs rounded border border-border bg-background px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-ring"
                          >
                            {RAW_TYPES.map((t) => (
                              <option key={t.value} value={t.value}>{t.label}</option>
                            ))}
                          </select>
                        ) : (
                          <span className={cn("text-xs font-mono", !c.rawType && "text-muted-foreground/50")}>
                            {c.rawType ?? "null"}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-1.5">
                        <span className="text-xs text-muted-foreground font-mono">
                          {c.inferredType ?? "—"}
                        </span>
                      </td>
                      <td className="px-3 py-1.5">
                        {c.overrideType ? (
                          <span className="text-xs font-mono text-blue-600 dark:text-blue-400 font-medium">
                            {c.overrideType}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground/40">—</span>
                        )}
                      </td>
                      <td className="px-3 py-1.5">
                        <span className="text-xs text-muted-foreground font-mono truncate max-w-28 block">
                          {c.workPeriodId ? c.workPeriodId.slice(0, 8) + "…" : "—"}
                        </span>
                      </td>
                      <td className="px-2 py-1.5">
                        {isEditing ? (
                          <div className="flex gap-1">
                            <button
                              onClick={handleSave}
                              disabled={isPending}
                              className="p-1 rounded hover:bg-accent text-green-600 hover:text-green-700 transition-colors"
                              title="Save"
                            >
                              <Check className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={cancelEdit}
                              className="p-1 rounded hover:bg-accent text-muted-foreground transition-colors"
                              title="Cancel"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => handleDelete(c.id)}
                            disabled={isPending}
                            className="p-1 rounded hover:bg-destructive/10 text-destructive/60 hover:text-destructive transition-colors"
                            title="Delete"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </td>
                      <td className="px-2 py-1.5">
                        {!isEditing && (
                          <button
                            onClick={() => startEdit(c)}
                            disabled={!!edit}
                            className="p-1 rounded hover:bg-accent text-muted-foreground transition-colors disabled:opacity-30"
                            title="Edit"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}

                {/* New row being added */}
                {isEditingNew && edit && (
                  <tr className="border-b border-border/50 last:border-0 bg-accent/30">
                    <td className="px-3 py-1.5">
                      <input
                        type="datetime-local"
                        value={edit.clockedAt}
                        onChange={(e) => setEdit({ ...edit, clockedAt: e.target.value })}
                        className="text-xs rounded border border-border bg-background px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-ring"
                        autoFocus
                      />
                    </td>
                    <td className="px-3 py-1.5">
                      <select
                        value={edit.rawType}
                        onChange={(e) => setEdit({ ...edit, rawType: e.target.value })}
                        className="text-xs rounded border border-border bg-background px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-ring"
                      >
                        {RAW_TYPES.map((t) => (
                          <option key={t.value} value={t.value}>{t.label}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-1.5 text-xs text-muted-foreground">—</td>
                    <td className="px-3 py-1.5 text-xs text-muted-foreground">—</td>
                    <td className="px-3 py-1.5 text-xs text-muted-foreground">—</td>
                    <td className="px-2 py-1.5">
                      <div className="flex gap-1">
                        <button
                          onClick={handleSave}
                          disabled={isPending}
                          className="p-1 rounded hover:bg-accent text-green-600 hover:text-green-700 transition-colors"
                          title="Save"
                        >
                          <Check className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={cancelEdit}
                          className="p-1 rounded hover:bg-accent text-muted-foreground transition-colors"
                          title="Cancel"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                    <td />
                  </tr>
                )}

                {clockings.length === 0 && !isEditingNew && (
                  <tr>
                    <td colSpan={7} className="px-3 py-4 text-center text-xs text-muted-foreground">
                      No clockings this week.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={startNew}
            disabled={!!edit}
          >
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Add Clocking
          </Button>
        </div>
      )}
    </div>
  );
}
