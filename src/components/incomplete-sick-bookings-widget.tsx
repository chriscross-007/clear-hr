"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, ChevronDown, ChevronUp } from "lucide-react";
import { CompletionStatusBadge } from "@/components/completion-status-badge";
import { getIncompleteSickBookings } from "@/app/(dashboard)/sick-booking-actions";
import type { IncompleteSickBooking } from "@/app/(dashboard)/sick-booking-types";

function fmtDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z");
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

export function IncompleteSickBookingsWidget() {
  const [bookings, setBookings] = useState<IncompleteSickBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await getIncompleteSickBookings();
      if (cancelled) return;
      if (!res.success) {
        setError(res.error ?? "Could not load sick bookings");
      } else {
        setBookings(res.bookings);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  if (!loading && bookings.length === 0 && !error) return null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-500" />
          <CardTitle className="text-sm font-medium">
            Sick Bookings Needing Attention
            {!loading && bookings.length > 0 && (
              <span className="ml-1.5 text-muted-foreground">({bookings.length})</span>
            )}
          </CardTitle>
        </div>
        {bookings.length > 0 && (
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className="text-muted-foreground hover:text-foreground"
          >
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        )}
      </CardHeader>
      <CardContent>
        {loading && <p className="text-sm text-muted-foreground">Loading...</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}
        {!loading && !error && bookings.length === 0 && (
          <p className="text-sm text-muted-foreground">All sick bookings are up to date.</p>
        )}
        {expanded && bookings.length > 0 && (
          <div className="space-y-2">
            {bookings.map((b) => (
              <Link
                key={b.booking_id}
                href={`/members/${b.member_id}/calendar?bookingId=${b.booking_id}`}
                className="flex items-center justify-between rounded-md border px-3 py-2 text-sm hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span
                    aria-hidden
                    className="inline-block h-2.5 w-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: b.reason_colour }}
                  />
                  <div className="min-w-0">
                    <p className="font-medium truncate">{b.member_name} — {b.reason_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {fmtDate(b.start_date)}
                      {b.end_date ? ` – ${fmtDate(b.end_date)}` : " – Open"}
                    </p>
                  </div>
                </div>
                <CompletionStatusBadge status={b.completion_status} />
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
