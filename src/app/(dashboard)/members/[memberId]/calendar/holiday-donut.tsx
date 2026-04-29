interface HolidayDonutProps {
  allowance: number;
  taken: number;
  booked: number;
  pending: number;
  /** Absence type colour used for all three segments (with opacity variations). */
  baseColour?: string;
}

// Opacity levels for the three status variations. Taken is fully opaque;
// booked and pending fade progressively.
const OPACITY = {
  taken: 1,
  booked: 0.6,
  pending: 0.3,
};

const BG_REMAINING = "#e5e7eb"; // gray-200 — empty slice
const BG_OVER = "#fee2e2";      // red-100 — subtle warning when over-allowance
const DEFAULT_BASE = "#6366f1"; // indigo fallback when no type colour is set

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

export function HolidayDonut({ allowance, taken, booked, pending, baseColour = DEFAULT_BASE }: HolidayDonutProps) {
  const used = taken + booked + pending;
  const overBooked = used > allowance;
  // When over, scale segments to fill the full ring (denom = used) so the
  // proportions are still readable; the "remaining" portion vanishes.
  const denom = Math.max(allowance, used) || 1;

  const r = 40;
  const c = 2 * Math.PI * r;
  const sw = 14;

  const segLen = (val: number) => (val / denom) * c;
  const tLen = segLen(taken);
  const bLen = segLen(booked);
  const pLen = segLen(pending);

  // Cumulative starting offsets (clockwise from 12 o'clock once the SVG
  // is rotated -90deg). Negative dashoffset shifts the dash pattern
  // backward along the path, exposing the segment at the desired position.
  const tOffset = 0;
  const bOffset = -tLen;
  const pOffset = -(tLen + bLen);

  return (
    <div className="flex flex-row items-center gap-3">
      <div className="flex flex-1 justify-center">
        <div className="relative shrink-0">
          <svg width="92" height="92" viewBox="0 0 100 100" style={{ transform: "rotate(-90deg)" }}>
            <circle
              cx="50"
              cy="50"
              r={r}
              fill="none"
              stroke={overBooked ? BG_OVER : BG_REMAINING}
              strokeWidth={sw}
            />
            {tLen > 0 && (
              <circle
                cx="50"
                cy="50"
                r={r}
                fill="none"
                stroke={baseColour}
                strokeWidth={sw}
                strokeDasharray={`${tLen} ${c}`}
                strokeDashoffset={tOffset}
                opacity={OPACITY.taken}
              />
            )}
            {bLen > 0 && (
              <circle
                cx="50"
                cy="50"
                r={r}
                fill="none"
                stroke={baseColour}
                strokeWidth={sw}
                strokeDasharray={`${bLen} ${c}`}
                strokeDashoffset={bOffset}
                opacity={OPACITY.booked}
              />
            )}
            {pLen > 0 && (
              <circle
                cx="50"
                cy="50"
                r={r}
                fill="none"
                stroke={baseColour}
                strokeWidth={sw}
                strokeDasharray={`${pLen} ${c}`}
                strokeDashoffset={pOffset}
                opacity={OPACITY.pending}
              />
            )}
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-lg font-bold">{fmt(allowance)}</span>
          </div>
        </div>
      </div>

      <div className="space-y-1 text-xs text-muted-foreground">
        <LegendItem colour={baseColour} opacity={OPACITY.taken} label="Taken" value={fmt(taken)} />
        <LegendItem colour={baseColour} opacity={OPACITY.booked} label="Booked" value={fmt(booked)} />
        <LegendItem colour={baseColour} opacity={OPACITY.pending} label="Pending" value={fmt(pending)} />
        <LegendItem
          colour={BG_REMAINING}
          opacity={1}
          label="Remaining"
          value={fmt(allowance - taken - booked - pending)}
          valueClassName={allowance - taken - booked - pending < 0 ? "text-red-600" : undefined}
        />
      </div>
    </div>
  );
}

function LegendItem({
  colour,
  opacity,
  label,
  value,
  valueClassName,
}: {
  colour: string;
  opacity: number;
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span
        aria-hidden
        className="inline-block h-2 w-2 rounded-full"
        style={{ backgroundColor: colour, opacity }}
      />
      <span>{label}:</span>
      <span className={`font-medium ${valueClassName ?? "text-foreground"}`}>{value}</span>
    </div>
  );
}
