// CLE-170 — Work Profile Assignment section for the Employment page.
//
// Moved here from the per-employee Holiday page (where it sat on the Phase 2
// transitional client) since work patterns are an employment concept rather
// than a holiday one. Holiday booking still depends on the assigned work
// pattern to compute days_deducted, so it has to live somewhere accessible
// to admins.

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

import { assignWorkProfile } from "@/app/(dashboard)/work-profile-actions";

function fmtDate(iso: string): string {
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export type WorkProfileAssignmentRow = {
  id: string;
  work_profile_id: string;
  work_profile_name: string;
  effective_from: string;
};

interface WorkProfileSectionProps {
  memberId: string;
  assignments: WorkProfileAssignmentRow[];
  orgWorkProfiles: { id: string; name: string }[];
  orgDefaultWorkProfileId: string | null;
  canEdit: boolean;
}

export function WorkProfileSection({
  memberId,
  assignments,
  orgWorkProfiles,
  orgDefaultWorkProfileId,
  canEdit,
}: WorkProfileSectionProps) {
  const router = useRouter();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [profileId, setProfileId] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function openSheet() {
    // Default the dropdown to: their most recent assignment's profile, OR
    // the org default if it's still in the work profiles list.
    const existing = assignments[0]?.work_profile_id;
    const orgDefault =
      orgDefaultWorkProfileId &&
      orgWorkProfiles.some((p) => p.id === orgDefaultWorkProfileId)
        ? orgDefaultWorkProfileId
        : "";
    setProfileId(existing ?? orgDefault);
    setEffectiveFrom(new Date().toISOString().slice(0, 10));
    setError(null);
    setSheetOpen(true);
  }

  async function handleAssign() {
    if (!profileId || !effectiveFrom) return;
    setLoading(true);
    setError(null);
    const result = await assignWorkProfile(memberId, profileId, effectiveFrom);
    setLoading(false);
    if (!result.success) {
      setError(result.error ?? "Failed to assign work profile");
      return;
    }
    setSheetOpen(false);
    router.refresh();
  }

  return (
    <>
      <div className="space-y-2">
        <Label>Work Profile</Label>
        {assignments.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>No work profiles assigned.</span>
            {canEdit && (
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                onClick={openSheet}
                title="Assign work profile"
              >
                <Plus className="h-4 w-4" />
              </Button>
            )}
          </div>
        ) : (
          <div className="w-fit space-y-1">
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Work Profile</TableHead>
                    <TableHead>Effective From</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {assignments.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="font-medium">{a.work_profile_name}</TableCell>
                      <TableCell>{fmtDate(a.effective_from)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {canEdit && (
              <div className="flex justify-end">
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  onClick={openSheet}
                  title="Assign work profile"
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Assign Work Profile</SheetTitle>
            <SheetDescription>
              Pick a work profile and the date it takes effect.
            </SheetDescription>
          </SheetHeader>
          <div className="overflow-y-auto max-h-[60vh] px-1 flex flex-col gap-4 mt-4">
            <div className="flex flex-col gap-1.5">
              <Label>Work Profile</Label>
              <Select value={profileId} onValueChange={setProfileId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select work profile" />
                </SelectTrigger>
                <SelectContent>
                  {orgWorkProfiles.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Effective From</Label>
              <Input
                type="date"
                value={effectiveFrom}
                onChange={(e) => setEffectiveFrom(e.target.value)}
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <SheetFooter>
            <Button
              variant="outline"
              onClick={() => setSheetOpen(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button onClick={handleAssign} disabled={loading || !profileId || !effectiveFrom}>
              {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Assign
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}
