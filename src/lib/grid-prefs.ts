export type ColPref = { id: string; visible: boolean };

export type GridPrefs = { columns: ColPref[]; groupBy?: string };

/** Normalises the raw JSONB value from user_grid_preferences.prefs.
 *  Handles both the legacy ColPref[] array format and the current {columns, groupBy} object format. */
export function parseGridPrefs(raw: unknown): GridPrefs {
  if (Array.isArray(raw)) return { columns: raw as ColPref[] };
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    return {
      columns: Array.isArray(obj.columns) ? (obj.columns as ColPref[]) : [],
      groupBy: typeof obj.groupBy === "string" && obj.groupBy ? obj.groupBy : undefined,
    };
  }
  return { columns: [] };
}
