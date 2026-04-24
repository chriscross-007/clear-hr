import { CalendarDays, HeartPulse, TrendingUp, BarChart3 } from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import { HolidayDonut } from "./holiday-donut";
import { SickDonut } from "./sick-donut";
import { SickPlot } from "./sick-plot";

export type HolidayStats = {
  allowance: number;
  taken: number;
  booked: number;
  pending: number;
};

export type SickPlotStats = {
  /** 7 values, Mon..Sun. */
  byDow: number[];
  colour: string;
};

export type SickStats = {
  sickDays: number;
  workingDays: number;
  colour: string;
};

interface PlannerDashboardCardProps {
  title: ReactNode;
  Icon: ComponentType<{ className?: string }>;
  children?: ReactNode;
}

function PlannerDashboardCard({ title, Icon, children }: PlannerDashboardCardProps) {
  return (
    <div className="rounded-lg border border-gray-200 p-3">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <h3 className="min-w-0 flex-1 text-base font-bold">{title}</h3>
        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
      </div>
      <div className="flex min-h-[80px] items-center justify-center">
        {children ?? <p className="text-2xl font-bold text-muted-foreground">—</p>}
      </div>
    </div>
  );
}

function fmtShortDate(ymd: string): string {
  const d = new Date(ymd + "T00:00:00Z");
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function bradfordColourClass(value: number): string {
  // Common Bradford Factor thresholds used in HR practice.
  if (value >= 400) return "text-red-600";
  if (value >= 125) return "text-orange-600";
  if (value >= 50) return "text-amber-600";
  return "text-green-600";
}

const BRADFORD_TIERS: { dot: string; label: string; matches: (v: number) => boolean }[] = [
  { dot: "bg-green-600",  label: "0 – 49",    matches: (v) => v < 50 },
  { dot: "bg-amber-600",  label: "50 – 124",  matches: (v) => v >= 50 && v < 125 },
  { dot: "bg-orange-600", label: "125 – 399", matches: (v) => v >= 125 && v < 400 },
  { dot: "bg-red-600",    label: "400+",      matches: (v) => v >= 400 },
];

function BradfordCardBody({ value }: { value: number }) {
  return (
    <div className="flex flex-row items-center gap-3">
      <div className="flex flex-1 flex-col items-center justify-center">
        <span className={`text-4xl font-bold ${bradfordColourClass(value)}`}>{value}</span>
        <span className="text-xs text-muted-foreground">Points</span>
      </div>
      <div className="space-y-1 text-xs text-muted-foreground">
        {BRADFORD_TIERS.map((t) => {
          const active = t.matches(value);
          return (
            <div key={t.label} className="flex items-center gap-1.5">
              <span aria-hidden className={`inline-block h-2 w-2 rounded-full ${t.dot}`} />
              <span className={active ? "font-medium text-foreground" : undefined}>{t.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function PlannerDashboard({
  holidayStats,
  holidayBaseColour,
  holidayPeriodStart,
  holidayPeriodEnd,
  sick,
  sickPlot,
  bradfordFactor,
}: {
  holidayStats?: HolidayStats;
  holidayBaseColour?: string;
  holidayPeriodStart?: string;
  holidayPeriodEnd?: string;
  sick?: SickStats;
  sickPlot?: SickPlotStats;
  bradfordFactor?: number;
}) {
  const subtitle = (text: string) => (
    <span className="text-xs font-normal text-muted-foreground">{text}</span>
  );
  const last365 = subtitle("(last 365 days)");

  const holidaysTitle = holidayPeriodStart && holidayPeriodEnd ? (
    <span>
      Holidays{" "}
      {subtitle(`(${fmtShortDate(holidayPeriodStart)} – ${fmtShortDate(holidayPeriodEnd)})`)}
    </span>
  ) : (
    "Holidays"
  );
  const sickTitle = <span>Sick {last365}</span>;
  const bradfordTitle = <span>Bradford Factor {last365}</span>;
  const sickPlotTitle = <span>Sick Plot {last365}</span>;

  // Full-width grid so the dashboard tracks the calendar+legend row beneath it.
  return (
    <div className="mb-3 grid w-full max-w-full grid-cols-2 gap-8 md:grid-cols-4">
      <PlannerDashboardCard title={holidaysTitle} Icon={CalendarDays}>
        {holidayStats ? <HolidayDonut {...holidayStats} baseColour={holidayBaseColour} /> : undefined}
      </PlannerDashboardCard>
      <PlannerDashboardCard title={sickTitle} Icon={HeartPulse}>
        {sick ? <SickDonut sickDays={sick.sickDays} workingDays={sick.workingDays} baseColour={sick.colour} /> : undefined}
      </PlannerDashboardCard>
      <PlannerDashboardCard title={bradfordTitle} Icon={TrendingUp}>
        {bradfordFactor !== undefined ? <BradfordCardBody value={bradfordFactor} /> : undefined}
      </PlannerDashboardCard>
      <PlannerDashboardCard title={sickPlotTitle} Icon={BarChart3}>
        {sickPlot ? <SickPlot data={sickPlot.byDow} sickColour={sickPlot.colour} /> : undefined}
      </PlannerDashboardCard>
    </div>
  );
}
