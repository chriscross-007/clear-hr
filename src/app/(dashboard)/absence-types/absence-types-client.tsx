"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Loader2, ChevronDown, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  createAbsenceType,
  updateAbsenceType,
  deleteAbsenceType,
  createAbsenceReason,
  updateAbsenceReason,
  deleteAbsenceReason,
  type AbsenceType,
  type AbsenceReason,
} from "../absence-actions";

type ReasonFilter = "active" | "inactive" | "all";

interface AbsenceTypesClientProps {
  initialTypes: AbsenceType[];
  initialReasons: AbsenceReason[];
}

export function AbsenceTypesClient({ initialTypes, initialReasons }: AbsenceTypesClientProps) {
  const router = useRouter();
  const [types, setTypes] = useState(initialTypes);
  const [reasons, setReasons] = useState(initialReasons);
  const [expandedTypeIds, setExpandedTypeIds] = useState<Set<string>>(new Set());
  const [reasonFilter, setReasonFilter] = useState<ReasonFilter>("active");
  const hasAnyInactive = reasons.some((r) => r.is_deprecated);

  // --- Type form state ---
  const [typeSheetOpen, setTypeSheetOpen] = useState(false);
  const [editingType, setEditingType] = useState<AbsenceType | null>(null);
  const [deletingType, setDeletingType] = useState<AbsenceType | null>(null);
  const [typeDeleteLoading, setTypeDeleteLoading] = useState(false);
  const [typeDeleteError, setTypeDeleteError] = useState<string | null>(null);
  const [typeName, setTypeName] = useState("");
  const [typeColour, setTypeColour] = useState("#6366f1");
  const [typeIsPaid, setTypeIsPaid] = useState(true);
  const [typeRequiresTracking, setTypeRequiresTracking] = useState(false);
  const [typeDeductsFromEntitlement, setTypeDeductsFromEntitlement] = useState(true);
  const [typeRequiresApproval, setTypeRequiresApproval] = useState(false);
  const [typeFormLoading, setTypeFormLoading] = useState(false);
  const [typeFormError, setTypeFormError] = useState<string | null>(null);

  // --- Reason form state ---
  const [reasonSheetOpen, setReasonSheetOpen] = useState(false);
  const [editingReason, setEditingReason] = useState<AbsenceReason | null>(null);
  const [reasonTypeId, setReasonTypeId] = useState<string | null>(null);
  const [deletingReason, setDeletingReason] = useState<AbsenceReason | null>(null);
  const [reasonDeleteLoading, setReasonDeleteLoading] = useState(false);
  const [reasonDeleteError, setReasonDeleteError] = useState<string | null>(null);
  const [reasonName, setReasonName] = useState("");
  const [reasonColour, setReasonColour] = useState("#6366f1");
  const [reasonActive, setReasonActive] = useState(true);
  const [reasonFormLoading, setReasonFormLoading] = useState(false);
  const [reasonFormError, setReasonFormError] = useState<string | null>(null);

  // --- Type helpers ---

  function toggleExpanded(typeId: string) {
    setExpandedTypeIds((prev) => {
      const next = new Set(prev);
      next.has(typeId) ? next.delete(typeId) : next.add(typeId);
      return next;
    });
  }

  function openCreateType() {
    setEditingType(null);
    setTypeName("");
    setTypeColour("#6366f1");
    setTypeIsPaid(true);
    setTypeRequiresTracking(false);
    setTypeDeductsFromEntitlement(true);
    setTypeRequiresApproval(false);
    setTypeFormError(null);
    setTypeSheetOpen(true);
  }

  function openEditType(type: AbsenceType) {
    setEditingType(type);
    setTypeName(type.name);
    setTypeColour(type.colour || "#6366f1");
    setTypeIsPaid(type.is_paid);
    setTypeRequiresTracking(type.requires_tracking);
    setTypeDeductsFromEntitlement(type.deducts_from_entitlement);
    setTypeRequiresApproval(type.requires_approval);
    setTypeFormError(null);
    setTypeSheetOpen(true);
  }

  async function handleSaveType() {
    setTypeFormLoading(true);
    setTypeFormError(null);
    const input = {
      name: typeName,
      colour: typeColour,
      is_paid: typeIsPaid,
      requires_tracking: typeRequiresTracking,
      deducts_from_entitlement: typeDeductsFromEntitlement,
      requires_approval: typeRequiresApproval,
    };
    const result = editingType
      ? await updateAbsenceType(editingType.id, input)
      : await createAbsenceType(input);
    setTypeFormLoading(false);
    if (!result.success) { setTypeFormError(result.error ?? "An error occurred"); return; }
    if (result.absenceType) {
      if (editingType) {
        setTypes((prev) => prev.map((t) => (t.id === editingType.id ? result.absenceType! : t)));
      } else {
        setTypes((prev) => [...prev, result.absenceType!]);
      }
    }
    setTypeSheetOpen(false);
    router.refresh();
  }

  async function handleDeleteType() {
    if (!deletingType) return;
    setTypeDeleteLoading(true);
    setTypeDeleteError(null);
    const result = await deleteAbsenceType(deletingType.id);
    setTypeDeleteLoading(false);
    if (!result.success) { setTypeDeleteError(result.error ?? "An error occurred"); return; }
    setTypes((prev) => prev.filter((t) => t.id !== deletingType.id));
    setReasons((prev) => prev.filter((r) => r.absence_type_id !== deletingType.id));
    setDeletingType(null);
    router.refresh();
  }

  // --- Reason helpers ---

  function openCreateReason(typeId: string) {
    setEditingReason(null);
    setReasonTypeId(typeId);
    setReasonName("");
    setReasonColour("#6366f1");
    setReasonActive(true);
    setReasonFormError(null);
    setReasonSheetOpen(true);
  }

  function openEditReason(reason: AbsenceReason) {
    setEditingReason(reason);
    setReasonTypeId(reason.absence_type_id);
    setReasonName(reason.name);
    setReasonColour(reason.colour);
    setReasonActive(!reason.is_deprecated);
    setReasonFormError(null);
    setReasonSheetOpen(true);
  }

  async function handleSaveReason() {
    setReasonFormLoading(true);
    setReasonFormError(null);
    const result = editingReason
      ? await updateAbsenceReason(editingReason.id, { name: reasonName, colour: reasonColour, is_deprecated: !reasonActive })
      : await createAbsenceReason({ absence_type_id: reasonTypeId!, name: reasonName, colour: reasonColour, is_deprecated: !reasonActive });
    setReasonFormLoading(false);
    if (!result.success) { setReasonFormError(result.error ?? "An error occurred"); return; }
    if (result.reason) {
      if (editingReason) {
        setReasons((prev) => prev.map((r) => (r.id === editingReason.id ? result.reason! : r)));
      } else {
        setReasons((prev) => [...prev, result.reason!]);
      }
    }
    setReasonSheetOpen(false);
    router.refresh();
  }

  async function handleDeleteReason() {
    if (!deletingReason) return;
    setReasonDeleteLoading(true);
    setReasonDeleteError(null);
    const result = await deleteAbsenceReason(deletingReason.id);
    setReasonDeleteLoading(false);
    if (!result.success) { setReasonDeleteError(result.error ?? "An error occurred"); return; }
    setReasons((prev) => prev.filter((r) => r.id !== deletingReason.id));
    setDeletingReason(null);
    router.refresh();
  }

  // --- Render ---

  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <div>
          <p className="text-sm text-muted-foreground">Absence Management</p>
          <h1 className="text-2xl font-bold">Absence Types & Reasons</h1>
        </div>
        <div className="flex items-center gap-3">
          {hasAnyInactive && (
            <div className="flex items-center gap-1">
              {(["active", "all", "inactive"] as const).map((f) => (
                <button
                  key={f}
                  className={cn(
                    "px-2.5 py-1 rounded text-xs font-medium transition-colors",
                    reasonFilter === f
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted"
                  )}
                  onClick={() => setReasonFilter(f)}
                >
                  {f === "active" ? "Active" : f === "inactive" ? "Inactive" : "All"}
                </button>
              ))}
            </div>
          )}
          <Button onClick={openCreateType}>
            <Plus className="h-4 w-4 mr-1.5" />
            Add Type
          </Button>
        </div>
      </div>

      <div className="flex justify-center w-full">
        <div className="w-auto max-w-[90%] min-w-0">
          <div className="rounded-md border">
            <Table>
              <TableHeader>
            <TableRow>
              <TableHead className="w-8" />
              <TableHead>Name</TableHead>
              <TableHead className="w-16">Colour</TableHead>
              <TableHead>Paid</TableHead>
              <TableHead>Tracked</TableHead>
              <TableHead>Deducts</TableHead>
              <TableHead>Approval</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {types.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                  No absence types defined.
                </TableCell>
              </TableRow>
            ) : (
              types.map((type) => {
                const typeReasons = reasons.filter((r) => r.absence_type_id === type.id);
                const isExpanded = expandedTypeIds.has(type.id);
                return (
                  <TypeRowWithReasons
                    key={type.id}
                    type={type}
                    reasons={typeReasons}
                    reasonFilter={reasonFilter}
                    isExpanded={isExpanded}
                    onToggle={() => toggleExpanded(type.id)}
                    onEditType={() => openEditType(type)}
                    onDeleteType={() => { setTypeDeleteError(null); setDeletingType(type); }}
                    onAddReason={() => openCreateReason(type.id)}
                    onEditReason={openEditReason}
                    onDeleteReason={(r) => { setReasonDeleteError(null); setDeletingReason(r); }}
                  />
                );
              })
            )}
          </TableBody>
            </Table>
          </div>
        </div>
      </div>

      {/* Type Create / Edit Sheet */}
      <Sheet open={typeSheetOpen} onOpenChange={setTypeSheetOpen}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>{editingType ? "Edit Absence Type" : "New Absence Type"}</SheetTitle>
            <SheetDescription>
              {editingType
                ? "Update the settings for this absence type."
                : "Create a new custom absence type for your organisation."}
            </SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-5 px-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="absence-type-name">Name</Label>
              <Input id="absence-type-name" value={typeName} onChange={(e) => setTypeName(e.target.value)} placeholder="e.g. TOIL, Parental Leave" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="absence-type-colour">Colour</Label>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  id="absence-type-colour"
                  value={typeColour}
                  onChange={(e) => setTypeColour(e.target.value)}
                  className="h-9 w-14 cursor-pointer rounded border border-input bg-background p-0.5"
                />
                <Input
                  value={typeColour}
                  onChange={(e) => setTypeColour(e.target.value)}
                  placeholder="#6366f1"
                  maxLength={7}
                  className="font-mono"
                />
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div><Label>Paid</Label><p className="text-xs text-muted-foreground">Employee is paid during this absence</p></div>
              <Switch checked={typeIsPaid} onCheckedChange={setTypeIsPaid} />
            </div>
            <div className="flex items-center justify-between">
              <div><Label>Tracked (has allowance)</Label><p className="text-xs text-muted-foreground">Entitlement is tracked and limited</p></div>
              <Switch checked={typeRequiresTracking} onCheckedChange={setTypeRequiresTracking} />
            </div>
            <div className="flex items-center justify-between">
              <div><Label>Deducts from entitlement</Label><p className="text-xs text-muted-foreground">Taking this absence reduces the allowance balance</p></div>
              <Switch checked={typeDeductsFromEntitlement} onCheckedChange={setTypeDeductsFromEntitlement} />
            </div>
            <div className="flex items-center justify-between">
              <div><Label>Requires approval</Label><p className="text-xs text-muted-foreground">Requests need manager approval before being confirmed</p></div>
              <Switch checked={typeRequiresApproval} onCheckedChange={setTypeRequiresApproval} />
            </div>
            {typeFormError && <p className="text-sm text-destructive">{typeFormError}</p>}
          </div>
          <SheetFooter>
            <Button variant="outline" onClick={() => setTypeSheetOpen(false)} disabled={typeFormLoading}>Cancel</Button>
            <Button onClick={handleSaveType} disabled={typeFormLoading || !typeName.trim()}>
              {typeFormLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {editingType ? "Save Changes" : "Create"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Reason Create / Edit Sheet */}
      <Sheet open={reasonSheetOpen} onOpenChange={setReasonSheetOpen}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>{editingReason ? "Edit Absence Reason" : "New Absence Reason"}</SheetTitle>
            <SheetDescription>
              {editingReason
                ? "Update this absence reason."
                : "Create a new reason under this absence type."}
            </SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-5 px-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="reason-name">Name</Label>
              <Input
                id="reason-name"
                value={reasonName}
                onChange={(e) => setReasonName(e.target.value)}
                placeholder="e.g. Summer Holiday, Doctor Appointment"
                disabled={editingReason?.is_default}
              />
              {editingReason?.is_default && (
                <p className="text-xs text-muted-foreground">Default reason names cannot be changed.</p>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="reason-colour">Colour</Label>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  id="reason-colour"
                  value={reasonColour}
                  onChange={(e) => setReasonColour(e.target.value)}
                  className="h-9 w-14 cursor-pointer rounded border border-input bg-background p-0.5"
                />
                <Input
                  value={reasonColour}
                  onChange={(e) => setReasonColour(e.target.value)}
                  placeholder="#6366f1"
                  className="w-28 font-mono text-sm"
                />
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <Label>Active</Label>
                <p className="text-xs text-muted-foreground">Inactive reasons are hidden from the booking form</p>
              </div>
              <Switch checked={reasonActive} onCheckedChange={setReasonActive} />
            </div>
            {reasonFormError && <p className="text-sm text-destructive">{reasonFormError}</p>}
          </div>
          <SheetFooter>
            <Button variant="outline" onClick={() => setReasonSheetOpen(false)} disabled={reasonFormLoading}>Cancel</Button>
            <Button onClick={handleSaveReason} disabled={reasonFormLoading || !reasonName.trim() || !reasonColour.trim()}>
              {reasonFormLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {editingReason ? "Save Changes" : "Create"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Type Delete Confirmation */}
      <AlertDialog open={!!deletingType} onOpenChange={(open) => { if (!open) { setDeletingType(null); setTypeDeleteError(null); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Absence Type</AlertDialogTitle>
            <AlertDialogDescription>
              {typeDeleteError ? (
                <span className="text-destructive">{typeDeleteError}</span>
              ) : (
                <>Are you sure you want to delete <strong>{deletingType?.name}</strong>? This action cannot be undone.</>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={typeDeleteLoading}>Cancel</AlertDialogCancel>
            {!typeDeleteError && (
              <AlertDialogAction disabled={typeDeleteLoading} className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={(e) => { e.preventDefault(); handleDeleteType(); }}>
                {typeDeleteLoading ? "Deleting..." : "Delete"}
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Reason Delete Confirmation */}
      <AlertDialog open={!!deletingReason} onOpenChange={(open) => { if (!open) { setDeletingReason(null); setReasonDeleteError(null); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Absence Reason</AlertDialogTitle>
            <AlertDialogDescription>
              {reasonDeleteError ? (
                <span className="text-destructive">{reasonDeleteError}</span>
              ) : (
                <>Are you sure you want to delete <strong>{deletingReason?.name}</strong>? This action cannot be undone.</>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={reasonDeleteLoading}>Cancel</AlertDialogCancel>
            {!reasonDeleteError && (
              <AlertDialogAction disabled={reasonDeleteLoading} className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={(e) => { e.preventDefault(); handleDeleteReason(); }}>
                {reasonDeleteLoading ? "Deleting..." : "Delete"}
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ---------------------------------------------------------------------------
// Type row with expandable reasons
// ---------------------------------------------------------------------------

function TypeRowWithReasons({
  type,
  reasons,
  reasonFilter,
  isExpanded,
  onToggle,
  onEditType,
  onDeleteType,
  onAddReason,
  onEditReason,
  onDeleteReason,
}: {
  type: AbsenceType;
  reasons: AbsenceReason[];
  reasonFilter: ReasonFilter;
  isExpanded: boolean;
  onToggle: () => void;
  onEditType: () => void;
  onDeleteType: () => void;
  onAddReason: () => void;
  onEditReason: (r: AbsenceReason) => void;
  onDeleteReason: (r: AbsenceReason) => void;
}) {
  const filteredReasons = reasons.filter((r) => {
    if (reasonFilter === "active") return !r.is_deprecated;
    if (reasonFilter === "inactive") return r.is_deprecated;
    return true;
  });

  return (
    <>
      {/* Type row — click row to edit, chevron to expand */}
      <TableRow className="cursor-pointer hover:bg-muted/50" onClick={onEditType}>
        <TableCell className="w-8 px-2" onClick={(e) => { e.stopPropagation(); onToggle(); }}>
          <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", isExpanded && "rotate-180")} />
        </TableCell>
        <TableCell className="font-medium">
          {type.name}
          {type.is_default && <Badge variant="secondary" className="ml-2 text-xs">Default</Badge>}
          <span className="ml-2 text-xs text-muted-foreground">({reasons.length} reason{reasons.length !== 1 ? "s" : ""})</span>
        </TableCell>
        <TableCell>
          <span
            aria-label={type.colour || "#6366f1"}
            className="inline-block h-4 w-4 rounded-full border border-border"
            style={{ backgroundColor: type.colour || "#6366f1" }}
          />
        </TableCell>
        <TableCell>{type.is_paid ? <Check className="h-5 w-5 text-green-500" /> : <X className="h-5 w-5 text-red-500" />}</TableCell>
        <TableCell>{type.requires_tracking ? <Check className="h-5 w-5 text-green-500" /> : <X className="h-5 w-5 text-red-500" />}</TableCell>
        <TableCell>{type.deducts_from_entitlement ? <Check className="h-5 w-5 text-green-500" /> : <X className="h-5 w-5 text-red-500" />}</TableCell>
        <TableCell>{type.requires_approval ? <Check className="h-5 w-5 text-green-500" /> : <X className="h-5 w-5 text-red-500" />}</TableCell>
        <TableCell>
          {!type.is_default && (
            <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
              <Button variant="ghost" size="icon" onClick={onDeleteType}>
                <Trash2 className="h-4 w-4 text-destructive" />
                <span className="sr-only">Delete type</span>
              </Button>
            </div>
          )}
        </TableCell>
      </TableRow>

      {/* Expanded reasons */}
      {isExpanded && (
        <>
          {filteredReasons.map((reason) => (
            <TableRow key={reason.id} className={cn("bg-muted/30 cursor-pointer hover:bg-muted/50", reason.is_deprecated && "opacity-50")} onClick={() => onEditReason(reason)}>
              <TableCell />
              <TableCell className="pl-8">
                <div className="flex items-center gap-2">
                  <span
                    className="inline-block h-3.5 w-3.5 rounded-full border border-border shrink-0"
                    style={{ backgroundColor: reason.colour }}
                  />
                  {reason.name}
                  {reason.is_default && <Badge variant="secondary" className="text-xs">Default</Badge>}
                  {reason.is_deprecated && <Badge variant="outline" className="text-xs text-muted-foreground">Inactive</Badge>}
                </div>
              </TableCell>
              <TableCell colSpan={5} />
              <TableCell>
                {!reason.is_default && (
                  <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
                    <Button variant="ghost" size="icon" onClick={() => onDeleteReason(reason)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                      <span className="sr-only">Delete reason</span>
                    </Button>
                  </div>
                )}
              </TableCell>
            </TableRow>
          ))}
          <TableRow className="bg-muted/30">
            <TableCell />
            <TableCell colSpan={7} className="pl-8">
              <Button variant="ghost" size="sm" className="text-xs" onClick={onAddReason}>
                <Plus className="h-3.5 w-3.5 mr-1" />
                Add Reason
              </Button>
            </TableCell>
          </TableRow>
        </>
      )}
    </>
  );
}
