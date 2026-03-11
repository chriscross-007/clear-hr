# Timesheet Inference Engine — Rules (v2)

## Org Settings

| Setting | DB column | Default | Meaning |
|---------|-----------|---------|---------|
| MaxShiftLength | `ts_max_shift_hours` | 14 h | Maximum duration of a single shift. If elapsed time since the last bStart exceeds this, the shift is considered closed (D = false). |
| MaxBreakLength | `ts_max_break_minutes` | 60 min | Maximum expected break duration. Used to decide whether a following/preceding clocking is a break return (C/E conditions). |
| ShiftStartVariance | `ts_shift_start_variance_minutes` | 30 min | Tolerance window around the planned shift start time. A clocking within ±ShiftStartVariance of the planned start is considered "inside the start band" (B = true). |

---

## Raw Clocking Types (from terminal)

| Value | Meaning |
|-------|---------|
| `IN` | Explicit clock-in |
| `OUT` | Explicit clock-out |
| `BreakIN` | Explicit break return (terminal supports break buttons) |
| `BreakOUT` | Explicit break start (terminal supports break buttons) |
| `null` | Bare swipe — no explicit type |
| `CC` | Cost centre allocation — handled separately, always inferred as `CC` |

---

## Inferred Types (engine output)

| Value | Meaning |
|-------|---------|
| `bStart` | Beginning of shift |
| `bEnd` | End of shift |
| `BreakOut` | Employee clocked out for a break |
| `BreakIn` | Employee clocked in from a break |
| `INambiguous` | Ambiguous clock-in — needs manager review |
| `OUTambiguous` | Ambiguous clock-out — needs manager review |
| `CC` | Cost centre allocation |

---

## Conditions

Evaluated per clocking during the forward pass:

| Code | Condition |
|------|-----------|
| **D** | There is an **open** bStart within MaxShiftLength hours — i.e. a bStart exists with no subsequent bEnd, and `(now − bStart) < MaxShiftLength`. |
| **B** | This clocking falls **inside the ShiftStartVariance band** — `|clockedAt − plannedShiftStart| ≤ ShiftStartVarianceMinutes`. False if no scheduled shift exists for this day. |
| **C** | The **next** clocking is within MaxBreakLength minutes after this one. |
| **E** | The **previous** clocking is within MaxBreakLength minutes before this one. |

---

## Rules

Rules are applied **top-to-bottom; the first matching rule wins**.
`prev` = effective inferred type of the most recent non-CC clocking (or null if this is the first).

### Raw = IN

| Rule | Conditions | → Inferred |
|------|-----------|------------|
| IN-1 | prev ≠ bStart **AND** B | bStart |
| IN-2 | D = false | bStart |
| IN-3 | prev = BreakOut **AND** D | BreakIn |
| IN-4 | prev ≠ BreakOut **AND** D | INambiguous |

### Raw = OUT

| Rule | Conditions | → Inferred |
|------|-----------|------------|
| OUT-1 | D = false | OUTambiguous |
| OUT-2 | prev = bStart or BreakIn **AND** C | BreakOut |
| OUT-3 | prev = bStart or BreakIn **AND** ¬C | bEnd |
| OUT-4 | prev = BreakOut **AND** D = false | OUTambiguous *(subsumed by OUT-1)* |
| OUT-5 | prev = BreakOut **AND** ¬C **AND** D | bEnd |
| OUT-6 | prev = BreakOut **AND** C **AND** D | BreakOut |
| OUT-7 | prev = INambiguous | INambiguous |
| OUT-8 | prev = OUTambiguous | OUTambiguous |

### Raw = BreakIN

| Rule | Conditions | → Inferred |
|------|-----------|------------|
| BreakIN-1 | D | BreakIn |
| BreakIN-2 | ¬D | bStart |

### Raw = BreakOUT

| Rule | Conditions | → Inferred |
|------|-----------|------------|
| BreakOUT-1 | D | BreakOut |
| BreakOUT-2 | ¬D | OUTambiguous |

### Raw = null (bare swipe)

| Rule | Conditions | → Inferred |
|------|-----------|------------|
| null-1 | D = false | bStart |
| null-2 | prev = BreakOut **AND** ¬E | bStart |
| null-3 | prev ≠ bStart **AND** B | bStart |
| null-4 | prev = BreakOut **AND** D **AND** E | BreakIn |
| null-5 | prev = bStart or BreakIn **AND** C **AND** D | BreakOut |
| null-6 | prev = bStart **AND** ¬C **AND** D | bEnd |
| null-7 | prev = BreakIn **AND** ¬B **AND** ¬C **AND** D | bEnd |
| null-8 | prev = BreakIn **AND** ¬B **AND** C **AND** D | BreakOut *(redundant with null-5; kept for completeness)* |
| null-9 | prev = INambiguous **AND** ¬B **AND** D | OUTambiguous |
| null-10 | prev = OUTambiguous **AND** ¬B **AND** D | INambiguous |

---

## Override

When a manager sets `override_type` on a clocking:
- The inference engine skips recalculating that clocking's type.
- `inferred_type` retains the last engine-computed value (for reference).
- `override_type` is used for all display and calculation purposes.
- The timesheet shows override clockings in **blue** with an "edited" label.
- Clearing `override_type` (setting to null) reverts to engine inference on next run.
- All changes are audited in `clocking_adjustments`.

---

## Work Period Derivation

After the forward pass, work periods are derived from bStart/bEnd pairs:

1. Each `bStart` clocking opens a new work period (`period_start = clocked_at`).
2. The next `bEnd` closes it (`period_end = clocked_at`). Periods without a bEnd are open (employee still clocked in).
3. All clockings between a bStart and its bEnd belong to that work period.
4. Clockings that fall outside any bStart/bEnd context have `work_period_id = null`.
5. Orphaned work periods (whose bStart clocking was deleted or moved) are deleted after each inference run.

### Hours Calculation

Net hours = sum of (OUT-side − IN-side) for each IN/OUT pair, where:
- IN-side types: `bStart`, `BreakIn`
- OUT-side types: `bEnd`, `BreakOut`

This naturally deducts break time: a `(bStart, BreakOut)` pair covers the first working block, and `(BreakIn, bEnd)` covers the second, so the break gap is excluded.
