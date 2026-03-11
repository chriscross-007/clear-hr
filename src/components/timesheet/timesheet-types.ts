export interface ClockingData {
  id:           string;
  clockedAt:    string;        // ISO timestamptz — immutable
  rawType:      string | null; // 'IN' | 'OUT' | 'BreakIN' | 'BreakOUT' | 'CC' | null
  inferredType: string | null; // engine output: 'bStart'|'bEnd'|'BreakOut'|'BreakIn'|'INambiguous'|'OUTambiguous'|'CC'
  overrideType: string | null; // manager override — takes precedence over inferredType when set; shown in blue
  isBstart:     boolean;
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
    shiftDefinitionId: string | null;  // null for off-days
    name:         string | null;
    plannedStart: string | null;
    plannedEnd:   string | null;
    isOffDay:     boolean;
  } | null;
  clockings: ClockingData[];
}

/** An IN/OUT pair extracted from a work period's clockings */
export interface ClockingPair {
  in:  ClockingData | null;
  out: ClockingData | null;
}

/** The effective type for a clocking: override takes precedence over inferred */
export function effectiveType(c: ClockingData): string | null {
  return c.overrideType ?? c.inferredType;
}

function isInType(t: string | null): boolean {
  return t === "bStart" || t === "BreakIn";
}
function isOutType(t: string | null): boolean {
  return t === "bEnd" || t === "BreakOut";
}

/** Extract paired IN/OUT clockings from a work period, in time order */
export function computePairs(clockings: ClockingData[]): ClockingPair[] {
  const relevant = clockings
    .filter((c) => {
      const t = effectiveType(c);
      return isInType(t) || isOutType(t);
    })
    .sort((a, b) => a.clockedAt.localeCompare(b.clockedAt));

  const pairs: ClockingPair[] = [];
  let i = 0;
  while (i < relevant.length) {
    const c = relevant[i];
    const t = effectiveType(c);
    if (isInType(t)) {
      const next = relevant[i + 1];
      if (next && isOutType(effectiveType(next))) {
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

/** Sum net hours from complete IN/OUT pairs (break time excluded automatically) */
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
