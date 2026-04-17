export type ColPref = { id: string; visible: boolean };

export type SortPref = { id: string; desc: boolean };

export type GridPrefs = {
  columns: ColPref[];
  filters?: Record<string, unknown>;
  sorting?: SortPref[];
  groupBy?: string;
  pdfPageBreak?: boolean;
  pdfRepeatHeaders?: boolean;
  aggregateMetrics?: string[];
};

/** Normalises the raw JSONB value from user_grid_preferences.prefs.
 *  Handles both the legacy ColPref[] array format and the current {columns, groupBy} object format. */
export function parseGridPrefs(raw: unknown): GridPrefs {
  if (Array.isArray(raw)) return { columns: raw as ColPref[] };
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    return {
      columns: Array.isArray(obj.columns) ? (obj.columns as ColPref[]) : [],
      filters: obj.filters && typeof obj.filters === "object" && !Array.isArray(obj.filters) ? (obj.filters as Record<string, unknown>) : undefined,
      sorting: Array.isArray(obj.sorting)
        ? (obj.sorting as unknown[])
            .filter((s): s is { id: string; desc: boolean } => !!s && typeof s === "object" && typeof (s as { id?: unknown }).id === "string" && typeof (s as { desc?: unknown }).desc === "boolean")
        : undefined,
      groupBy: typeof obj.groupBy === "string" && obj.groupBy ? obj.groupBy : undefined,
      pdfPageBreak: obj.pdfPageBreak === true ? true : undefined,
      pdfRepeatHeaders: obj.pdfRepeatHeaders === true ? true : undefined,
      aggregateMetrics: Array.isArray(obj.aggregateMetrics)
        ? (obj.aggregateMetrics as unknown[]).filter((m): m is string => typeof m === "string")
        : undefined,
    };
  }
  return { columns: [] };
}
