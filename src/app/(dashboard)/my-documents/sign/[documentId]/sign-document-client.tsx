"use client";

// CLE-236 — Read the document, then sign it with a typed or drawn
// signature (or decline with a reason).

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, PenLine, Type } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PdfViewer } from "@/components/documents/pdf-viewer";
import { SignaturePad } from "@/components/documents/signature-pad";
import { invalidateSignatureBadges } from "@/components/documents/signature-badge";
import { cn } from "@/lib/utils";
import { declineSignature, signDocument } from "@/app/(dashboard)/documents/signature-actions";
import type { SigningView } from "@/app/(dashboard)/documents/signature-actions-impl";

export function SignDocumentClient({
  documentId,
  view,
  error,
}: {
  documentId: string;
  view: SigningView | null;
  error: string | null;
}) {
  const router = useRouter();
  const [markType, setMarkType] = useState<"typed" | "drawn">("typed");
  const [typedName, setTypedName] = useState(view?.callerName ?? "");
  const [drawnPng, setDrawnPng] = useState<string | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [pending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState<null | "signed" | "completed" | "declined">(null);
  const [declineOpen, setDeclineOpen] = useState(false);
  const [declineReason, setDeclineReason] = useState("");

  if (!view) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">Nothing to sign</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <p>{error ?? "There's nothing for you to sign on this document."}</p>
          <Button asChild variant="outline">
            <Link href="/dashboard">Back to dashboard</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (done) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            <CheckCircle2 className="h-5 w-5 text-green-600" />
            {done === "declined" ? "You declined to sign" : "Thank you — you've signed"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {done === "declined" ? (
            <p>We&apos;ve let the person who sent it know, with your reason.</p>
          ) : done === "completed" ? (
            <p>Everyone has now signed. The signed copy, with its signature page, has been filed with the document.</p>
          ) : view.role === "company" || view.canDecline ? (
            <p>Your signature has been recorded. The signed copy is filed once everyone has signed.</p>
          ) : (
            <p>Your signature has been recorded. You can download your signed copy from the document&apos;s details.</p>
          )}
          <div className="flex gap-2">
            <Button asChild>
              <Link href="/dashboard">Back to dashboard</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/my-documents">My documents</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const canSubmit = agreed && (markType === "typed" ? typedName.trim().length > 0 : !!drawnPng) && !pending;

  const submit = () => {
    setFormError(null);
    startTransition(async () => {
      const res = await signDocument(documentId, { markType, typedName, drawnPng, agreed });
      if (!res.success) {
        setFormError(res.error);
        return;
      }
      invalidateSignatureBadges();
      setDone(res.completed ? "completed" : "signed");
      router.refresh();
    });
  };

  const decline = () => {
    setFormError(null);
    startTransition(async () => {
      const res = await declineSignature(documentId, declineReason);
      if (!res.success) {
        setFormError(res.error);
        return;
      }
      invalidateSignatureBadges();
      setDeclineOpen(false);
      setDone("declined");
      router.refresh();
    });
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Sign {view.subtypeName}</h1>
        <p className="text-sm text-muted-foreground">
          {view.fileName}
          {view.ownerName ? ` · ${view.ownerName}` : ""}
          {view.role === "company" ? ` · signing on behalf of ${view.orgName}` : ` · from ${view.orgName}`}
        </p>
        {view.message && (
          <blockquote className="mt-3 border-l-2 pl-3 text-sm text-muted-foreground">
            {view.senderName ? <span className="font-medium text-foreground">{view.senderName}: </span> : null}
            {view.message}
          </blockquote>
        )}
      </div>

      <div className="h-[60vh] overflow-hidden rounded-md border">
        <PdfViewer url={view.url} fileName={view.fileName} showPrint={false} className="h-full" />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold">Your signature</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="inline-flex rounded-md border p-0.5" role="tablist" aria-label="How to sign">
            {(["typed", "drawn"] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={markType === t}
                onClick={() => setMarkType(t)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-sm",
                  markType === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
                )}
              >
                {t === "typed" ? <Type className="h-3.5 w-3.5" /> : <PenLine className="h-3.5 w-3.5" />}
                {t === "typed" ? "Type" : "Draw"}
              </button>
            ))}
          </div>

          {markType === "typed" ? (
            <div className="space-y-2">
              <Label htmlFor="typed-name">Type your full name</Label>
              <Input id="typed-name" value={typedName} maxLength={200} onChange={(e) => setTypedName(e.target.value)} disabled={pending} />
              <div className="flex h-20 items-center rounded-md border bg-white px-4">
                <span className="truncate font-serif text-3xl font-bold italic text-[#1a2466]">{typedName || " "}</span>
              </div>
            </div>
          ) : (
            <SignaturePad onChange={setDrawnPng} disabled={pending} />
          )}

          <label className="flex items-start gap-2 text-sm">
            <Checkbox checked={agreed} onCheckedChange={(v) => setAgreed(v === true)} disabled={pending} className="mt-0.5" />
            <span>
              I have read this document and agree to sign it electronically
              {view.role === "company" ? ` on behalf of ${view.orgName}` : ""}. My signature, the date and time, my IP address and device
              are recorded with the document.
            </span>
          </label>

          {formError && <p className="text-sm text-destructive">{formError}</p>}

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={submit} disabled={!canSubmit}>
              {pending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Sign document
            </Button>
            {view.canDecline && (
              <Button variant="ghost" onClick={() => setDeclineOpen(true)} disabled={pending}>
                Decline
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog open={declineOpen} onOpenChange={(o) => !pending && setDeclineOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Decline to sign?</DialogTitle>
            <DialogDescription>The request ends and the person who sent it is told your reason.</DialogDescription>
          </DialogHeader>
          <div className="overflow-y-auto max-h-[60vh] px-1 space-y-2">
            <Label htmlFor="decline-reason">Reason</Label>
            <Textarea id="decline-reason" value={declineReason} maxLength={2000} onChange={(e) => setDeclineReason(e.target.value)} rows={4} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeclineOpen(false)} disabled={pending}>Cancel</Button>
            <Button variant="destructive" onClick={decline} disabled={pending || !declineReason.trim()}>
              {pending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Decline
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
