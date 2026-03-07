export interface ClockingData {
  id:           string;
  clockedAt:    string;        // ISO timestamptz — immutable
  rawType:      string | null; // 'IN' | 'OUT' | 'CC' | null
  inferredType: string | null; // 'IN' | 'OUT' | 'CC' | 'bStart' | 'AMBIGUOUS'
  isBstart:     boolean;
  typeLocked:   boolean;
  costCentreId: string | null;
}

export interface WorkPeriodData {
  id:             string;
  periodStart:    string;
  periodEnd:      string | null;
  timesheetDate:  string;      // "YYYY-MM-DD"
  hasConflicts:   boolean;
  inferenceRunAt: string | null;
  scheduledShift: {
    name:         string;
    plannedStart: string | null; // "HH:MM:SS"
    plannedEnd:   string | null;
  } | null;
  clockings: ClockingData[];
}

/** An IN/OUT pair extracted from a work period's clockings */
export interface ClockingPair {
  in:  ClockingData | null;
  out: ClockingData | null;
}

/** Extract paired IN/OUT clockings from a work period, in time order */
export function computePairs(clockings: ClockingData[]): ClockingPair[] {
  const relevant = clockings
    .filter((c) =>
      c.inferredType === "IN" ||
      c.inferredType === "OUT" ||
      c.inferredType === "bStart"
    )
    .sort((a, b) => a.clockedAt.localeCompare(b.clockedAt));

  const pairs: ClockingPair[] = [];
  let i = 0;
  while (i < relevant.length) {
    const c = relevant[i];
    const isIn = c.inferredType === "IN" || c.inferredType === "bStart";
    if (isIn) {
      const next = relevant[i + 1];
      if (next && next.inferredType === "OUT") {
        pairs.push({ in: c, out: next });
        i += 2;
      } else {
        pairs.push({ in: c, out: null });
        i++;
      }
    } else {
      // Orphan OUT (no preceding IN)
      pairs.push({ in: null, out: c });
      i++;
    }
  }
  return pairs;
}

/** Sum hours from complete IN/OUT pairs */
export function computeGrossHours(pairs: ClockingPair[]): number {
  return pairs.reduce((total, p) => {
    if (!p.in || !p.out) return total;
    return total + (new Date(p.out.clockedAt).getTime() - new Date(p.in.clockedAt).getTime()) / 3_600_000;
  }, 0);
}

/** Format "HH:MM" from an ISO timestamp (UTC) */
export function fmtTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

/** Format hours as "8h 30m" */
export function fmtHours(h: number): string {
  if (h <= 0) return "—";
  const hrs  = Math.floor(h);
  const mins = Math.round((h - hrs) * 60);
  if (mins === 0) return `${hrs}h`;
  if (hrs === 0)  return `${mins}m`;
  return `${hrs}h ${mins}m`;
}
