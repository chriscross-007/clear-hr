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

// ─── Overtime band rate splitting ────────────────────────────────────────────

export interface OvertimeBandDef {
  rate_id:   string | null;
  from_time: string;        // "HH:MM"
  to_time:   string | null; // "HH:MM", or null = end of day (24:00)
  min_time:  string | null; // minimum duration "HH:MM", or null
}

function timeStrToMins(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Given completed IN/OUT pairs and a shift's overtime bands, returns a map of
 * rateId → hours worked at that rate, respecting time-of-day ranges and minimums.
 *
 * If total time in a band is below its min_time, those hours fall back to the
 * first band that has no minimum (the "base" rate), or the first band overall.
 *
 * Hours that fall outside all defined bands are credited to the same fallback.
 * The special key "__unmatched__" is used when there are no bands at all.
 */
export function splitHoursByBands(
  pairs: ClockingPair[],
  bands: OvertimeBandDef[],
  rounding?: RoundingConfig,
): Record<string, number> {
  // No bands → caller decides how to display gross hours
  if (bands.length === 0) return {};

  const parsed = bands.map((b) => ({
    rate_id:   b.rate_id,          // null means "no rate selected"
    from_mins: timeStrToMins(b.from_time),
    to_mins:   b.to_time ? timeStrToMins(b.to_time) : 1440,
    min_mins:  b.min_time ? timeStrToMins(b.min_time) : null,
  }));

  const bandMins = new Array<number>(parsed.length).fill(0);

  for (const pair of pairs) {
    if (!pair.in || !pair.out) continue;

    const inMs = rounding
      ? roundedMs(effectiveTime(pair.in),  effectiveType(pair.in),  rounding)
      : new Date(effectiveTime(pair.in)).getTime();
    const outMs = rounding
      ? roundedMs(effectiveTime(pair.out), effectiveType(pair.out), rounding)
      : new Date(effectiveTime(pair.out)).getTime();
    if (outMs <= inMs) continue;

    const inTod        = Math.floor(inMs  / 60_000) % 1440;
    const outTod       = Math.floor(outMs / 60_000) % 1440;
    const durationMins = (outMs - inMs) / 60_000;

    // If the pair crosses midnight, split into two segments
    const segments: Array<[number, number]> =
      outTod > inTod || durationMins === 0
        ? [[inTod, outTod]]
        : [[inTod, 1440], [0, outTod]];

    for (const [segStart, segEnd] of segments) {
      for (let i = 0; i < parsed.length; i++) {
        const b     = parsed[i];
        const start = Math.max(segStart, b.from_mins);
        const end   = Math.min(segEnd,   b.to_mins);
        if (end > start) {
          bandMins[i] += end - start;
        }
      }
      // Hours outside all defined bands are intentionally not counted.
    }
  }

  // Build result, applying minimums.
  // Below-minimum: discard entirely (not credited to any rate).
  // Unmatched: already excluded above.
  const result: Record<string, number> = {};
  for (let i = 0; i < parsed.length; i++) {
    const mins = bandMins[i];
    if (mins === 0) continue;
    const b = parsed[i];
    if (b.min_mins !== null && mins < b.min_mins) continue; // below threshold → discard
    if (b.rate_id === null) continue; // no rate selected → skip
    result[b.rate_id] = (result[b.rate_id] ?? 0) + mins;
  }

  return Object.fromEntries(Object.entries(result).map(([k, v]) => [k, v / 60]));
}

/** Break rule definition — mirrors the shift_definitions.break_rules JSONB schema */
export interface BreakRuleDef {
  band_start:    string;        // "HH:MM" — start of break window
  band_end:      string;        // "HH:MM" — end of break window
  allowed_break: string;        // "HH:MM" — allowed break duration
  penalty_break: string | null; // "HH:MM" — deducted when no break clocked, or null
  paid:          boolean;
  rate_id:       string | null; // which rate bucket receives the deduction/addition
}

/**
 * Apply break rules to an already rate-split hours map.
 *
 * For each rule, find BreakOut / BreakIn clockings that fall inside the break
 * band window [band_start, band_end] and apply the 13-rule matrix:
 *
 *   Row 1  – neither inside band             → deduct penalty_break
 *   Row 2  – both, clocked ≤ allowed, paid   → add    (BrkIN − BrkOUT)
 *   Row 3  – both, clocked ≤ allowed, unpaid → deduct (allowed − clocked)
 *   Row 4  – both, clocked > allowed, paid   → add    allowed
 *   Row 5  – both, clocked > allowed, unpaid → no change
 *   Row 6  – OUT only, inside ≤ allowed, paid   → add    (BBend − BrkOUT)
 *   Row 7  – OUT only, inside ≤ allowed, unpaid → deduct (allowed − (BBend − BrkOUT))
 *   Row 8  – OUT only, inside > allowed, paid   → add    allowed
 *   Row 9  – OUT only, inside > allowed, unpaid → no change
 *   Row 10 – IN only,  inside ≤ allowed, paid   → add    (BrkIN − BBstart)
 *   Row 11 – IN only,  inside ≤ allowed, unpaid → deduct (allowed − (BrkIN − BBstart))
 *   Row 12 – IN only,  inside > allowed, paid   → add    allowed
 *   Row 13 – IN only,  inside > allowed, unpaid → no change
 *
 * Returns a new map — values are never driven below zero.
 */
export function applyBreakRules(
  clockings:  ClockingData[],
  rateSplit:  Record<string, number>,
  breakRules: BreakRuleDef[],
): Record<string, number> {
  if (breakRules.length === 0) return rateSplit;

  const result = { ...rateSplit };

  function todMins(iso: string): number {
    return Math.floor(new Date(iso).getTime() / 60_000) % 1440;
  }
  function isBreakOut(c: ClockingData): boolean {
    const t = effectiveType(c);
    return t === "BreakOut" || t === "BRK_OUT";
  }
  function isBreakIn(c: ClockingData): boolean {
    const t = effectiveType(c);
    return t === "BreakIn" || t === "BRK_IN";
  }

  for (const rule of breakRules) {
    if (!rule.rate_id) continue;

    const BBstart = timeStrToMins(rule.band_start);
    const BBend   = timeStrToMins(rule.band_end);
    const allowed = timeStrToMins(rule.allowed_break);
    const penalty = rule.penalty_break ? timeStrToMins(rule.penalty_break) : 0;

    const brkOutsInside = clockings.filter((c) => {
      if (!isBreakOut(c)) return false;
      const tod = todMins(effectiveTime(c));
      return tod >= BBstart && tod < BBend;
    });
    const brkInsInside = clockings.filter((c) => {
      if (!isBreakIn(c)) return false;
      const tod = todMins(effectiveTime(c));
      return tod >= BBstart && tod < BBend;
    });

    const hasBrkOut = brkOutsInside.length > 0;
    const hasBrkIn  = brkInsInside.length > 0;

    let adjustMins = 0;

    if (!hasBrkOut && !hasBrkIn) {
      // Row 1: no break clocked → deduct penalty
      adjustMins = -penalty;

    } else if (hasBrkOut && hasBrkIn) {
      const brkOutTod = todMins(effectiveTime(brkOutsInside[0]));
      const brkInTod  = todMins(effectiveTime(brkInsInside[0]));
      const clocked   = brkInTod - brkOutTod;

      if (clocked <= allowed) {
        adjustMins = rule.paid ? clocked : -(allowed - clocked); // rows 2 & 3
      } else {
        adjustMins = rule.paid ? allowed : 0;              // rows 4 & 5
      }

    } else if (hasBrkOut && !hasBrkIn) {
      // BrkOUT inside band, BrkIN outside (late back)
      const brkOutTod   = todMins(effectiveTime(brkOutsInside[0]));
      const insideMins  = BBend - brkOutTod;

      if (insideMins <= allowed) {
        adjustMins = rule.paid ? insideMins : -(allowed - insideMins); // rows 6 & 7
      } else {
        adjustMins = rule.paid ? allowed : 0;                          // rows 8 & 9
      }

    } else {
      // BrkIN inside band, BrkOUT outside (early out)
      const brkInTod   = todMins(effectiveTime(brkInsInside[0]));
      const insideMins = brkInTod - BBstart;

      if (insideMins <= allowed) {
        adjustMins = rule.paid ? insideMins : -(allowed - insideMins); // rows 10 & 11
      } else {
        adjustMins = rule.paid ? allowed : 0;                          // rows 12 & 13
      }
    }

    if (adjustMins !== 0) {
      const adjustHours = adjustMins / 60;
      result[rule.rate_id] = Math.max(0, (result[rule.rate_id] ?? 0) + adjustHours);
    }
  }

  return result;
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
