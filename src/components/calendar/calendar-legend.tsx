"use client";

import { useMemo } from "react";
import type { CalendarBooking } from "@/components/holiday-calendar";

/**
 * Single-column colour key listing the absence reasons that exist in
 * `bookings`. Sized at `w-40` so the calendar grid alongside doesn't shift
 * as filters toggle. Caps at 20 visible entries with a "+N more" overflow
 * indicator.
 *
 * Cancelled / rejected bookings are excluded so the key reflects only what
 * the user actually sees on the grid.
 */

const MAX_LEGEND_ITEMS = 20;

export function CalendarLegend({
  bookings,
}: {
  bookings: CalendarBooking[];
}) {
  const items = useMemo(() => {
    const seen = new Map<string, { name: string; colour: string }>();
    for (const b of bookings) {
      if (b.status === "cancelled" || b.status === "rejected") continue;
      if (!seen.has(b.reason_name)) {
        seen.set(b.reason_name, { name: b.reason_name, colour: b.reason_colour });
      }
    }
    return Array.from(seen.values());
  }, [bookings]);

  if (items.length === 0) return null;

  const visible = items.slice(0, MAX_LEGEND_ITEMS);
  const overflow = items.length - visible.length;

  return (
    <div className="w-40 shrink-0">
      <div className="flex flex-col gap-1">
        {visible.map((l) => (
          <div key={l.name} className="flex items-center gap-1.5 text-xs">
            <span className="inline-block h-3 w-3 shrink-0 rounded-sm" style={{ backgroundColor: l.colour }} />
            <span className="truncate">{l.name}</span>
          </div>
        ))}
      </div>
      {overflow > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">+{overflow} more</p>
      )}
    </div>
  );
}
