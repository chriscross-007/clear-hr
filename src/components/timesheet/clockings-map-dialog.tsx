"use client";

import { useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import { ChevronLeft, ChevronRight, MapPin, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getClockingsWithLocation, type MapClocking } from "@/app/(dashboard)/timesheets/actions";

// Load Leaflet map without SSR
const ClockingsMapInner = dynamic(
  () => import("./clockings-map-inner").then((m) => m.ClockingsMapInner),
  { ssr: false, loading: () => <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading map…</div> }
);

// ---- helpers -----------------------------------------------------------

function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function formatDateLabel(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

function typeColor(c: MapClocking): string {
  const t = (c.inferredType ?? c.rawType ?? "").toUpperCase();
  if (t === "IN" || t === "BSTART") return "text-green-600 dark:text-green-400";
  if (t === "OUT") return "text-red-600 dark:text-red-400";
  if (t.includes("BRK_OUT") || t.includes("BREAKOUT")) return "text-amber-600 dark:text-amber-400";
  if (t.includes("BRK_IN")  || t.includes("BREAKIN"))  return "text-blue-600 dark:text-blue-400";
  return "text-muted-foreground";
}

// ---- component ---------------------------------------------------------

interface ClockingsMapDialogProps {
  memberId:  string;
  weekStart: string;
  weekEnd:   string;
  onClose:   () => void;
}

export function ClockingsMapDialog({ memberId, weekStart, weekEnd, onClose }: ClockingsMapDialogProps) {
  // Default to today if within the week, otherwise weekStart
  const todayYmd = new Date().toISOString().slice(0, 10);
  const defaultDate = todayYmd >= weekStart && todayYmd <= weekEnd ? todayYmd : weekStart;

  const [date, setDate] = useState(defaultDate);
  const [clockings, setClockings] = useState<MapClocking[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchDay = useCallback(async (d: string) => {
    setLoading(true);
    const result = await getClockingsWithLocation(memberId, d);
    setClockings(result.clockings);
    setLoading(false);
  }, [memberId]);

  useEffect(() => { fetchDay(date); }, [date, fetchDay]);

  const withCoords = clockings.filter((c) => c.latitude !== null && c.longitude !== null);

  return (
    // Backdrop
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="relative flex flex-col bg-background border border-border rounded-xl shadow-2xl w-full max-w-3xl h-[80vh] overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <MapPin className="h-4 w-4 text-muted-foreground" />
            <span className="font-semibold text-sm">Clocking Locations</span>
          </div>

          {/* Date navigation */}
          <div className="flex items-center gap-1">
            <Button
              variant="ghost" size="icon"
              onClick={() => setDate((d) => addDays(d, -1))}
              className="h-7 w-7"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm font-medium min-w-44 text-center tabular-nums">
              {formatDateLabel(date)}
            </span>
            <Button
              variant="ghost" size="icon"
              onClick={() => setDate((d) => addDays(d, 1))}
              className="h-7 w-7"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          <Button variant="ghost" size="icon" onClick={onClose} className="h-7 w-7">
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Map area */}
        <div className="flex-1 min-h-0 relative">
          {loading ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Loading…
            </div>
          ) : (
            <ClockingsMapInner clockings={clockings} />
          )}

          {/* No-coords notice */}
          {!loading && clockings.length > 0 && withCoords.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="bg-background/90 rounded-lg border border-border px-6 py-4 text-center shadow">
                <MapPin className="h-8 w-8 mx-auto mb-2 text-muted-foreground/40" />
                <p className="text-sm font-medium">No location data</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {clockings.length} clocking{clockings.length !== 1 ? "s" : ""} found, but none have GPS coordinates.
                </p>
              </div>
            </div>
          )}

          {!loading && clockings.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center">
              <p className="text-sm text-muted-foreground">No clockings on this date.</p>
            </div>
          )}
        </div>

        {/* Footer legend */}
        {!loading && clockings.length > 0 && (
          <div className="px-4 py-2 border-t border-border bg-muted/30 shrink-0">
            <ol className="flex flex-wrap gap-x-5 gap-y-1">
              {clockings.map((c, i) => (
                <li key={c.id} className="flex items-center gap-1.5 text-xs">
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-muted text-[10px] font-bold tabular-nums shrink-0">
                    {i + 1}
                  </span>
                  <span className="tabular-nums">{c.clockedAt.slice(11, 16)} UTC</span>
                  <span className={`font-medium ${typeColor(c)}`}>
                    {(c.inferredType ?? c.rawType ?? "?").toUpperCase()}
                  </span>
                  {c.latitude === null && (
                    <span className="text-muted-foreground/50">(no GPS)</span>
                  )}
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </div>
  );
}
