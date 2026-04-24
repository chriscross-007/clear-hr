"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2, Plus, X } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { changeEmployeeHolidayProfile, updateHolidayYearRecord, deleteHolidayYearRecord, cancelBookingAsAdmin } from "../../actions";
import { assignWorkProfile } from "../../../work-profile-actions";

type HolidayYearRecord = {
  id: string;
  absence_type_id: string;
  absence_profile_id: string | null;
  year_start: string;
  year_end: string;
  base_amount: number;
  adjustment: number;
  carried_over: number;
  borrow_forward: number;
  pro_rata_amount: number | null;
};

type AbsenceProfileRow = {
  id: string;
  name: string;
  allowance: number;
  measurement_mode: string;
  absence_type_id: string;
  carry_over_max: number | null;
};

type MemberBooking = {
  id: string;
  start_date: string;
  end_date: string;
  start_half: string | null;
  end_half: string | null;
  days_deducted: number | null;
  status: string;
  reason_name: string;
  reason_colour: string;
};

interface EmployeeHolidayClientProps {
  memberId: string;
  memberName: string;
  currentProfileName: string;
  currentProfileId: string | null;
  measurementMode: string;
  records: HolidayYearRecord[];
  absenceProfiles: AbsenceProfileRow[];
  bookingAggregates: Record<string, { booked: number; taken: number }>;
  profileMap: Record<string, string>;
  profileAllowanceMap: Record<string, number>;
  carryOverMaxMap: Record<string, number | null>;
  workProfileAssignments: { id: string; work_profile_id: string; work_profile_name: string; effective_from: string }[];
  orgWorkProfiles: { id: string; name: string }[];
  orgDefaultWorkProfileId: string | null;
  memberBookings: MemberBooking[];
}

function fmtDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z");
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

function yearLabel(yearStart: string): string {
  const d = new Date(yearStart + "T00:00:00Z");
  const startYear = d.getUTCFullYear();
  const endYear = startYear + 1;
  return `${startYear}/${String(endYear).slice(2)}`;
}

function getStatus(yearStart: string, yearEnd: string): { label: string; variant: "default" | "secondary" | "outline" } {
  const today = new Date().toISOString().slice(0, 10);
  if (yearEnd < today) return { label: "Past", variant: "secondary" };
  if (yearStart > today) return { label: "Future", variant: "outline" };
  return { label: "Current", variant: "default" };
}

export function EmployeeHolidayClient({
  memberId,
  memberName,
  currentProfileName,
  currentProfileId,
  measurementMode,
  records,
  absenceProfiles,
  bookingAggregates,
  profileMap,
  profileAllowanceMap,
  carryOverMaxMap,
  workProfileAssignments,
  orgWorkProfiles,
  orgDefaultWorkProfileId,
  memberBookings,
}: EmployeeHolidayClientProps) {
  const router = useRouter();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [selectedProfileId, setSelectedProfileId] = useState(currentProfileId ?? absenceProfiles[0]?.id ?? "");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [backdateConfirmOpen, setBackdateConfirmOpen] = useState(false);
  // Edit record state
  const [editingRecord, setEditingRecord] = useState<HolidayYearRecord | null>(null);
  const [editYearStart, setEditYearStart] = useState("");
  const [editYearEnd, setEditYearEnd] = useState("");
  const [editBaseAmount, setEditBaseAmount] = useState("");
  const [editAdjustment, setEditAdjustment] = useState("");
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Cancel booking state
  const [cancellingBooking, setCancellingBooking] = useState<MemberBooking | null>(null);
  const [cancelBookingLoading, setCancelBookingLoading] = useState(false);

  const [wpSheetOpen, setWpSheetOpen] = useState(false);
  const [wpProfileId, setWpProfileId] = useState("");
  const [wpEffectiveFrom, setWpEffectiveFrom] = useState("");
  const [wpLoading, setWpLoading] = useState(false);
  const [wpError, setWpError] = useState<string | null>(null);
  const [wpBackdateOpen, setWpBackdateOpen] = useState(false);

  const unit = measurementMode === "hours" ? "hours" : "days";
  const today = new Date().toISOString().slice(0, 10);

  function handleWpSaveClick() {
    if (!wpProfileId || !wpEffectiveFrom) return;
    if (wpEffectiveFrom < today) {
      setWpBackdateOpen(true);
    } else {
      doWpSave();
    }
  }

  async function doWpSave() {
    setWpLoading(true);
    setWpError(null);
    const result = await assignWorkProfile(memberId, wpProfileId, wpEffectiveFrom);
    setWpLoading(false);
    if (!result.success) { setWpError(result.error ?? "An error occurred"); return; }
    setWpSheetOpen(false);
    router.refresh();
  }

  function openEditRecord(rec: HolidayYearRecord) {
    setEditingRecord(rec);
    setEditYearStart(rec.year_start);
    setEditYearEnd(rec.year_end);
    setEditBaseAmount(String(rec.base_amount));
    setEditAdjustment(String(rec.adjustment));
    setEditError(null);
  }

  async function handleSaveRecord() {
    if (!editingRecord) return;
    setEditLoading(true);
    setEditError(null);
    const result = await updateHolidayYearRecord(editingRecord.id, {
      year_start: editYearStart,
      year_end: editYearEnd,
      base_amount: Number(editBaseAmount),
      adjustment: Number(editAdjustment),
    });
    setEditLoading(false);
    if (!result.success) { setEditError(result.error ?? "An error occurred"); return; }
    setEditingRecord(null);
    router.refresh();
  }

  async function handleDeleteRecord() {
    if (!editingRecord) return;
    setDeleteLoading(true);
    const result = await deleteHolidayYearRecord(editingRecord.id);
    setDeleteLoading(false);
    if (!result.success) { setEditError(result.error ?? "An error occurred"); return; }
    setDeleteConfirmOpen(false);
    setEditingRecord(null);
    router.refresh();
  }

  async function handleCancelBooking() {
    if (!cancellingBooking) return;
    setCancelBookingLoading(true);
    const result = await cancelBookingAsAdmin(cancellingBooking.id);
    setCancelBookingLoading(false);
    if (result.success) {
      setCancellingBooking(null);
      router.refresh();
    }
  }

  function handleSaveClick() {
    if (!selectedProfileId || !effectiveDate) return;
    if (effectiveDate < today) {
      setBackdateConfirmOpen(true);
    } else {
      doSave();
    }
  }

  async function doSave() {
    setLoading(true);
    setError(null);
    const result = await changeEmployeeHolidayProfile(memberId, selectedProfileId, effectiveDate);
    setLoading(false);

    if (!result.success) {
      setError(result.error ?? "An error occurred");
      return;
    }

    setSheetOpen(false);
    router.refresh();
  }

  return (
    <>
      {/* Back link + header */}
      <div className="mb-6">
        <Link href="/employees" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-2">
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to directory
        </Link>
        <div>
          <h1 className="text-2xl font-bold">{memberName}</h1>
          <p className="text-sm text-muted-foreground">Current Holiday Profile: {currentProfileName}</p>
        </div>
      </div>

      {/* Holiday Year Records */}
      <div className="flex justify-center w-full">
        <div className="w-auto max-w-[90%] min-w-0">
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Year</TableHead>
                  <TableHead>Profile</TableHead>
                  <TableHead>Start Date</TableHead>
                  <TableHead>End Date</TableHead>
                  <TableHead>Allowance</TableHead>
                  <TableHead>Brought Forward</TableHead>
                  <TableHead>Adjustment</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead>Booked</TableHead>
                  <TableHead>Taken</TableHead>
                  <TableHead>Balance</TableHead>
                  <TableHead>Max C/O</TableHead>
                  <TableHead>Carried Over</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {records.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={13} className="h-24 text-center text-muted-foreground">
                      No holiday year records found.
                    </TableCell>
                  </TableRow>
                ) : (
                  (() => {
                    // Pre-compute carry-over for each record
                    // Always compute dynamically — stored carried_over is only set by year-end processing
                    const carryOvers: number[] = [];
                    for (let i = 0; i < records.length; i++) {
                      const rec = records[i];
                      const broughtFwd = i > 0 ? carryOvers[i - 1] : rec.carried_over;
                      const allowance = (rec.pro_rata_amount && rec.pro_rata_amount > 0) ? rec.pro_rata_amount : rec.base_amount;
                      const total = allowance + broughtFwd + rec.adjustment;
                      const agg = bookingAggregates[rec.id] ?? { booked: 0, taken: 0 };
                      const balance = total - agg.booked - agg.taken;
                      const cap = carryOverMaxMap[rec.id];
                      const co = (cap === null || cap === undefined)
                        ? Math.max(balance, 0)
                        : Math.min(Math.max(balance, 0), cap);
                      carryOvers.push(co);
                    }

                    return records.map((rec, idx) => {
                      const status = getStatus(rec.year_start, rec.year_end);
                      const broughtForward = idx > 0 ? carryOvers[idx - 1] : rec.carried_over;
                      const allowance = (rec.pro_rata_amount && rec.pro_rata_amount > 0) ? rec.pro_rata_amount : rec.base_amount;
                      const total = allowance + broughtForward + rec.adjustment;
                      const agg = bookingAggregates[rec.id] ?? { booked: 0, taken: 0 };
                      const balance = total - agg.booked - agg.taken;
                      const carriedOver = carryOvers[idx];
                      const recProfileName = profileMap[rec.id] ?? "—";
                      return (
                        <TableRow key={rec.id} className="cursor-pointer hover:bg-muted/50" onClick={() => openEditRecord(rec)}>
                          <TableCell className="font-medium">{yearLabel(rec.year_start)}</TableCell>
                          <TableCell>{recProfileName}</TableCell>
                          <TableCell>{fmtDate(rec.year_start)}</TableCell>
                          <TableCell>{fmtDate(rec.year_end)}</TableCell>
                          <TableCell>{allowance} {unit}</TableCell>
                          <TableCell>{broughtForward} {unit}</TableCell>
                          <TableCell>{rec.adjustment > 0 ? `+${rec.adjustment}` : rec.adjustment} {unit}</TableCell>
                          <TableCell className="font-medium">{total} {unit}</TableCell>
                          <TableCell>{agg.booked} {unit}</TableCell>
                          <TableCell>{agg.taken} {unit}</TableCell>
                          <TableCell className={balance < 0 ? "text-destructive font-medium" : "font-medium"}>{balance} {unit}</TableCell>
                          <TableCell className="text-muted-foreground">
                            {(() => {
                              const cap = carryOverMaxMap[rec.id];
                              return (cap === null || cap === undefined) ? "No limit" : `${cap} ${unit}`;
                            })()}
                          </TableCell>
                          <TableCell>
                            {status.label === "Past" ? (
                              <>{carriedOver} {unit}</>
                            ) : (
                              <span className="text-muted-foreground" title="Projected carry-over estimate">
                                {carriedOver} {unit}
                              </span>
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge variant={status.variant}>{status.label}</Badge>
                          </TableCell>
                        </TableRow>
                      );
                    });
                  })()
                )}
              </TableBody>
            </Table>
          </div>
          <div className="flex justify-end mt-2">
            <Button variant="outline" size="icon" onClick={() => {
              setSelectedProfileId(currentProfileId ?? absenceProfiles[0]?.id ?? "");
              setEffectiveDate("");
              setError(null);
              setSheetOpen(true);
            }} title="Add holiday year record">
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Change Profile Sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Change Holiday Profile</SheetTitle>
            <SheetDescription>
              Select a new holiday profile and the date it takes effect.
            </SheetDescription>
          </SheetHeader>

          <div className="flex flex-col gap-5 px-4">
            <div className="flex flex-col gap-1.5">
              <Label>Holiday Profile</Label>
              <select
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={selectedProfileId}
                onChange={(e) => setSelectedProfileId(e.target.value)}
              >
                {absenceProfiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.allowance} {p.measurement_mode})
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="effective-date">Effective Date</Label>
              <Input
                id="effective-date"
                type="date"
                value={effectiveDate}
                onChange={(e) => setEffectiveDate(e.target.value)}
                required
              />
              {effectiveDate && effectiveDate < today && (
                <p className="text-xs text-amber-600">This date is in the past — you will be asked to confirm.</p>
              )}
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>

          <SheetFooter>
            <Button variant="outline" onClick={() => setSheetOpen(false)} disabled={loading}>
              Cancel
            </Button>
            <Button
              onClick={handleSaveClick}
              disabled={loading || !selectedProfileId || !effectiveDate}
            >
              {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save Changes
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Backdate confirmation */}
      <AlertDialog open={backdateConfirmOpen} onOpenChange={setBackdateConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Backdate Profile Change?</AlertDialogTitle>
            <AlertDialogDescription>
              The effective date you&apos;ve selected is in the past. Are you sure you want to backdate this profile change to {effectiveDate ? fmtDate(effectiveDate) : ""}?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setBackdateConfirmOpen(false); doSave(); }}>
              Yes, backdate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Edit Record Sheet */}
      <Sheet open={!!editingRecord} onOpenChange={(open) => { if (!open) setEditingRecord(null); }}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Edit Holiday Year Record</SheetTitle>
            <SheetDescription>Update the dates and entitlement values for this record.</SheetDescription>
          </SheetHeader>
          <div className="max-h-[60vh] overflow-y-auto space-y-4 px-4 pr-5">
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="edit-rec-start">Year Start</Label>
                <Input id="edit-rec-start" type="date" value={editYearStart} onChange={(e) => setEditYearStart(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="edit-rec-end">Year End</Label>
                <Input id="edit-rec-end" type="date" value={editYearEnd} onChange={(e) => setEditYearEnd(e.target.value)} />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-rec-base">Base Amount ({measurementMode})</Label>
              <Input id="edit-rec-base" type="number" min={0} step={0.5} value={editBaseAmount} onChange={(e) => setEditBaseAmount(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-rec-adj">Adjustment ({measurementMode})</Label>
              <Input id="edit-rec-adj" type="number" step={0.5} value={editAdjustment} onChange={(e) => setEditAdjustment(e.target.value)} />
            </div>
            {editError && <p className="text-sm text-destructive">{editError}</p>}
          </div>
          <SheetFooter className="flex !justify-between">
            <Button variant="destructive" size="sm" onClick={() => setDeleteConfirmOpen(true)} disabled={editLoading}>
              Delete Record
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setEditingRecord(null)} disabled={editLoading}>Cancel</Button>
              <Button onClick={handleSaveRecord} disabled={editLoading || !editYearStart || !editYearEnd}>
                {editLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Save Changes
              </Button>
            </div>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Delete Record Confirmation */}
      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Holiday Year Record</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this record? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteLoading}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteLoading}
              onClick={(e) => { e.preventDefault(); handleDeleteRecord(); }}
            >
              {deleteLoading ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bookings section */}
      {memberBookings.length > 0 && (
        <div className="mt-8 mb-6">
          <h2 className="text-lg font-semibold mb-4">Holiday Bookings</h2>
          <div className="flex justify-center w-full">
            <div className="w-auto max-w-[90%] min-w-0">
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Dates</TableHead>
                      <TableHead>Reason</TableHead>
                      <TableHead>Days</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="w-16" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {memberBookings.map((b) => {
                      const sameDay = b.start_date === b.end_date;
                      let dateLabel = sameDay ? fmtDate(b.start_date) : `${fmtDate(b.start_date)} – ${fmtDate(b.end_date)}`;
                      if (b.start_half) dateLabel += ` (${b.start_half.toUpperCase()})`;
                      if (!sameDay && b.end_half) dateLabel += ` to (${b.end_half.toUpperCase()})`;
                      const canCancel = b.status === "pending" || b.status === "approved";
                      return (
                        <TableRow key={b.id}>
                          <TableCell className="font-medium">{dateLabel}</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <span className="inline-block h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: b.reason_colour }} />
                              {b.reason_name}
                            </div>
                          </TableCell>
                          <TableCell>{b.days_deducted ?? "—"} {unit}</TableCell>
                          <TableCell>
                            <Badge variant={
                              b.status === "approved" ? "default" :
                              b.status === "pending" ? "outline" :
                              b.status === "rejected" ? "destructive" : "secondary"
                            }>
                              {b.status.charAt(0).toUpperCase() + b.status.slice(1)}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {canCancel && (
                              <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="text-destructive hover:text-destructive"
                                  onClick={() => setCancellingBooking(b)}
                                >
                                  <X className="h-3.5 w-3.5 mr-1" />
                                  Cancel
                                </Button>
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Cancel booking confirmation */}
      <AlertDialog open={!!cancellingBooking} onOpenChange={(open) => { if (!open) setCancellingBooking(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel Holiday Booking</AlertDialogTitle>
            <AlertDialogDescription>
              {cancellingBooking && (
                <>
                  Are you sure you want to cancel this {cancellingBooking.status} booking for{" "}
                  <strong>{fmtDate(cancellingBooking.start_date)}</strong>
                  {cancellingBooking.start_date !== cancellingBooking.end_date && <> – <strong>{fmtDate(cancellingBooking.end_date)}</strong></>}
                  {" "}({cancellingBooking.reason_name})? The days will be returned to the employee&apos;s balance.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancelBookingLoading}>Keep Booking</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={cancelBookingLoading}
              onClick={(e) => { e.preventDefault(); handleCancelBooking(); }}
            >
              {cancelBookingLoading ? "Cancelling..." : "Cancel Booking"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Working Pattern section */}
      <div className="mt-8 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Working Pattern</h2>
          <Button variant="outline" size="sm" onClick={() => {
            // Default selection priority:
            //   1. Employee's most recent existing assignment (workProfileAssignments is sorted desc by effective_from)
            //   2. Org default_work_profile_id
            //   3. Empty (placeholder) — admin must pick
            const existing = workProfileAssignments[0]?.work_profile_id;
            const orgDefault = orgDefaultWorkProfileId
              && orgWorkProfiles.some((p) => p.id === orgDefaultWorkProfileId)
              ? orgDefaultWorkProfileId
              : "";
            setWpProfileId(existing ?? orgDefault);
            setWpEffectiveFrom(today);
            setWpError(null);
            setWpSheetOpen(true);
          }}>
            <Plus className="h-4 w-4 mr-1.5" />
            Assign Pattern
          </Button>
        </div>
        {workProfileAssignments.length === 0 ? (
          <p className="text-sm text-muted-foreground">No working pattern assigned. The organisation default will be used.</p>
        ) : (
          <div className="flex justify-center w-full">
            <div className="w-auto max-w-[90%] min-w-0">
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Pattern</TableHead>
                      <TableHead>Effective From</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {workProfileAssignments.map((a, i) => (
                      <TableRow key={a.id}>
                        <TableCell className="font-medium">{a.work_profile_name}</TableCell>
                        <TableCell>{fmtDate(a.effective_from)}</TableCell>
                        <TableCell>
                          <Badge variant={i === 0 ? "default" : "secondary"}>
                            {i === 0 ? "Current" : "Previous"}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Assign Work Profile Sheet */}
      <Sheet open={wpSheetOpen} onOpenChange={setWpSheetOpen}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Assign Working Pattern</SheetTitle>
            <SheetDescription>Select a working pattern and the date it takes effect.</SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-5 px-4">
            <div className="flex flex-col gap-1.5">
              <Label>Working Pattern</Label>
              <Select value={wpProfileId} onValueChange={setWpProfileId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select pattern" />
                </SelectTrigger>
                <SelectContent>
                  {orgWorkProfiles.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="wp-effective">Effective From</Label>
              <Input
                id="wp-effective"
                type="date"
                value={wpEffectiveFrom}
                onChange={(e) => setWpEffectiveFrom(e.target.value)}
                required
              />
              {wpEffectiveFrom && wpEffectiveFrom < today && (
                <p className="text-xs text-amber-600">This date is in the past — you will be asked to confirm.</p>
              )}
            </div>
            {wpError && <p className="text-sm text-destructive">{wpError}</p>}
          </div>
          <SheetFooter>
            <Button variant="outline" onClick={() => setWpSheetOpen(false)} disabled={wpLoading}>Cancel</Button>
            <Button onClick={handleWpSaveClick} disabled={wpLoading || !wpProfileId || !wpEffectiveFrom}>
              {wpLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Work profile backdate confirmation */}
      <AlertDialog open={wpBackdateOpen} onOpenChange={setWpBackdateOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Backdate Pattern Change?</AlertDialogTitle>
            <AlertDialogDescription>
              The effective date is in the past. Are you sure you want to backdate this pattern change to {wpEffectiveFrom ? fmtDate(wpEffectiveFrom) : ""}?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setWpBackdateOpen(false); doWpSave(); }}>
              Yes, backdate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
