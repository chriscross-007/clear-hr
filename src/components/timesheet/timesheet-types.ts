export interface ClockingData {
  id:                 string;
  clockedAt:          string;        // ISO timestamptz — original, immutable
  rawType:            string | null; // 'IN' | 'OUT' | 'BreakIN' | 'BreakOUT' | 'CC' | null
  inferredType:       string | null; // engine output: 'bStart'|'bEnd'|'BreakOut'|'BreakIn'|'INambiguous'|'OUTambiguous'|'CC'
  overrideType:       string | null; // manager override — takes precedence over inferredType when set; shown in blue
  isBstart:           boolean;
  costCentreId:       string | null;
  source:             string | null; // 'manual' for manager-added clockings
  // Edit fields — set when a manager has manually adjusted this clocking
  editedClockedAt:    string | null; // replaces clockedAt for inference when set
  editedRawType:      string | null; // replaces rawType for inference when set
  editedByName:       string | null; // display name of editor
  editedAt:           string | null; // when the edit was made
}

/** Context passed when clicking a clocking cell (filled or empty) */
export interface CellClickContext {
  clocking:     ClockingData | null; // null = empty cell
  date:         string;              // YYYY-MM-DD
  workPeriodId: string | null;
  expectedType: "IN" | "OUT";        // column position
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

/** Effective timestamp: edited overrides original */
export function effectiveTime(c: ClockingData): string {
  return c.editedClockedAt ?? c.clockedAt;
}

/** Extract paired IN/OUT clockings from a work period, in time order */
export function computePairs(clockings: ClockingData[]): ClockingPair[] {
  const relevant = clockings
    .filter((c) => {
      const t = effectiveType(c);
      return isInType(t) || isOutType(t);
    })
    .sort((a, b) => effectiveTime(a).localeCompare(effectiveTime(b)));

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

/** Rounding rules for clocking times (minutes; null = no rounding).
 *
 *  Direction: IN-type clockings round forward (later); OUT-type round backward (earlier).
 *
 *  Grace period (graceMins): tolerance before applying directional rounding.
 *  - IN  with grace: if within `grace` minutes of the lower boundary → round DOWN (on time).
 *    Example — interval=15, grace=3: 09:03→09:00, 09:04→09:15.
 *  - OUT with grace: if within `grace` minutes of the upper boundary → round UP (full credit).
 */
export interface RoundingConfig {
  firstInMins:        number | null;
  firstInGraceMins:   number | null;
  breakOutMins:       number | null;
  breakOutGraceMins:  number | null;
  breakInMins:        number | null;
  breakInGraceMins:   number | null;
  lastOutMins:        number | null;
  lastOutGraceMins:   number | null;
}

function roundedMs(isoTime: string, type: string | null, config: RoundingConfig): number {
  const ms = new Date(isoTime).getTime();
  let intervalMins: number | null = null;
  let graceMins = 0;
  let roundForward = true;

  if (type === "bStart") {
    intervalMins = config.firstInMins;
    graceMins    = config.firstInGraceMins ?? 0;
    roundForward = true;
  } else if (type === "bEnd") {
    intervalMins = config.lastOutMins;
    graceMins    = config.lastOutGraceMins ?? 0;
    roundForward = false;
  } else if (type === "BreakOut" || type === "BRK_OUT") {
    intervalMins = config.breakOutMins;
    graceMins    = config.breakOutGraceMins ?? 0;
    roundForward = false;
  } else if (type === "BreakIn" || type === "BRK_IN") {
    intervalMins = config.breakInMins;
    graceMins    = config.breakInGraceMins ?? 0;
    roundForward = true;
  }

  if (!intervalMins) return ms;
  const intervalMs = intervalMins * 60_000;
  const graceMs    = graceMins    * 60_000;

  if (roundForward) {
    // IN: lower boundary + grace → round down (on time); beyond grace → round up
    const lower  = Math.floor(ms / intervalMs) * intervalMs;
    const offset = ms - lower;
    return offset <= graceMs ? lower : Math.ceil(ms / intervalMs) * intervalMs;
  } else {
    // OUT: upper boundary + grace (left slightly early) → round up; beyond → round down
    const upper  = Math.ceil(ms / intervalMs) * intervalMs;
    const offset = upper - ms;
    return offset <= graceMs ? upper : Math.floor(ms / intervalMs) * intervalMs;
  }
}

/** Sum net hours from complete IN/OUT pairs, with optional directional rounding */
export function computeGrossHours(pairs: ClockingPair[], rounding?: RoundingConfig): number {
  return pairs.reduce((total, p) => {
    if (!p.in || !p.out) return total;
    const inMs  = rounding
      ? roundedMs(effectiveTime(p.in),  effectiveType(p.in),  rounding)
      : new Date(effectiveTime(p.in)).getTime();
    const outMs = rounding
      ? roundedMs(effectiveTime(p.out), effectiveType(p.out), rounding)
      : new Date(effectiveTime(p.out)).getTime();
    return total + (outMs - inMs) / 3_600_000;
  }, 0);
}

/** Returns a rounded time label for tooltip display, e.g. "09:00 (3/15)", or null if no rounding applies to this clocking type */
export function fmtRoundedTime(isoTime: string, type: string | null, config: RoundingConfig): string | null {
  let intervalMins: number | null = null;
  let graceMins: number | null = null;

  if (type === "bStart") {
    intervalMins = config.firstInMins;
    graceMins    = config.firstInGraceMins;
  } else if (type === "bEnd") {
    intervalMins = config.lastOutMins;
    graceMins    = config.lastOutGraceMins;
  } else if (type === "BreakOut" || type === "BRK_OUT") {
    intervalMins = config.breakOutMins;
    graceMins    = config.breakOutGraceMins;
  } else if (type === "BreakIn" || type === "BRK_IN") {
    intervalMins = config.breakInMins;
    graceMins    = config.breakInGraceMins;
  }

  if (!intervalMins) return null;

  const roundedIso = new Date(roundedMs(isoTime, type, config)).toISOString();
  const timePart   = fmtTime(roundedIso);
  const graceStr   = graceMins ?? 0;
  return `${timePart} (${graceStr}/${intervalMins})`;
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
