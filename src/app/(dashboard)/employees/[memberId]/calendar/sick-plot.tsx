interface SickPlotProps {
  /** 7 values, Mon..Sun. */
  data: number[];
  sickColour?: string;
}

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DEFAULT_COLOUR = "#ef4444";

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

export function SickPlot({ data, sickColour = DEFAULT_COLOUR }: SickPlotProps) {
  const safe = (data.length === 7 ? data : [0, 0, 0, 0, 0, 0, 0]).map((v) => Math.max(0, v));
  const maxVal = Math.max(...safe);

  if (maxVal === 0) {
    return (
      <p className="py-6 text-center text-xs text-muted-foreground">No sick days</p>
    );
  }

  // Round the y-axis up to a sensible whole number so gridlines look clean.
  const yMax = Math.max(1, Math.ceil(maxVal));

  // SVG layout — sized to match the shorter dashboard row.
  const width = 200;
  const height = 70;
  const padLeft = 18;
  const padBottom = 12;
  const padTop = 3;
  const padRight = 4;

  const chartW = width - padLeft - padRight;
  const chartH = height - padTop - padBottom;
  const slot = chartW / 7;
  const barW = slot * 0.7;

  // Two interior gridlines + the baseline (3 horizontal lines total)
  const ticks = [0, 0.5, 1];

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" preserveAspectRatio="xMidYMid meet">
      {/* Y-axis gridlines + labels */}
      {ticks.map((t) => {
        const y = padTop + chartH - t * chartH;
        return (
          <g key={t}>
            <line
              x1={padLeft}
              y1={y}
              x2={width - padRight}
              y2={y}
              stroke="#e5e7eb"
              strokeWidth={0.5}
            />
            <text
              x={padLeft - 2}
              y={y + 3}
              textAnchor="end"
              fontSize="9"
              fill="#9ca3af"
            >
              {fmt(t * yMax)}
            </text>
          </g>
        );
      })}

      {/* Bars + day labels */}
      {safe.map((v, i) => {
        const slotX = padLeft + i * slot;
        const barX = slotX + (slot - barW) / 2;
        const barH = (v / yMax) * chartH;
        const barY = padTop + chartH - barH;
        return (
          <g key={i}>
            {v > 0 && (
              <rect
                x={barX}
                y={barY}
                width={barW}
                height={barH}
                fill={sickColour}
                rx={1}
              >
                <title>{`${DAY_LABELS[i]}: ${fmt(v)}`}</title>
              </rect>
            )}
            <text
              x={slotX + slot / 2}
              y={height - 4}
              textAnchor="middle"
              fontSize="9"
              fill="#6b7280"
            >
              {DAY_LABELS[i]}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
