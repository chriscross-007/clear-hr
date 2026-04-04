"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
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
  balance: BalanceSummary | null;
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

const STATUS_BADGE: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  pending: { label: "Pending", variant: "outline" },
  approved: { label: "Approved", variant: "default" },
  rejected: { label: "Rejected", variant: "destructive" },
  cancelled: { label: "Cancelled", variant: "secondary" },
};

export function MyHolidayClient({ balance, bookings, reasons, measurementMode }: MyHolidayClientProps) {
  const router = useRouter();
  const [bookSheetOpen, setBookSheetOpen] = useState(false);
  const [editingBooking, setEditingBooking] = useState<HolidayBookingRow | null>(null);
  const unit = measurementMode === "hours" ? "hours" : "days";

  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">My Holiday</h1>
        <Button onClick={() => setBookSheetOpen(true)}>
          <Plus className="h-4 w-4 mr-1.5" />
          Request Holiday
        </Button>
      </div>

      {/* Balance summary */}
      {balance && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5 mb-6">
          <BalanceCard label="Entitlement" value={balance.entitlement} unit={unit} />
          <BalanceCard label="Pending" value={balance.pending} unit={unit} />
          <BalanceCard label="Booked" value={balance.booked} unit={unit} />
          <BalanceCard label="Taken" value={balance.taken} unit={unit} />
          <BalanceCard label="Remaining" value={balance.remaining} unit={unit} highlight />
        </div>
      )}

      {!balance && (
        <div className="mb-6 rounded-md border p-4 text-sm text-muted-foreground">
          No holiday year record found for the current period.
        </div>
      )}

      {/* Bookings table */}
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
                  <TableHead>Note</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bookings.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                      No bookings yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  bookings.map((b) => {
                    const val = measurementMode === "hours"
                      ? b.hours_deducted
                      : b.days_deducted;
                    const badge = STATUS_BADGE[b.status] ?? STATUS_BADGE.pending;
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
                            <span
                              className="inline-block h-2.5 w-2.5 rounded-full shrink-0"
                              style={{ backgroundColor: b.reason_colour }}
                            />
                            {b.reason_name}
                          </div>
                        </TableCell>
                        <TableCell>{val ?? "—"} {val !== null ? unit : ""}</TableCell>
                        <TableCell>
                          <Badge variant={badge.variant}>{badge.label}</Badge>
                        </TableCell>
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

function BalanceCard({ label, value, unit, highlight }: { label: string; value: number; unit: string; highlight?: boolean }) {
  return (
    <div className={`rounded-lg border p-4 ${highlight ? "bg-primary/5 border-primary/20" : ""}`}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-2xl font-bold tabular-nums ${highlight ? "text-primary" : ""}`}>
        {value} <span className="text-sm font-normal text-muted-foreground">{unit}</span>
      </p>
    </div>
  );
}
