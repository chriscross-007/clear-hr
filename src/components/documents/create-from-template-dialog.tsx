"use client";

// CLE-237 — "Create from template" on a member's Docs page (Employment /
// Other tabs). Pick a template → check screen (every merge field with
// the value that will be used; empty values and ask.* questions can be
// filled in for this document only) → Generate. The caller then opens
// the new document's Details dialog, where a Sign kind offers
// "Send for signature".

import { useEffect, useState } from "react";
import { AlertTriangle, FileText, Loader2, PenLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useMemberLabel } from "@/contexts/member-label-context";
import { cn } from "@/lib/utils";
import { generateDocumentFromTemplate, getTemplateGenerationData } from "@/app/(dashboard)/documents/template-actions";
import type { GenerationData, TemplateForMember } from "@/app/(dashboard)/documents/template-types";

export function CreateFromTemplateDialog({
  memberId,
  memberName,
  templates,
  onClose,
  onCreated,
}: {
  memberId: string;
  memberName: string;
  templates: TemplateForMember[];
  onClose: () => void;
  onCreated: (documentId: string) => void | Promise<void>;
}) {
  const { memberLabel } = useMemberLabel();
  const [templateId, setTemplateId] = useState<string | null>(templates.length === 1 ? templates[0].id : null);
  const [data, setData] = useState<GenerationData | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!templateId) return;
    let cancelled = false;
    Promise.resolve().then(() => {
      if (!cancelled) setLoadingId(templateId);
    });
    getTemplateGenerationData(templateId, memberId).then((res) => {
      if (cancelled) return;
      setLoadingId(null);
      if (!res.success) {
        setError(res.error);
        return;
      }
      setError(null);
      setData(res.data);
      setValues({});
    });
    return () => {
      cancelled = true;
    };
  }, [templateId, memberId]);

  const editable = (data?.fields ?? []).filter((f) => f.kind === "ask" || f.value === "");
  const fixed = (data?.fields ?? []).filter((f) => !(f.kind === "ask" || f.value === ""));
  const missingAsk = (data?.fields ?? []).some((f) => f.kind === "ask" && !(values[f.tag] ?? "").trim());
  const canGenerate = Boolean(data) && !generating && !missingAsk && data!.rendererReady && data!.blockedSensitive.length === 0;

  async function generate() {
    if (!data) return;
    setGenerating(true);
    setError(null);
    const payload: Record<string, string> = {};
    for (const [k, v] of Object.entries(values)) if (v.trim()) payload[k] = v.trim();
    const res = await generateDocumentFromTemplate(data.templateId, memberId, payload);
    setGenerating(false);
    if (!res.success) {
      setError(res.error);
      return;
    }
    await onCreated(res.documentId);
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !generating) onClose(); }}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Create from template</DialogTitle>
          <DialogDescription>
            {data ? `${data.templateName} for ${memberName}` : `Choose a template for ${memberName}.`}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-4 overflow-y-auto px-1">
          {!data && (
            <ul className="space-y-1.5">
              {templates.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    className={cn(
                      "flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-left text-sm hover:bg-muted/50",
                      templateId === t.id && "border-primary",
                    )}
                    onClick={() => setTemplateId(t.id)}
                  >
                    <span className="inline-flex items-center gap-2">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium">{t.name}</span>
                    </span>
                    <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                      {t.subtypeName}
                      {loadingId === t.id && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {data && (
            <>
              {!data.rendererReady && (
                <Notice>PDF conversion isn&apos;t set up yet, so documents can&apos;t be generated.</Notice>
              )}
              {data.blockedSensitive.length > 0 && (
                <Notice>
                  This template uses sensitive fields you can&apos;t view ({data.blockedSensitive.join(", ")}), so you can&apos;t generate it.
                </Notice>
              )}

              {editable.length > 0 && (
                <div className="space-y-3">
                  {editable.map((f) => (
                    <div key={f.tag} className="space-y-1">
                      <Label htmlFor={`tf-${f.tag}`} className="flex items-center gap-1.5">
                        {f.kind === "ask" ? <PenLine className="h-3.5 w-3.5 text-blue-600" /> : <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />}
                        {f.label}
                        {f.kind === "ask" ? <span className="text-destructive">*</span> : null}
                      </Label>
                      <Input
                        id={`tf-${f.tag}`}
                        value={values[f.tag] ?? ""}
                        maxLength={2000}
                        className={cn(f.kind !== "ask" && !(values[f.tag] ?? "").trim() && "border-amber-400")}
                        placeholder={f.kind === "ask" ? "" : `Empty on the ${memberLabel}'s record — fill in for this document, or leave blank`}
                        onChange={(e) => setValues((v) => ({ ...v, [f.tag]: e.target.value }))}
                      />
                    </div>
                  ))}
                </div>
              )}

              {fixed.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground">From records</p>
                  <dl className="divide-y rounded-md border text-sm">
                    {fixed.map((f) => (
                      <div key={f.tag} className="flex justify-between gap-3 px-3 py-1.5">
                        <dt className="text-muted-foreground">{f.label}</dt>
                        <dd className="text-right font-medium">{f.value}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )}

              <p className="text-xs text-muted-foreground">
                Filed as a new {data.subtypeName} PDF (template v{data.versionNumber}).
                {data.signOff === "sign" ? " You can send it for signature next." : ""}
              </p>
              {templates.length > 1 && (
                <button
                  type="button"
                  className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                  onClick={() => {
                    setData(null);
                    setTemplateId(null);
                    setError(null);
                  }}
                >
                  Choose a different template
                </button>
              )}
            </>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" disabled={generating} onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" disabled={!canGenerate} onClick={() => void generate()}>
            {generating && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            {generating ? "Generating…" : "Generate"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{children}</span>
    </div>
  );
}
