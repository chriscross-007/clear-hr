interface SickDonutProps {
  sickDays: number;
  workingDays: number;
  /** Sick Paid absence type colour. */
  baseColour?: string;
}

const BG_REMAINING = "#e5e7eb"; // gray-200 — same as holiday donut's empty ring
const DEFAULT_BASE = "#ef4444"; // red-500

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

export function SickDonut({ sickDays, workingDays, baseColour = DEFAULT_BASE }: SickDonutProps) {
  // Cap at 1 — over-100% would otherwise wrap the segment past the start.
  const ratio = workingDays > 0 ? Math.min(1, sickDays / workingDays) : 0;
  const percentage = workingDays > 0 ? Math.round((sickDays / workingDays) * 100) : 0;

  // Geometry mirrors holiday-donut.tsx so the two donuts read as a pair.
  const r = 40;
  const c = 2 * Math.PI * r;
  const sw = 14;
  const sickLen = ratio * c;

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
              stroke={BG_REMAINING}
              strokeWidth={sw}
            />
            {sickLen > 0 && (
              <circle
                cx="50"
                cy="50"
                r={r}
                fill="none"
                stroke={baseColour}
                strokeWidth={sw}
                strokeDasharray={`${sickLen} ${c}`}
                strokeDashoffset={0}
              />
            )}
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-lg font-bold">{percentage}%</span>
          </div>
        </div>
      </div>

      <div className="space-y-1 text-xs text-muted-foreground">
        <LegendItem colour={baseColour} label={`${fmt(sickDays)} days sick`} />
        <LegendItem colour={BG_REMAINING} label={`${fmt(workingDays)} working days`} />
      </div>
    </div>
  );
}

function LegendItem({ colour, label }: { colour: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: colour }} />
      <span>{label}</span>
    </div>
  );
}
