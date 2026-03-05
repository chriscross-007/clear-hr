"use client";

import { useState, useRef } from "react";
import { saveGridPrefs, type ColPref } from "@/lib/grid-prefs-actions";

function buildDefaultPrefs(defaultCols: string[]): ColPref[] {
  return defaultCols.map((id) => ({ id, visible: true }));
}

export function useColumnPrefs(
  gridId: string,
  initialPrefs: ColPref[],
  defaultCols: string[],
  resetCols?: string[],
  initialGroupBy?: string
) {
  const [prefs, setPrefs] = useState<ColPref[]>(() => {
    if (initialPrefs.length === 0) return buildDefaultPrefs(defaultCols);
    // Remove cols that no longer exist (e.g. deleted custom fields)
    const valid = initialPrefs.filter((c) => defaultCols.includes(c.id));
    // Append any new cols not yet in saved prefs (e.g. newly added custom fields), visible by default
    const savedIds = new Set(valid.map((c) => c.id));
    const added = defaultCols
      .filter((id) => !savedIds.has(id))
      .map((id) => ({ id, visible: true }));
    return [...valid, ...added];
  });

  const [groupBy, setGroupByState] = useState(initialGroupBy ?? "");

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Refs so debounce callbacks always see the latest values
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const groupByRef = useRef(groupBy);
  groupByRef.current = groupBy;

  function scheduleSave() {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      saveGridPrefs(gridId, {
        columns: prefsRef.current,
        groupBy: groupByRef.current || undefined,
      });
    }, 800);
  }

  function updatePrefs(newPrefs: ColPref[]) {
    setPrefs(newPrefs);
    prefsRef.current = newPrefs;
    scheduleSave();
  }

  function resetPrefs() {
    updatePrefs(buildDefaultPrefs(resetCols ?? defaultCols));
  }

  function updateGroupBy(newGroupBy: string) {
    setGroupByState(newGroupBy);
    groupByRef.current = newGroupBy;
    scheduleSave();
  }

  const columnOrder = prefs.map((c) => c.id);
  const columnVisibility = Object.fromEntries(prefs.map((c) => [c.id, c.visible]));

  return { prefs, updatePrefs, resetPrefs, columnOrder, columnVisibility, groupBy, updateGroupBy };
}
