"use client";

// CLE-188 — Member Bookings utility.
//
// Lists every holiday_bookings row for the member regardless of whether a
// covering Holiday Period exists, so admins can find and clean up orphaned
// bookings (typically open-ended sick bookings left behind when a member's
// Holiday Periods are deleted). Delete reuses the existing
// adminDeleteBooking action — that one already does a hard row delete and
// writes a booking.deleted audit entry.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  getMemberBookings,
  adminDeleteBooking,
  type MemberBookingRow,
} from "@/app/(dashboard)/holiday-booking-actions";

interface BookingsCardProps {
  memberId: string;
  memberName: string;
  canManage: boolean;
}

function fmtDate(iso: string | null, open = false): string {
  if (!iso) return open ? "Open" : "—";
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function statusBadgeClasses(status: string): string {
  switch (status) {
    case "approved":
      return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300";
    case "pending":
      return "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300";
    case "rejected":
      return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300";
    case "cancelled":
    case "withdrawn":
      return "bg-muted text-muted-foreground";
    default:
      return "bg-muted text-muted-foreground";
  }
}

export function BookingsCard({ memberId, memberName, canManage }: BookingsCardProps) {
  const router = useRouter();
  const [bookings, setBookings] = useState<MemberBookingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<MemberBookingRow | null>(null);
  const [deleteInFlight, setDeleteInFlight] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    const res = await getMemberBookings(memberId);
    setLoading(false);
    if (!res.success) {
      setError(res.error ?? "Failed to load bookings");
      return;
    }
    setBookings(res.bookings);
  }

  useEffect(() => {
    load();
    // load() is stable for this memberId; reload on memberId change only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberId]);

  async function handleConfirmDelete() {
    if (!deleting) return;
    setDeleteInFlight(true);
    setError(null);
    const res = await adminDeleteBooking(deleting.id);
    setDeleteInFlight(false);
    if (!res.success) {
      setError(res.error ?? "Failed to delete booking");
      return;
    }
    setDeleting(null);
    await load();
    // Refresh the rest of the page in case the holiday widget / planner
    // surfaces this booking elsewhere.
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">All bookings</CardTitle>
        <p className="text-xs text-muted-foreground">
          Every holiday booking on {memberName}, regardless of whether a Holiday Period covers it. Use this to clean up orphaned bookings (e.g. an open-ended sick booking left behind after Holiday Periods were removed).
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && (
          <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
        )}
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : bookings.length === 0 ? (
          <p className="text-sm text-muted-foreground">No bookings.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Start</th>
                  <th className="py-2 pr-3 font-medium">End</th>
                  <th className="py-2 pr-3 font-medium">Reason</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th className="py-2 pr-3 font-medium">Created</th>
                  {canManage && <th className="py-2 pr-3 font-medium text-right" />}
                </tr>
              </thead>
              <tbody>
                {bookings.map((b) => (
                  <tr key={b.id} className="border-b last:border-b-0">
                    <td className="py-2 pr-3 tabular-nums">{fmtDate(b.startDate)}</td>
                    <td className="py-2 pr-3 tabular-nums">{fmtDate(b.endDate, true)}</td>
                    <td className="py-2 pr-3">
                      <span className="inline-flex items-center gap-2">
                        <span
                          aria-hidden
                          className="inline-block h-2.5 w-2.5 rounded-sm"
                          style={{ backgroundColor: b.reasonColour }}
                        />
                        {b.reasonName}
                      </span>
                    </td>
                    <td className="py-2 pr-3">
                      <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${statusBadgeClasses(b.status)}`}>
                        {b.status}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-xs text-muted-foreground tabular-nums">{fmtDateTime(b.createdAt)}</td>
                    {canManage && (
                      <td className="py-2 pr-3 text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Delete booking"
                          onClick={() => setDeleting(b)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>

      <AlertDialog
        open={deleting !== null}
        onOpenChange={(o) => { if (!o && !deleteInFlight) setDeleting(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete booking</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting && (
                <>
                  Permanently delete this {deleting.reasonName} booking
                  ({fmtDate(deleting.startDate)}
                  {deleting.endDate ? ` – ${fmtDate(deleting.endDate)}` : " – Open"})?
                  This bypasses the cancel / withdraw lifecycle and removes the row entirely.
                  The action is audited.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteInFlight}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteInFlight}
              onClick={(e) => { e.preventDefault(); handleConfirmDelete(); }}
            >
              {deleteInFlight ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
