"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2 } from "lucide-react";
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
import { changeEmployeeHolidayProfile } from "../../actions";

type HolidayYearRecord = {
  id: string;
  absence_type_id: string;
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
}: EmployeeHolidayClientProps) {
  const router = useRouter();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [selectedProfileId, setSelectedProfileId] = useState(currentProfileId ?? "");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [backdateConfirmOpen, setBackdateConfirmOpen] = useState(false);

  const unit = measurementMode === "hours" ? "hours" : "days";
  const today = new Date().toISOString().slice(0, 10);

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
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">{memberName}</h1>
            <p className="text-sm text-muted-foreground">Holiday Profile: {currentProfileName}</p>
          </div>
          <Button variant="outline" onClick={() => {
            setSelectedProfileId(currentProfileId ?? "");
            setEffectiveDate("");
            setError(null);
            setSheetOpen(true);
          }}>
            Change Profile
          </Button>
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
                  <TableHead>Borrowed Forward</TableHead>
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
                  records.map((rec) => {
                    const proRata = rec.pro_rata_amount ?? rec.base_amount;
                    const total = proRata + rec.carried_over + rec.adjustment;
                    const status = getStatus(rec.year_start, rec.year_end);
                    const agg = bookingAggregates[rec.id] ?? { booked: 0, taken: 0 };
                    const recProfileName = profileMap[rec.absence_type_id] ?? "—";
                    return (
                      <TableRow key={rec.id}>
                        <TableCell className="font-medium">{yearLabel(rec.year_start)}</TableCell>
                        <TableCell>{recProfileName}</TableCell>
                        <TableCell>{fmtDate(rec.year_start)}</TableCell>
                        <TableCell>{fmtDate(rec.year_end)}</TableCell>
                        <TableCell>{proRata} {unit}</TableCell>
                        <TableCell>{rec.carried_over} {unit}</TableCell>
                        <TableCell>{rec.adjustment > 0 ? `+${rec.adjustment}` : rec.adjustment} {unit}</TableCell>
                        <TableCell className="font-medium">{total} {unit}</TableCell>
                        <TableCell>{agg.booked} {unit}</TableCell>
                        <TableCell>{agg.taken} {unit}</TableCell>
                        <TableCell>{rec.borrow_forward} {unit}</TableCell>
                        <TableCell>{rec.carried_over} {unit}</TableCell>
                        <TableCell>
                          <Badge variant={status.variant}>{status.label}</Badge>
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
              <Select value={selectedProfileId} onValueChange={setSelectedProfileId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select profile" />
                </SelectTrigger>
                <SelectContent>
                  {absenceProfiles.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} ({p.allowance} {p.measurement_mode})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
    </>
  );
}
