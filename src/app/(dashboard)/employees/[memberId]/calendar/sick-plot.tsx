interface SickPlotProps {
  /** 7 values, Mon..Sun. */
  data: number[];
  /** Retained for backwards compatibility; the pie uses per-day colours. */
  sickColour?: string;
}

const DAY_NAMES = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];
// One colour per day of the week (Mon..Sun) so each slice is distinguishable.
const SLICE_COLOURS = [
  "#ef4444", // red
  "#f97316", // orange
  "#eab308", // yellow
  "#22c55e", // green
  "#3b82f6", // blue
  "#8b5cf6", // violet
  "#ec4899", // pink
];

// Pie geometry matches HolidayDonut exactly: 92×92 render, 100×100 viewBox,
// centre at 50,50, radius 40. Difference from the donut is fill vs stroke.
const CX = 50;
const CY = 50;
const R = 40;

// Slices smaller than this fraction drop their in-slice percentage text —
// the legend still communicates the count.
const SMALL_SLICE_THRESHOLD = 0.08;

export function SickPlot({ data }: SickPlotProps) {
  const safe = (data.length === 7 ? data : [0, 0, 0, 0, 0, 0, 0]).map((v) => Math.max(0, v));
  const total = safe.reduce((a, b) => a + b, 0);

  if (total === 0) {
    return <p className="py-6 text-center text-xs text-muted-foreground">No sick days</p>;
  }

  type Slice = {
    dow: number;
    colour: string;
    value: number;
    fraction: number;
    pct: number;
    startAngle: number;
    endAngle: number;
  };
  const slices: Slice[] = [];
  let cursor = -Math.PI / 2; // start at 12 o'clock
  for (let i = 0; i < 7; i++) {
    if (safe[i] === 0) continue;
    const fraction = safe[i] / total;
    const startAngle = cursor;
    const endAngle = cursor + fraction * 2 * Math.PI;
    cursor = endAngle;
    slices.push({
      dow: i,
      colour: SLICE_COLOURS[i],
      value: safe[i],
      fraction,
      pct: Math.round(fraction * 100),
      startAngle,
      endAngle,
    });
  }

  const onlyOne = slices.length === 1;

  return (
    <div className="flex flex-row items-center gap-3">
      <div className="flex flex-1 justify-center">
        <div className="relative shrink-0">
          <svg width="92" height="92" viewBox="0 0 100 100">
            {slices.map((s) => {
              const mid = (s.startAngle + s.endAngle) / 2;
              const showPct = s.fraction >= SMALL_SLICE_THRESHOLD;

              // Full-circle slice can't be expressed with a single SVG arc
              // (same start and end point), so render a plain circle.
              const shape = onlyOne ? (
                <circle cx={CX} cy={CY} r={R} fill={s.colour} />
              ) : (
                (() => {
                  const x1 = CX + R * Math.cos(s.startAngle);
                  const y1 = CY + R * Math.sin(s.startAngle);
                  const x2 = CX + R * Math.cos(s.endAngle);
                  const y2 = CY + R * Math.sin(s.endAngle);
                  const largeArc = s.endAngle - s.startAngle > Math.PI ? 1 : 0;
                  const d = `M ${CX} ${CY} L ${x1} ${y1} A ${R} ${R} 0 ${largeArc} 1 ${x2} ${y2} Z`;
                  return <path d={d} fill={s.colour} />;
                })()
              );

              const pctX = CX + R * 0.6 * Math.cos(mid);
              const pctY = CY + R * 0.6 * Math.sin(mid);

              return (
                <g key={s.dow}>
                  {shape}
                  {showPct && (
                    <text
                      x={pctX}
                      y={pctY}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fontSize="10"
                      fontWeight="600"
                      fill="#fff"
                    >
                      {s.pct}%
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        </div>
      </div>

      <div className="space-y-1 text-xs text-muted-foreground">
        {slices.map((s) => (
          <LegendItem
            key={s.dow}
            colour={s.colour}
            label={DAY_NAMES[s.dow]}
            value={String(s.value)}
          />
        ))}
      </div>
    </div>
  );
}

function LegendItem({ colour, label, value }: { colour: string; label: string; value: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: colour }} />
      <span>{label}:</span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  );
}
