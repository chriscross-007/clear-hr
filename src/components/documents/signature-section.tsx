"use client";

// CLE-236 — Signature section of the Document Details dialog.
//
// Admin pages (memberView = false): status of the open request, Send for
// signature, Cancel request, org-document coverage ("N of M signed") with
// each member's signed copy, and the evidence summary on a signed copy.
// Member pages (memberView = true): "Read & sign", "You signed this on …"
// and (org documents) "Download your signed copy".
//
// Loads its own state; tells the parent whether the document is a
// signing document (`onSignOff`) so the dialog can hide the
// acknowledgement section — a document is acknowledged or signed, never
// both.

import { useCallback, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { Download, Loader2, PenLine, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useMemberLabel } from "@/contexts/member-label-context";
import { invalidateSignatureBadges } from "@/components/documents/signature-badge";
import { capitalize, pluralize } from "@/lib/label-utils";
import {
  cancelSignatureRequest,
  getDocumentSignatureState,
  getOrgDocumentSigners,
  getOrgSignedCopyUrl,
  listCompanySignatories,
  sendForSignature,
} from "@/app/(dashboard)/documents/signature-actions";
import type {
  CompanySignatory,
  DocumentSignatureState,
  SendableMode,
  SignatureRequestView,
  SignatureSignerView,
} from "@/app/(dashboard)/documents/signature-actions-impl";

function fmt(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

function signerLine(s: SignatureSignerView, orgName: string | null): string {
  const as = s.role === "company" ? ` (for ${orgName ?? "the organisation"})` : "";
  switch (s.status) {
    case "signed":
      return `${s.name}${as} signed on ${s.signedAt ? fmt(s.signedAt) : "—"}${s.markType ? ` · ${s.markType === "drawn" ? "drawn" : "typed"}` : ""}`;
    case "declined":
      return `${s.name}${as} declined${s.declinedReason ? `: “${s.declinedReason}”` : ""}`;
    case "pending":
      return `${s.name}${as} — waiting for their signature${s.sentAt ? ` (asked ${fmt(s.sentAt)})` : ""}`;
    default:
      return `${s.name}${as} — asked once the first signature is in`;
  }
}

async function openDownload(documentId: string, memberId?: string) {
  const res = await getOrgSignedCopyUrl(documentId, memberId ?? null);
  if (!res.success) {
    alert(res.error);
    return;
  }
  window.location.href = res.downloadUrl;
}

export function SignatureSection({
  documentId,
  memberView,
  readOnly,
  targetMemberName,
  onSignOff,
  onChanged,
}: {
  documentId: string;
  memberView: boolean;
  readOnly: boolean;
  /** Member documents: whose document it is. */
  targetMemberName: string | null;
  onSignOff?: (signOff: DocumentSignatureState["signOff"] | null) => void;
  onChanged?: () => void;
}) {
  const { memberLabel } = useMemberLabel();
  const [state, setState] = useState<DocumentSignatureState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Bump to re-read the state after a change.
  const [reloadKey, setReloadKey] = useState(0);
  const load = useCallback(async () => {
    setReloadKey((k) => k + 1);
  }, []);

  useEffect(() => {
    let alive = true;
    void getDocumentSignatureState(documentId).then((res) => {
      if (!alive) return;
      if (!res.success) {
        setState(null);
        onSignOff?.(null);
        return;
      }
      setState(res.state);
      onSignOff?.(res.state.signOff);
    });
    return () => {
      alive = false;
    };
  }, [documentId, onSignOff, reloadKey]);

  if (!state) return null;
  const relevant = state.signOff === "sign" || !!state.signedCopyOf || !!state.openRequest;
  if (!relevant) return null;

  const orgWord = "the organisation";
  const memberName = targetMemberName || capitalize(memberLabel);

  // ---------------------------------------------------------------- member
  if (memberView) {
    return (
      <div>
        <p className="mb-1 flex items-center gap-2 text-base font-semibold">
          <PenLine className="h-4 w-4" /> Signature
        </p>
        {state.callerCanSignAs ? (
          <div className="space-y-2">
            <p className="text-sm">
              {state.callerCanSignAs === "company"
                ? "You've been asked to sign this document on behalf of the organisation."
                : "You've been asked to read and sign this document."}
            </p>
            <Button asChild size="sm">
              <Link href={`/my-documents/sign/${documentId}`}>Read &amp; sign</Link>
            </Button>
          </div>
        ) : state.callerSignedAt ? (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">You signed this document on {fmt(state.callerSignedAt)}.</p>
            <Button size="sm" variant="outline" onClick={() => void openDownload(documentId)}>
              <Download className="mr-1.5 h-3.5 w-3.5" /> Download your signed copy
            </Button>
          </div>
        ) : state.signedCopyOf ? (
          <SignedCopySummary request={state.signedCopyOf} />
        ) : state.ownerScope === "organisation" && state.openRequest ? (
          <p className="text-sm text-muted-foreground">This document will be ready for you to sign once the organisation has signed it.</p>
        ) : state.openRequest ? (
          <ul className="space-y-1 text-sm text-muted-foreground">
            {state.openRequest.signers.map((s) => (
              <li key={`${s.role}-${s.memberId}`}>{signerLine(s, orgWord)}</li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Nothing for you to sign yet.</p>
        )}
      </div>
    );
  }

  // ----------------------------------------------------------------- admin
  return (
    <div className="space-y-3">
      <p className="flex items-center gap-2 text-base font-semibold">
        <PenLine className="h-4 w-4" /> Signature
      </p>

      {state.signedCopyOf && <SignedCopySummary request={state.signedCopyOf} />}

      {state.openRequest && (
        <div className="space-y-2 rounded-md border border-violet-200 bg-violet-50 p-3 text-sm dark:border-violet-900 dark:bg-violet-950/30">
          <p className="font-medium">Awaiting signature</p>
          <p className="text-xs text-muted-foreground">
            Sent{state.openRequest.createdByName ? ` by ${state.openRequest.createdByName}` : ""} on {fmt(state.openRequest.createdAt)}
          </p>
          {state.openRequest.message && <p className="text-xs italic text-muted-foreground">“{state.openRequest.message}”</p>}
          <ul className="space-y-1">
            {state.openRequest.signers.map((s) => (
              <li key={`${s.role}-${s.memberId}`}>{signerLine(s, orgWord)}</li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2 pt-1">
            {state.callerCanSignAs && (
              <Button asChild size="sm">
                <Link href={`/my-documents/sign/${documentId}`}>Sign now</Link>
              </Button>
            )}
            {state.canCancel && !readOnly && (
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => {
                  if (!confirm("Cancel this signature request? Signatures already given are discarded and the document can be sent again.")) return;
                  setError(null);
                  startTransition(async () => {
                    const res = await cancelSignatureRequest(documentId);
                    if (!res.success) setError(res.error);
                    invalidateSignatureBadges();
                    await load();
                    onChanged?.();
                  });
                }}
              >
                <X className="mr-1.5 h-3.5 w-3.5" /> Cancel request
              </Button>
            )}
          </div>
        </div>
      )}

      {!state.openRequest && state.lastClosedRequest && !state.signedCopyOf && (
        <p className="text-sm text-muted-foreground">
          {state.lastClosedRequest.status === "declined"
            ? (() => {
                const d = state.lastClosedRequest.signers.find((s) => s.status === "declined");
                return `Last request declined${d ? ` by ${d.name}` : ""}${d?.declinedReason ? `: “${d.declinedReason}”` : ""}.`;
              })()
            : `Last request cancelled${state.lastClosedRequest.cancelledAt ? ` on ${fmt(state.lastClosedRequest.cancelledAt)}` : ""}.`}
        </p>
      )}

      {state.audience && <AudienceCoverage documentId={documentId} audience={state.audience} memberPlural={pluralize(memberLabel)} />}

      {state.ownerScope === "member" && state.signOff === "sign" && !state.openRequest && !state.signedCopyOf && !state.lastClosedRequest && (
        <p className="text-sm text-muted-foreground">Not sent for signature yet.</p>
      )}

      {!readOnly && state.canSend && (
        <SendForm
          documentId={documentId}
          state={state}
          memberName={memberName}
          onSent={async () => {
            invalidateSignatureBadges();
            await load();
            onChanged?.();
          }}
        />
      )}
      {!readOnly && !state.canSend && state.sendBlockedReason && state.signOff === "sign" && !state.openRequest && !state.signedCopyOf && (
        <p className="text-xs text-muted-foreground">{state.sendBlockedReason}</p>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

function SignedCopySummary({ request }: { request: SignatureRequestView }) {
  return (
    <div className="rounded-md border border-green-200 bg-green-50 p-3 text-sm dark:border-green-900 dark:bg-green-950/30">
      <p className="font-medium">Signed copy{request.completedAt ? ` · completed ${fmt(request.completedAt)}` : ""}</p>
      <ul className="mt-1 space-y-1 text-muted-foreground">
        {request.signers
          .filter((s) => s.status === "signed")
          .map((s) => (
            <li key={`${s.role}-${s.memberId}`}>{signerLine(s, "the organisation")}</li>
          ))}
      </ul>
      <p className="mt-1 text-xs text-muted-foreground">The last page is the signature page with the evidence trail.</p>
    </div>
  );
}

function AudienceCoverage({
  documentId,
  audience,
  memberPlural,
}: {
  documentId: string;
  audience: NonNullable<DocumentSignatureState["audience"]>;
  memberPlural: string;
}) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<{ memberId: string; name: string; signedAt: string | null }[] | null>(null);
  const outstanding = Math.max(0, audience.expected - audience.signed);
  return (
    <div className="text-sm">
      {audience.waitingForCompany ? (
        <p className="text-muted-foreground">
          {capitalize(memberPlural)} are asked to sign once the company signatory has signed.
        </p>
      ) : (
        <p className="text-muted-foreground">
          <span className="font-medium text-foreground">
            {audience.signed} of {audience.expected}
          </span>{" "}
          signed
          {outstanding > 0 && (
            <> · <span className="font-medium text-amber-700 dark:text-amber-400">{outstanding} outstanding</span></>
          )}
        </p>
      )}
      {(audience.signed > 0 || audience.expected > 0) && (
        <Button
          variant="link"
          size="sm"
          className="h-auto px-0"
          onClick={async () => {
            const next = !open;
            setOpen(next);
            if (next && !rows) {
              const res = await getOrgDocumentSigners(documentId);
              setRows(res.success ? res.rows : []);
            }
          }}
        >
          {open ? "Hide" : "Show"} who has signed
        </Button>
      )}
      {open && (
        <ul className="mt-1 max-h-48 space-y-1 overflow-y-auto">
          {rows === null ? (
            <li className="text-muted-foreground"><Loader2 className="inline h-3.5 w-3.5 animate-spin" /> Loading…</li>
          ) : rows.length === 0 ? (
            <li className="text-muted-foreground">Nobody yet.</li>
          ) : (
            rows.map((r) => (
              <li key={r.memberId} className="flex items-center justify-between gap-2">
                <span>
                  {r.name}{" "}
                  <span className="text-muted-foreground">{r.signedAt ? `· signed ${fmt(r.signedAt)}` : "· not signed"}</span>
                </span>
                {r.signedAt && (
                  <Button variant="ghost" size="sm" className="h-7" onClick={() => void openDownload(documentId, r.memberId)}>
                    <Download className="mr-1 h-3.5 w-3.5" /> Signed copy
                  </Button>
                )}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

function SendForm({
  documentId,
  state,
  memberName,
  onSent,
}: {
  documentId: string;
  state: DocumentSignatureState;
  memberName: string;
  onSent: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<SendableMode>(state.defaultMode);
  const [signatories, setSignatories] = useState<CompanySignatory[] | null>(null);
  const [signatory, setSignatory] = useState<string>("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const needsCompany = mode === "company" || mode === "member_then_company";

  useEffect(() => {
    if (!open || signatories) return;
    void (async () => {
      const res = await listCompanySignatories();
      setSignatories(res.success ? res.signatories : []);
    })();
  }, [open, signatories]);

  const MODE_TEXT: Record<SendableMode, string> = {
    member: `${memberName} signs`,
    company: state.ownerScope === "organisation" ? "Company signatory signs before it goes out" : "Company signatory signs",
    member_then_company: `${memberName} signs, then the company signatory`,
  };

  if (!open) {
    return (
      <Button size="sm" onClick={() => setOpen(true)}>
        <Send className="mr-1.5 h-3.5 w-3.5" /> {state.ownerScope === "organisation" ? "Have the company sign first" : "Send for signature"}
      </Button>
    );
  }

  return (
    <div className="space-y-3 rounded-md border p-3">
      {state.allowedModes.length > 1 ? (
        <RadioGroup value={mode} onValueChange={(v) => setMode(v as SendableMode)} className="space-y-1">
          {state.allowedModes.map((m) => (
            <label key={m} className="flex items-center gap-2 text-sm">
              <RadioGroupItem value={m} /> {MODE_TEXT[m]}
            </label>
          ))}
        </RadioGroup>
      ) : (
        <p className="text-sm">{MODE_TEXT[state.allowedModes[0]]}</p>
      )}
      {needsCompany && (
        <div className="space-y-1">
          <Label className="text-xs">Company signatory</Label>
          {signatories === null ? (
            <p className="text-xs text-muted-foreground"><Loader2 className="inline h-3.5 w-3.5 animate-spin" /> Loading…</p>
          ) : signatories.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Nobody can sign on behalf of the organisation yet. Turn on “Sign documents on behalf of the organisation” in a User Rights profile.
            </p>
          ) : (
            <Select value={signatory} onValueChange={setSignatory}>
              <SelectTrigger><SelectValue placeholder="Choose who signs" /></SelectTrigger>
              <SelectContent>
                {signatories.map((s) => (
                  <SelectItem key={s.memberId} value={s.memberId}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      )}
      <div className="space-y-1">
        <Label className="text-xs">Message (optional)</Label>
        <Textarea value={message} maxLength={2000} rows={2} onChange={(e) => setMessage(e.target.value)} />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={pending || (needsCompany && !signatory)}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              const res = await sendForSignature(documentId, { mode, signatoryMemberId: needsCompany ? signatory : null, message });
              if (!res.success) {
                setError(res.error);
                return;
              }
              setOpen(false);
              await onSent();
            });
          }}
        >
          {pending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
          Send
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
      </div>
    </div>
  );
}
