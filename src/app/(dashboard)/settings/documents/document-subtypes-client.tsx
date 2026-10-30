"use client";

// CLE-205 — Document Subtypes manager. List grouped by system type;
// per-row edit / delete; add-new via the "Add subtype" button at the
// top of each type section.

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useMemberLabel } from "@/contexts/member-label-context";
import { Plus, Trash2, Loader2, ShieldCheck, Clock, CheckSquare, User, House } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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
  scopeForType,
  canBeRequired,
  canBeVerified,
  canMemberUpload,
  canRequireAcknowledgement,
  canBeSigned,
  type SignOff,
  type SigningMode,
  canRequireExpiry,
  hasMemberVisibilitySwitch,
  REVIEW_INTERVAL_OPTIONS,
  reviewIntervalLabel,
  type DocumentSubtypeDto,
  type DocumentSubtypeWritePayload,
  type DocumentType,
  type RetentionClass,
} from "./subtype-types";
import { capitalize, pluralize } from "@/lib/label-utils";

const TYPE_LABEL: Record<DocumentType, string> = {
  // CLE-231 — `contract` is shown as Employment: documents the
  // organisation issues to a member.
  contract: "Employment",
  certificate: "Certificates",
  evidence: "Right-to-Work Evidence",
  attachment: "Absence attachments",
  organisation_document: "Organisation documents",
};

// All per-member retention clocks start from the employee's leave
// date. Every label here is explicit about that so admins aren't
// left guessing "N years from when?". `policy` / `handbook` run on a
// supersede clock instead; they're Tier 2 (org-doc replacement is
// not shipped) so we hide them from the picker — see
// PER_MEMBER_RETENTION_CLASSES below.
const RETENTION_LABEL: Record<RetentionClass, string> = {
  contract: "Contract (6 years post-leave)",
  certificate: "Certificate (1 year post-leave)",
  evidence: "Evidence (6 years post-leave)",
  policy: "Policy (6 years post-supersede)",
  handbook: "Handbook (6 years post-supersede)",
  absence_attachment: "Absence attachment (3 years post-leave)",
  right_to_work: "Right-to-work (2 years post-leave)",
  payroll: "Payroll (6 years post-leave)",
  other: "Other (6 years post-leave)",
};

// Tier 1 scope — only per-member retention classes are offered in
// the subtypes picker. `policy` and `handbook` depend on org-doc
// supersede, which is Tier 2.
const PER_MEMBER_RETENTION_CLASSES = RETENTION_CLASSES.filter(
  (rc) => rc !== "policy" && rc !== "handbook",
);

function emptyPayload(type: DocumentType): DocumentSubtypeWritePayload {
  return {
    type,
    name: "",
    employeeCanUpload: false,
    retentionClass: "other",
    expiryRequired: false,
    requiresVerification: false,
    reviewPeriodMonths: null,
    trackablePerMember: false,
    signOff: "none",
    defaultSigningMode: "member",
    visibleToMember: true,
  };
}

function dtoToPayload(dto: DocumentSubtypeDto): DocumentSubtypeWritePayload {
  return {
    type: dto.type,
    name: dto.name,
    employeeCanUpload: dto.employeeCanUpload,
    retentionClass: dto.retentionClass,
    expiryRequired: dto.expiryRequired,
    requiresVerification: dto.requiresVerification,
    reviewPeriodMonths: dto.reviewPeriodMonths,
    trackablePerMember: dto.trackablePerMember,
    signOff: dto.signOff,
    defaultSigningMode: dto.defaultSigningMode,
    visibleToMember: dto.visibleToMember,
  };
}

export function DocumentSubtypesClient({
  initialSubtypes,
}: {
  initialSubtypes: DocumentSubtypeDto[];
}) {
  const router = useRouter();
  const { memberLabel } = useMemberLabel();
  const [subtypes, setSubtypes] = useState<DocumentSubtypeDto[]>(initialSubtypes);
  // Resync when the server rerenders (router.refresh() after a save).
  // Without this the useState snapshot from first mount would stick
  // and the list wouldn't reflect the new / edited subtype.
  useEffect(() => { setSubtypes(initialSubtypes); }, [initialSubtypes]);
  const [editing, setEditing] = useState<{ mode: "create" | "edit"; id?: string; payload: DocumentSubtypeWritePayload } | null>(null);
  const [deleting, setDeleting] = useState<DocumentSubtypeDto | null>(null);
  const [deleteInFlight, setDeleteInFlight] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Group by type. Any legacy row still carrying the pre-CLE-210
  // types (policy/handbook/other) is treated as `organisation_document`
  // for display so we don't crash on stale data mid-migration.
  const grouped: Record<DocumentType, DocumentSubtypeDto[]> = {
    contract: [], certificate: [], evidence: [],
    attachment: [], organisation_document: [],
  };
  for (const s of subtypes) {
    const bucket: DocumentType = (grouped[s.type] ? s.type : "organisation_document") as DocumentType;
    grouped[bucket].push(s);
  }

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
                          {scopeForType(s.type) === "organisation"
                            ? "—"
                            : RETENTION_LABEL[s.retentionClass]}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap gap-1.5">
                            {s.requiresVerification && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                                <ShieldCheck className="h-3 w-3" /> Verify
                              </span>
                            )}
                            {s.reviewPeriodMonths && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-purple-100 px-2 py-0.5 text-xs text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">
                                <Clock className="h-3 w-3" /> {s.reviewPeriodMonths}m
                              </span>
                            )}
                            {s.employeeCanUpload && (
                              <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700 dark:bg-green-900/30 dark:text-green-300">
                                {capitalize(memberLabel)} upload
                              </span>
                            )}
                            {s.expiryRequired && (
                              <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs text-orange-700 dark:bg-orange-900/30 dark:text-orange-300">
                                Expiry
                              </span>
                            )}
                            {s.signOff === "acknowledge" && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                                <CheckSquare className="h-3 w-3" /> Ack
                              </span>
                            )}
                            {s.signOff === "sign" && <SignPill subtype={s} memberLabel={memberLabel} />}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right">
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
  // Standing rule (CLAUDE.md → Dynamic Member Label): never hardcode
  // "employee". Resolve via context so the subtext reads e.g. "an
  // employee" / "a colleague" / "a member" per org config. The context
  // returns `{ memberLabel: string }`, not a bare string.
  const { memberLabel } = useMemberLabel();

  function update<K extends keyof DocumentSubtypeWritePayload>(
    key: K,
    value: DocumentSubtypeWritePayload[K],
  ) {
    setPayload((prev) => ({ ...prev, [key]: value }));
  }

  const scope = scopeForType(payload.type);
  const isOrgScope = scope === "organisation";

  // Standing order: Save button is inactive until form data changes.
  // For edit mode we compare the current payload with the initial one
  // handed in on mount. For create mode any input counts as a change,
  // so the dirty check is skipped (the name-required guard still
  // stands).
  const dirty =
    mode === "create" ? true : JSON.stringify(payload) !== JSON.stringify(initial);

  function handleSave() {
    setError(null);
    // Force personal-only flags off when saving an org-scope subtype.
    // These flags have no meaning at org scope — an employee can't
    // upload the handbook to themselves, nor is it "verified per
    // member" or "expected on every record". Belt-and-braces since
    // the UI already hides the toggles for org scope.
    const outbound: DocumentSubtypeWritePayload = isOrgScope
      ? {
          ...payload,
          employeeCanUpload: false,
          requiresVerification: false,
          trackablePerMember: false,
          // Retention class is a GDPR concept — how long personal-data
          // records survive after an employee leaves. Org docs have no
          // personal data and no auto-disposal, so the value is inert.
          // Pin to "other" for stored consistency.
          retentionClass: "other",
        }
      : payload;
    startTransition(async () => {
      const res = mode === "create"
        ? await createDocumentSubtype(outbound)
        : await updateDocumentSubtype(id as string, outbound);
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
          <DialogTitle>
            {mode === "create"
              ? `New Subtype under ${TYPE_LABEL[payload.type] ?? payload.type}`
              : "Edit subtype"}
          </DialogTitle>
          <DialogDescription>
            Governs upload rules, verification, expiry and retention for documents
            classified under this subtype.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-4">
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

          {/* Retention class is a GDPR concept — governs how long
              personal-data documents survive after an employee leaves.
              Meaningless for org docs (no personal data, no auto-
              disposal), so hidden at org scope. */}
          {!isOrgScope && (
            <div className="space-y-2">
              <Label>Retention class</Label>
              <Select
                value={payload.retentionClass}
                onValueChange={(v) => update("retentionClass", v as RetentionClass)}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PER_MEMBER_RETENTION_CLASSES.map((rc) => (
                    <SelectItem key={rc} value={rc}>{RETENTION_LABEL[rc]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Single-column stack (was 2-col on ≥sm). Chris's read: a
              vertical scan of the flag list is faster than sweeping
              across a grid, and the wider row lets the description
              text breathe rather than wrapping tight. */}
          <div className="flex flex-col gap-3">
            {/* Personal-scope-only flags — hidden entirely for org docs. */}
            {!isOrgScope && (
              <>
                {/* Employment documents are always issued by the
                    organisation, so members can't upload them. */}
                {canMemberUpload(payload.type) && (
                  <FlagRow
                    label={`${capitalize(memberLabel)} can upload`}
                    description={`${capitalize(pluralize(memberLabel))} may attach this subtype to their own record.`}
                    value={payload.employeeCanUpload}
                    onChange={(v) => update("employeeCanUpload", v)}
                  />
                )}
                {/* CLE-234 — Verify only applies to documents a member
                    supplies (Certifications, RTW evidence, Other). */}
                {canBeVerified(payload.type) && (
                  <FlagRow
                    label="Requires HR verification"
                    description="HR confirms each file is a true copy (e.g. has seen the original)."
                    value={payload.requiresVerification}
                    onChange={(v) => update("requiresVerification", v)}
                  />
                )}
                {/* CLE-231 — only certificates can be required of a
                    member (they appear as placeholders on the member's
                    Certifications tab once required). */}
                {canBeRequired(payload.type) && (
                  <FlagRow
                    label="Can be required"
                    description={`Can be set as a required certification for ${
                      /^[aeiouAEIOU]/.test(memberLabel) ? "an" : "a"
                    } ${memberLabel} (on their Employment tab).`}
                    value={payload.trackablePerMember}
                    onChange={(v) => update("trackablePerMember", v)}
                  />
                )}
                {/* CLE-231 — Employment subtypes can be kept HR-only. */}
                {hasMemberVisibilitySwitch(payload.type) && (
                  <FlagRow
                    label={`Visible to the ${memberLabel}`}
                    description={`Off keeps documents of this kind off the ${memberLabel}'s own view (e.g. investigation notes).`}
                    value={payload.visibleToMember}
                    onChange={(v) => update("visibleToMember", v)}
                  />
                )}
              </>
            )}
            {/* Org document uploads don't ask for an expiry date (it's
                set on the Details dialog), so no switch for org scope. */}
            {canRequireExpiry(payload.type) && (
              <FlagRow
                label="Expiry required"
                description="An expiry date must be entered on upload. Use only when the document really expires — otherwise use a review interval."
                value={payload.expiryRequired}
                onChange={(v) => update("expiryRequired", v)}
              />
            )}
            {/* Certificates and RTW evidence are supplied by the
                member — nothing for them to acknowledge. */}
            {/* Certificates and RTW evidence are supplied by the
                member — nothing for them to acknowledge or sign. */}
            {canRequireAcknowledgement(payload.type) && !canBeSigned(payload.type) && (
              <FlagRow
                label="Requires acknowledgement"
                description="The document's owner must click to confirm they've read this."
                value={payload.signOff === "acknowledge"}
                onChange={(v) => update("signOff", v ? "acknowledge" : "none")}
              />
            )}
            {/* CLE-236 — documents the organisation supplies can be
                acknowledged, signed, or neither (never both). */}
            {canBeSigned(payload.type) && (
              <div className="space-y-2 rounded-md border p-3">
                <Label>{isOrgScope ? `What ${pluralize(memberLabel)} must do` : `What the ${memberLabel} must do`}</Label>
                <Select
                  value={payload.signOff}
                  onValueChange={(v) => update("signOff", v as SignOff)}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Neither</SelectItem>
                    <SelectItem value="acknowledge">Acknowledge (click to confirm they&apos;ve read it)</SelectItem>
                    <SelectItem value="sign">Sign (typed or drawn electronic signature)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {payload.signOff === "sign"
                    ? isOrgScope
                      ? `Every ${memberLabel} the document is visible to is asked to sign it.`
                      : "PDF documents of this kind can be sent for signature from the document's details."
                    : payload.signOff === "acknowledge"
                      ? isOrgScope
                        ? `Every ${memberLabel} the document is visible to must click to confirm they've read it.`
                        : `The ${memberLabel} must click to confirm they've read it.`
                      : "Nothing is asked of anyone."}
                </p>
                {!isOrgScope && payload.signOff === "sign" && (
                  <div className="space-y-1 pt-1">
                    <Label className="text-xs">Who signs (default when sending)</Label>
                    <Select
                      value={payload.defaultSigningMode}
                      onValueChange={(v) => update("defaultSigningMode", v as SigningMode)}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="member">{capitalize(memberLabel)} only</SelectItem>
                        <SelectItem value="company">Company signatory only</SelectItem>
                        <SelectItem value="member_then_company">{capitalize(memberLabel)}, then company signatory</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* CLE-234 — Review interval applies to every type, both
              scopes. None = ad hoc (no date seeded; an admin can set a
              Next review date by hand). A number seeds Next review date
              = upload date + interval, and "Mark as reviewed" rolls it
              to today + interval. */}
          <div className="space-y-2">
            <Label>Review interval</Label>
            <p className="text-xs text-muted-foreground">
              How often HR should check whether these documents need updating.
              None means reviews are set by hand when needed.
            </p>
            <Select
              value={payload.reviewPeriodMonths === null ? "none" : String(payload.reviewPeriodMonths)}
              onValueChange={(v) => update("reviewPeriodMonths", v === "none" ? null : Number(v))}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{reviewIntervalLabel(null)}</SelectItem>
                {Array.from(new Set([
                  ...REVIEW_INTERVAL_OPTIONS,
                  ...(payload.reviewPeriodMonths !== null ? [payload.reviewPeriodMonths] : []),
                ])).sort((a, b) => a - b).map((m) => (
                  <SelectItem key={m} value={String(m)}>{reviewIntervalLabel(m)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={pending || !payload.name.trim() || !dirty}>
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

// CLE-236 — Sign pills show who signs: a person icon + "Sign" for the
// member, a house icon + "Sign" for the organisation (company signatory);
// both pills when the member signs first and then the company.
// Organisation document subtypes are signed by every member the document
// is visible to.
function SignPill({ subtype, memberLabel }: { subtype: DocumentSubtypeDto; memberLabel: string }) {
  const Member = capitalize(memberLabel);
  const isOrg = scopeForType(subtype.type) === "organisation";
  const mode = isOrg ? "member" : subtype.defaultSigningMode;
  const usual = " (the usual choice when sending; HR can change it per document)";
  const memberTip = isOrg
    ? `Every ${memberLabel} the document is visible to is asked to sign it. HR can also have the organisation sign it first.`
    : mode === "member_then_company"
      ? `${Member} signs first, then the organisation${usual}.`
      : `${Member} signs${usual}.`;
  const orgTip =
    mode === "member_then_company"
      ? `After the ${memberLabel}, a company signatory signs for the organisation${usual}.`
      : `A company signatory signs for the organisation${usual}.`;
  const pill = (icon: React.ReactNode, tip: string, key: string) => (
    <Tooltip key={key}>
      <TooltipTrigger asChild>
        <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-xs text-violet-700 dark:bg-violet-900/30 dark:text-violet-300">
          {icon} Sign
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs">{tip}</TooltipContent>
    </Tooltip>
  );
  return (
    <>
      {(mode === "member" || mode === "member_then_company") &&
        pill(<User className="h-3 w-3" aria-label={Member} />, memberTip, "m")}
      {(mode === "company" || mode === "member_then_company") &&
        pill(<House className="h-3 w-3" aria-label="Organisation" />, orgTip, "c")}
    </>
  );
}
