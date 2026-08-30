"use client";

// CLE-188 — Member Bookings utility.
//
// Lists every holiday_bookings row for the member regardless of whether a
// covering Holiday Period exists, so admins can find and clean up orphaned
// bookings (typically open-ended sick bookings left behind when a member's
// Holiday Periods are deleted). Delete reuses the existing
// adminDeleteBooking action — that one already does a hard row delete and
// writes a booking.deleted audit entry.

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2, ChevronLeft, ChevronRight } from "lucide-react";
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

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;
type PageSize = (typeof PAGE_SIZE_OPTIONS)[number] | "all";

export function BookingsCard({ memberId, memberName, canManage }: BookingsCardProps) {
  const router = useRouter();
  const [bookings, setBookings] = useState<MemberBookingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<MemberBookingRow | null>(null);
  const [deleteInFlight, setDeleteInFlight] = useState(false);
  const [pageSize, setPageSize] = useState<PageSize>(10);
  const [page, setPage] = useState(0);

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

  // Client-side pagination. Bookings list is typically small (< a few
  // hundred) so paging in-memory is fine; can shift to server-side
  // limit/offset if any tenant grows past ~1000 bookings per member.
  const totalCount = bookings.length;
  const effectivePageSize = pageSize === "all" ? Math.max(totalCount, 1) : pageSize;
  const pageCount = Math.max(1, Math.ceil(totalCount / effectivePageSize));
  const clampedPage = Math.min(page, pageCount - 1);
  const pageStart = clampedPage * effectivePageSize;
  const pageEnd = Math.min(pageStart + effectivePageSize, totalCount);
  const pageRows = useMemo(
    () => bookings.slice(pageStart, pageEnd),
    [bookings, pageStart, pageEnd],
  );
  // Reset to first page when the page size changes.
  useEffect(() => {
    setPage(0);
  }, [pageSize]);

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
                {pageRows.map((b) => (
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
            {/* Pagination controls */}
            <div className="mt-3 flex items-center justify-between gap-3 text-xs text-muted-foreground">
              <div className="flex items-center gap-2">
                <span>Show</span>
                <select
                  className="h-7 rounded-md border border-input bg-background px-2 text-xs"
                  value={String(pageSize)}
                  onChange={(e) => {
                    const v = e.target.value;
                    setPageSize(v === "all" ? "all" : (Number(v) as PageSize));
                  }}
                  aria-label="Page size"
                >
                  {PAGE_SIZE_OPTIONS.map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                  <option value="all">All</option>
                </select>
                <span>per page</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="tabular-nums">
                  {totalCount === 0 ? "0" : `${pageStart + 1}–${pageEnd}`} of {totalCount}
                </span>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-7 w-7"
                  disabled={clampedPage === 0}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  aria-label="Previous page"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-7 w-7"
                  disabled={clampedPage >= pageCount - 1}
                  onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                  aria-label="Next page"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
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
