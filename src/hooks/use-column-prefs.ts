"use client";

import { useState, useRef } from "react";
import { saveGridPrefs, type ColPref } from "@/app/(dashboard)/employees/grid-prefs-actions";

function buildDefaultPrefs(defaultCols: string[]): ColPref[] {
  return defaultCols.map((id) => ({ id, visible: true }));
}

export function useColumnPrefs(
  gridId: string,
  initialPrefs: ColPref[],
  defaultCols: string[]
) {
  const [prefs, setPrefs] = useState<ColPref[]>(() =>
    initialPrefs.length > 0 ? initialPrefs : buildDefaultPrefs(defaultCols)
  );

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function updatePrefs(newPrefs: ColPref[]) {
    setPrefs(newPrefs);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      saveGridPrefs(gridId, newPrefs);
    }, 800);
  }

  function resetPrefs() {
    updatePrefs(buildDefaultPrefs(defaultCols));
  }

  const columnOrder = prefs.map((c) => c.id);
  const columnVisibility = Object.fromEntries(prefs.map((c) => [c.id, c.visible]));

  return { prefs, updatePrefs, resetPrefs, columnOrder, columnVisibility };
}
