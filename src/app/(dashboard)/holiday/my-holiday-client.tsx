"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { BookHolidaySheet } from "./book-holiday-sheet";
import { EditBookingSheet } from "./edit-booking-sheet";
import type {
  HolidayBookingRow,
  BalanceSummary,
  AbsenceReasonOption,
} from "../holiday-booking-actions";

interface MyHolidayClientProps {
  memberId: string;
  balance: BalanceSummary | null;
  nextBalance: BalanceSummary | null;
  bookings: HolidayBookingRow[];
  reasons: AbsenceReasonOption[];
  measurementMode: string;
}

function fmtDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z");
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

function fmtDateRange(start: string, end: string, startHalf: string | null, endHalf: string | null): string {
  const sameDay = start === end;
  let label = sameDay ? fmtDate(start) : `${fmtDate(start)} – ${fmtDate(end)}`;
  if (startHalf) label += ` (${startHalf.toUpperCase()})`;
  if (!sameDay && endHalf) label += ` to (${endHalf.toUpperCase()})`;
  return label;
}

const STATUS_STYLE: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive"; className?: string }> = {
  pending: { label: "Pending", variant: "outline", className: "border-gray-400 text-gray-500 bg-gray-50 dark:bg-gray-900/30" },
  approved: { label: "Approved", variant: "default", className: "bg-green-600 text-white border-green-600" },
  rejected: { label: "Rejected", variant: "destructive" },
  cancelled: { label: "Cancelled", variant: "outline", className: "border-orange-400 text-orange-600 bg-orange-50 dark:bg-orange-900/30" },
};

const STATUS_CHECKBOX_CLASS: Record<string, string> = {
  pending: "data-[state=checked]:bg-gray-500 data-[state=checked]:border-gray-500",
  approved: "data-[state=checked]:bg-green-600 data-[state=checked]:border-green-600",
  rejected: "data-[state=checked]:bg-red-600 data-[state=checked]:border-red-600",
  cancelled: "data-[state=checked]:bg-orange-500 data-[state=checked]:border-orange-500",
};

export function MyHolidayClient({ memberId, balance, nextBalance, bookings, reasons, measurementMode }: MyHolidayClientProps) {
  const router = useRouter();
  const [bookSheetOpen, setBookSheetOpen] = useState(false);
  const [editingBooking, setEditingBooking] = useState<HolidayBookingRow | null>(null);
  const unit = measurementMode === "hours" ? "hours" : "days";

  // Status filter for bookings table
  const storageKey = `holiday-status-filter-${memberId}`;
  const [statusFilters, setStatusFilters] = useState<Record<string, boolean>>({ pending: true, approved: true, rejected: true, cancelled: true });

  useEffect(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) setStatusFilters(JSON.parse(stored));
    } catch { /* ignore */ }
  }, [storageKey]);

  function toggleFilter(status: string) {
    setStatusFilters((prev) => {
      const next = { ...prev, [status]: !prev[status] };
      try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }

  const today = new Date().toISOString().slice(0, 10);
  const futureBookings = bookings.filter((b) =>
    b.start_date >= today && statusFilters[b.status]
  );

  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">My Holiday</h1>
        <Button onClick={() => setBookSheetOpen(true)}>
          <Plus className="h-4 w-4 mr-1.5" />
          Request Holiday
        </Button>
      </div>

      {/* Balance summary — current period */}
      {balance && (
        <div className="mb-6">
          <h2 className="text-sm font-medium text-muted-foreground mb-2">
            {fmtDate(balance.yearStart)} – {fmtDate(balance.yearEnd)}
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <BalanceCard label="Entitlement" value={balance.entitlement} unit={unit} />
            <BalanceCard label="Taken" value={balance.taken} unit={unit} />
            <BalanceCard label="Booked" value={balance.booked} unit={unit} />
            <BalanceCard label="Pending" value={balance.pending} unit={unit} />
            <BalanceCard label="Remaining" value={balance.remaining} unit={unit} highlight negative={balance.remaining < 0} />
            <BalanceCard label="Carry Over" value={balance.carryOverProjected} unit={unit} muted />
          </div>
        </div>
      )}

      {/* Balance summary — next period */}
      {nextBalance && (
        <div className="mb-6">
          <h2 className="text-sm font-medium text-muted-foreground mb-2">
            {fmtDate(nextBalance.yearStart)} – {fmtDate(nextBalance.yearEnd)}
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <BalanceCard label="Entitlement" value={nextBalance.entitlement} unit={unit} />
            <BalanceCard label="Taken" value={nextBalance.taken} unit={unit} />
            <BalanceCard label="Booked" value={nextBalance.booked} unit={unit} />
            <BalanceCard label="Pending" value={nextBalance.pending} unit={unit} />
            <BalanceCard label="Remaining" value={nextBalance.remaining} unit={unit} highlight negative={nextBalance.remaining < 0} />
            <BalanceCard label="Carry Over" value={nextBalance.carryOverProjected} unit={unit} muted />
          </div>
        </div>
      )}

      {!balance && (
        <div className="mb-6 rounded-md border p-4 text-sm text-muted-foreground">
          No active holiday year record found.
        </div>
      )}

      {/* Holiday Bookings — future only with status filters */}
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Holiday Bookings</h2>
        <div className="flex items-center gap-4">
          {(["pending", "approved", "rejected", "cancelled"] as const).map((s) => {
            const count = bookings.filter((b) => b.start_date >= today && b.status === s).length;
            return (
              <label key={s} className="flex items-center gap-1.5 cursor-pointer">
                <Checkbox
                  checked={statusFilters[s] ?? true}
                  onCheckedChange={() => toggleFilter(s)}
                  className={STATUS_CHECKBOX_CLASS[s]}
                />
                <span className="text-sm capitalize">{s} ({count})</span>
              </label>
            );
          })}
        </div>
      </div>
      <div className="flex justify-center w-full">
        <div className="w-auto max-w-[90%] min-w-0">
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Dates</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>{measurementMode === "hours" ? "Hours" : "Days"}</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {futureBookings.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                      No upcoming bookings.
                    </TableCell>
                  </TableRow>
                ) : (
                  futureBookings.map((b) => {
                    const val = measurementMode === "hours" ? b.hours_deducted : b.days_deducted;
                    const badge = STATUS_STYLE[b.status] ?? STATUS_STYLE.pending;
                    const isEditable = b.status === "pending" || b.status === "cancelled";
                    return (
                      <TableRow
                        key={b.id}
                        className={isEditable ? "cursor-pointer hover:bg-muted/50" : ""}
                        onClick={isEditable ? () => setEditingBooking(b) : undefined}
                      >
                        <TableCell className="font-medium">
                          {fmtDateRange(b.start_date, b.end_date, b.start_half, b.end_half)}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <span className="inline-block h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: b.reason_colour }} />
                            {b.reason_name}
                          </div>
                        </TableCell>
                        <TableCell>{val ?? "—"} {val !== null ? unit : ""}</TableCell>
                        <TableCell><Badge variant={badge.variant} className={badge.className}>{badge.label}</Badge></TableCell>
                        <TableCell className="max-w-60 text-muted-foreground">
                          <div className="space-y-0.5">
                            {b.employee_note && <p className="truncate italic">You: {b.employee_note}</p>}
                            {b.approver_note && <p className="truncate">{b.approver_name ?? "Approver"}: {b.approver_note}</p>}
                            {!b.employee_note && !b.approver_note && "—"}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>

      {/* Edit Booking Sheet (pending only) */}
      <EditBookingSheet
        booking={editingBooking}
        open={!!editingBooking}
        onOpenChange={(open) => { if (!open) setEditingBooking(null); }}
        reasons={reasons}
        balance={balance}
        measurementMode={measurementMode}
        onSuccess={() => {
          setEditingBooking(null);
          router.refresh();
        }}
      />

      {/* Book Holiday Sheet */}
      <BookHolidaySheet
        open={bookSheetOpen}
        onOpenChange={setBookSheetOpen}
        reasons={reasons}
        balance={balance}
        measurementMode={measurementMode}
        onSuccess={() => {
          setBookSheetOpen(false);
          router.refresh();
        }}
      />
    </>
  );
}

function BalanceCard({ label, value, unit, highlight, negative, muted }: { label: string; value: number; unit: string; highlight?: boolean; negative?: boolean; muted?: boolean }) {
  return (
    <div className={`rounded-lg border p-4 ${highlight ? (negative ? "bg-destructive/5 border-destructive/20" : "bg-primary/5 border-primary/20") : ""}`}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-2xl font-bold tabular-nums ${negative ? "text-destructive" : highlight ? "text-primary" : muted ? "text-muted-foreground" : ""}`}>
        {value} <span className="text-sm font-normal text-muted-foreground">{unit}</span>
      </p>
    </div>
  );
}
