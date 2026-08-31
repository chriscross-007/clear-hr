"use client";

// CLE-205 — Document Subtypes manager. List grouped by system type;
// per-row edit / delete; add-new via the "Add subtype" button at the
// top of each type section.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil, Trash2, Loader2, ShieldCheck, Users, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
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
  createDocumentSubtype,
  updateDocumentSubtype,
  deleteDocumentSubtype,
} from "./subtype-actions";
import {
  DOCUMENT_TYPES,
  RETENTION_CLASSES,
  type DocumentSubtypeDto,
  type DocumentSubtypeWritePayload,
  type DocumentType,
  type RetentionClass,
} from "./subtype-types";

const TYPE_LABEL: Record<DocumentType, string> = {
  contract: "Contracts",
  certificate: "Certificates",
  evidence: "Evidence (Right-to-Work, DBS, etc.)",
  policy: "Policies",
  handbook: "Handbook",
  attachment: "Absence attachments",
  other: "Other",
};

const RETENTION_LABEL: Record<RetentionClass, string> = {
  contract: "Contract (6 years post-employment)",
  certificate: "Certificate (leave + 1 year)",
  evidence: "Evidence (6 years)",
  policy: "Policy (6 years superseded)",
  handbook: "Handbook (6 years superseded)",
  absence_attachment: "Absence attachment (3 years)",
  right_to_work: "Right-to-work (2 years post-employment)",
  payroll: "Payroll (6 years)",
  other: "Other (6 years)",
};

function emptyPayload(type: DocumentType): DocumentSubtypeWritePayload {
  return {
    type,
    name: "",
    employeeCanUpload: false,
    retentionClass: "other",
    expiryRequired: false,
    defaultExpiryMonths: null,
    requiresVerification: false,
    reviewPeriodMonths: null,
    expectedForEveryMember: false,
    requiresSignature: false,
  };
}

function dtoToPayload(dto: DocumentSubtypeDto): DocumentSubtypeWritePayload {
  return {
    type: dto.type,
    name: dto.name,
    employeeCanUpload: dto.employeeCanUpload,
    retentionClass: dto.retentionClass,
    expiryRequired: dto.expiryRequired,
    defaultExpiryMonths: dto.defaultExpiryMonths,
    requiresVerification: dto.requiresVerification,
    reviewPeriodMonths: dto.reviewPeriodMonths,
    expectedForEveryMember: dto.expectedForEveryMember,
    requiresSignature: dto.requiresSignature,
  };
}

export function DocumentSubtypesClient({
  initialSubtypes,
}: {
  initialSubtypes: DocumentSubtypeDto[];
}) {
  const router = useRouter();
  const [subtypes] = useState<DocumentSubtypeDto[]>(initialSubtypes);
  const [editing, setEditing] = useState<{ mode: "create" | "edit"; id?: string; payload: DocumentSubtypeWritePayload } | null>(null);
  const [deleting, setDeleting] = useState<DocumentSubtypeDto | null>(null);
  const [deleteInFlight, setDeleteInFlight] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Group by type.
  const grouped: Record<DocumentType, DocumentSubtypeDto[]> = {
    contract: [], certificate: [], evidence: [],
    policy: [], handbook: [], attachment: [], other: [],
  };
  for (const s of subtypes) grouped[s.type].push(s);

  async function handleConfirmDelete() {
    if (!deleting) return;
    setDeleteInFlight(true);
    setDeleteError(null);
    const res = await deleteDocumentSubtype(deleting.id);
    setDeleteInFlight(false);
    if (!res.success) {
      setDeleteError(res.error ?? "Failed to delete subtype");
      return;
    }
    setDeleting(null);
    router.refresh();
  }

  return (
    <div className="space-y-8">
      {DOCUMENT_TYPES.map((type) => {
        const list = grouped[type];
        return (
          <section key={type} className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">{TYPE_LABEL[type]}</h2>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setEditing({ mode: "create", payload: emptyPayload(type) })}
              >
                <Plus className="mr-1.5 h-4 w-4" />
                Add subtype
              </Button>
            </div>
            {list.length === 0 ? (
              <p className="text-sm text-muted-foreground">No subtypes configured.</p>
            ) : (
              <div className="overflow-hidden rounded-md border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr className="text-left text-xs uppercase text-muted-foreground">
                      <th className="px-3 py-2 font-medium">Name</th>
                      <th className="px-3 py-2 font-medium">Retention</th>
                      <th className="px-3 py-2 font-medium">Flags</th>
                      <th className="px-3 py-2 font-medium text-right" />
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((s) => (
                      <tr
                        key={s.id}
                        className="cursor-pointer border-t hover:bg-muted/30"
                        onClick={() => setEditing({ mode: "edit", id: s.id, payload: dtoToPayload(s) })}
                      >
                        <td className="px-3 py-2 font-medium">{s.name}</td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {RETENTION_LABEL[s.retentionClass]}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap gap-1.5">
                            {s.requiresVerification && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                                <ShieldCheck className="h-3 w-3" /> Verify
                              </span>
                            )}
                            {s.expectedForEveryMember && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                                <Users className="h-3 w-3" /> Everyone
                              </span>
                            )}
                            {s.reviewPeriodMonths && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-purple-100 px-2 py-0.5 text-xs text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">
                                <Clock className="h-3 w-3" /> {s.reviewPeriodMonths}m
                              </span>
                            )}
                            {s.employeeCanUpload && (
                              <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700 dark:bg-green-900/30 dark:text-green-300">
                                Employee upload
                              </span>
                            )}
                            {s.expiryRequired && (
                              <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs text-orange-700 dark:bg-orange-900/30 dark:text-orange-300">
                                Expiry
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              aria-label="Edit subtype"
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditing({ mode: "edit", id: s.id, payload: dtoToPayload(s) });
                              }}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              aria-label="Delete subtype"
                              onClick={(e) => {
                                e.stopPropagation();
                                setDeleting(s);
                              }}
                            >
                              <Trash2 className="h-3.5 w-3.5 text-destructive" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        );
      })}

      {editing && (
        <SubtypeEditorDialog
          mode={editing.mode}
          id={editing.id}
          initial={editing.payload}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      )}

      <AlertDialog
        open={deleting !== null}
        onOpenChange={(o) => {
          if (!o && !deleteInFlight) {
            setDeleting(null);
            setDeleteError(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete subtype</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting && (
                <>
                  Permanently delete the <strong>{deleting.name}</strong> subtype? Any
                  document currently classified under it blocks deletion; reclassify
                  those first.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {deleteError}
            </div>
          )}
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
    </div>
  );
}

// ---------------------------------------------------------------------------
// Editor dialog
// ---------------------------------------------------------------------------

function SubtypeEditorDialog({
  mode,
  id,
  initial,
  onClose,
  onSaved,
}: {
  mode: "create" | "edit";
  id?: string;
  initial: DocumentSubtypeWritePayload;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [payload, setPayload] = useState<DocumentSubtypeWritePayload>(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function update<K extends keyof DocumentSubtypeWritePayload>(
    key: K,
    value: DocumentSubtypeWritePayload[K],
  ) {
    setPayload((prev) => ({ ...prev, [key]: value }));
  }

  function handleSave() {
    setError(null);
    startTransition(async () => {
      const res = mode === "create"
        ? await createDocumentSubtype(payload)
        : await updateDocumentSubtype(id as string, payload);
      if (!res.success) {
        setError(res.error ?? "Failed to save");
        return;
      }
      onSaved();
    });
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "New subtype" : "Edit subtype"}</DialogTitle>
          <DialogDescription>
            Governs upload rules, verification, expiry and retention for documents
            classified under this subtype.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          <div className="space-y-2">
            <Label>Name</Label>
            <Input
              value={payload.name}
              onChange={(e) => update("name", e.target.value)}
              placeholder="e.g. Passport (List A)"
              maxLength={80}
            />
          </div>

          <div className="space-y-2">
            <Label>Retention class</Label>
            <Select
              value={payload.retentionClass}
              onValueChange={(v) => update("retentionClass", v as RetentionClass)}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {RETENTION_CLASSES.map((rc) => (
                  <SelectItem key={rc} value={rc}>{RETENTION_LABEL[rc]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FlagRow
              label="Employee can upload"
              description="Employees may attach this subtype to their own record."
              value={payload.employeeCanUpload}
              onChange={(v) => update("employeeCanUpload", v)}
            />
            <FlagRow
              label="Expiry required"
              description="Upload flow requires an expiry date."
              value={payload.expiryRequired}
              onChange={(v) => update("expiryRequired", v)}
            />
            <FlagRow
              label="Requires HR verification"
              description="Documents of this subtype must be sighted by HR."
              value={payload.requiresVerification}
              onChange={(v) => update("requiresVerification", v)}
            />
            <FlagRow
              label="Expected for every member"
              description="Members with no active doc of this subtype surface on the compliance dashboard."
              value={payload.expectedForEveryMember}
              onChange={(v) => update("expectedForEveryMember", v)}
            />
            <FlagRow
              label="Requires signature (Tier 2)"
              description="Employee must sign / acknowledge. Inert until Tier 2."
              value={payload.requiresSignature}
              onChange={(v) => update("requiresSignature", v)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Default expiry (months)</Label>
              <Input
                type="number"
                min={0}
                value={payload.defaultExpiryMonths ?? ""}
                onChange={(e) => update(
                  "defaultExpiryMonths",
                  e.target.value === "" ? null : Number(e.target.value),
                )}
                placeholder="e.g. 24"
              />
            </div>
            <div className="space-y-2">
              <Label>Review cadence (months)</Label>
              <Input
                type="number"
                min={0}
                value={payload.reviewPeriodMonths ?? ""}
                onChange={(e) => update(
                  "reviewPeriodMonths",
                  e.target.value === "" ? null : Number(e.target.value),
                )}
                placeholder="e.g. 36 for DBS"
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={pending || !payload.name.trim()}>
            {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FlagRow({
  label,
  description,
  value,
  onChange,
}: {
  label: string;
  description: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="rounded-md border p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{label}</p>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        <Switch checked={value} onCheckedChange={onChange} />
      </div>
    </div>
  );
}
