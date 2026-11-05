"use client";

// CLE-238 — The ClearHR panel in Word (Office task pane).
// Spec: Spec Vault → specs/Documents/10 Word Add-in for Templates.md
//
// Public page by design (Word loads it before anyone signs in); it holds
// no data. Everything comes from /api/word-addin/* with the panel's own
// bearer session, obtained from the /word-addin/sign-in dialog and kept
// in this page's localStorage (separate from the person's browser
// session; sign-out is local only).

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, LogOut, Plus, Search, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { capitalize } from "@/lib/label-utils";
import type { CatalogueField, CatalogueGroup } from "@/app/(dashboard)/documents/template-actions-impl";
import type { TemplateField, TemplateSubtypeOption } from "@/app/(dashboard)/documents/template-types";
import {
  documentTitle,
  getDocumentBytes,
  inWordHost,
  insertAtCursor,
  loadOffice,
  openSignInDialog,
  readDocumentTags,
  selectText,
} from "./office";

type Tab = "fields" | "check" | "send";
type CheckRow = { raw: string; field: TemplateField };
type TemplateOption = { id: string; name: string; subtypeName: string; versionNumber: number };

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function makeClient(): SupabaseClient {
  return createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { storageKey: "clearhr-word-addin", persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });
}

/** "Probation months" → "probation_months". */
function toAskName(label: string): string {
  const s = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return /^[a-z]/.test(s) ? s : s ? `q_${s}` : "";
}

export default function WordAddinPanel() {
  const supabase = useMemo(() => (typeof window === "undefined" ? null : makeClient()), []);
  const [phase, setPhase] = useState<"loading" | "not-in-word" | "signed-out" | "ready">("loading");
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("fields");

  // Catalogue
  const [memberLabel, setMemberLabel] = useState("member");
  const [fields, setFields] = useState<CatalogueField[]>([]);
  const [query, setQuery] = useState("");
  const [question, setQuestion] = useState("");
  const [flash, setFlash] = useState<string | null>(null);

  // Check
  const [checking, setChecking] = useState(false);
  const [checkRows, setCheckRows] = useState<CheckRow[] | null>(null);

  // Send
  const [sendMode, setSendMode] = useState<"new" | "version">("new");
  const [templates, setTemplates] = useState<TemplateOption[]>([]);
  const [subtypes, setSubtypes] = useState<TemplateSubtypeOption[]>([]);
  const [name, setName] = useState("");
  const [subtypeId, setSubtypeId] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<string | null>(null);

  const api = useCallback(
    async (path: string, init?: RequestInit) => {
      const { data } = await supabase!.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("signed-out");
      const res = await fetch(path, { ...init, headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${token}` } });
      if (res.status === 401) throw new Error("signed-out");
      return res.json();
    },
    [supabase],
  );

  const loadAll = useCallback(async () => {
    try {
      const [f, t] = await Promise.all([api("/api/word-addin/fields"), api("/api/word-addin/templates")]);
      if (!f.success) {
        setError(f.error ?? "Couldn't load ClearHR fields.");
        setPhase("ready");
        return;
      }
      setError(null);
      setMemberLabel(f.memberLabel || "member");
      setFields(f.fields);
      if (t.success) {
        setTemplates(t.templates);
        setSubtypes(t.subtypes);
        setSubtypeId((cur) => cur || (t.subtypes.find((s: TemplateSubtypeOption) => s.type === "contract") ?? t.subtypes[0])?.id || "");
        setTemplateId((cur) => cur || t.templates[0]?.id || "");
      }
      setPhase("ready");
    } catch (e) {
      if (e instanceof Error && e.message === "signed-out") setPhase("signed-out");
      else {
        setError(e instanceof Error ? e.message : "Couldn't reach ClearHR.");
        setPhase("ready");
      }
    }
  }, [api]);

  useEffect(() => {
    let cancelled = false;
    loadOffice().then(async ({ host }) => {
      if (cancelled) return;
      if (!inWordHost(host)) {
        setPhase("not-in-word");
        return;
      }
      setName(documentTitle());
      const { data } = await supabase!.auth.getSession();
      if (cancelled) return;
      if (!data.session) setPhase("signed-out");
      else void loadAll();
    });
    return () => {
      cancelled = true;
    };
  }, [supabase, loadAll]);

  async function signIn() {
    setError(null);
    try {
      const msg = await openSignInDialog(`${window.location.origin}/word-addin/sign-in`);
      const parsed = JSON.parse(msg) as { type?: string; access_token?: string; refresh_token?: string };
      if (parsed.type !== "clearhr-session" || !parsed.access_token || !parsed.refresh_token) throw new Error("Sign-in failed.");
      const { error: err } = await supabase!.auth.setSession({ access_token: parsed.access_token, refresh_token: parsed.refresh_token });
      if (err) throw err;
      setPhase("loading");
      await loadAll();
    } catch (e) {
      if (e instanceof Error && e.message !== "Sign-in window closed.") setError(e.message);
    }
  }

  async function signOut() {
    await supabase!.auth.signOut({ scope: "local" });
    setFields([]);
    setTemplates([]);
    setCheckRows(null);
    setPhase("signed-out");
  }

  async function insert(text: string) {
    try {
      await insertAtCursor(text);
      setFlash(`Inserted ${text}`);
      setTimeout(() => setFlash(null), 1800);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't insert into the document.");
    }
  }

  async function runCheck(): Promise<CheckRow[] | null> {
    setChecking(true);
    setError(null);
    try {
      const found = await readDocumentTags();
      if (found.length === 0) {
        setCheckRows([]);
        return [];
      }
      const res = await api("/api/word-addin/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tags: found.map((f) => f.tag) }),
      });
      if (!res.success) {
        setError(res.error);
        return null;
      }
      const byTag = new Map<string, TemplateField>((res.fields as TemplateField[]).map((f) => [f.tag, f]));
      const rows = found.map((f) => ({ raw: f.raw, field: byTag.get(f.tag)! })).filter((r) => r.field);
      setCheckRows(rows);
      return rows;
    } catch (e) {
      if (e instanceof Error && e.message === "signed-out") setPhase("signed-out");
      else setError(e instanceof Error ? e.message : "Couldn't check the document.");
      return null;
    } finally {
      setChecking(false);
    }
  }

  async function send() {
    setSending(true);
    setError(null);
    setSent(null);
    try {
      const rows = await runCheck();
      if (rows === null) return;
      if (rows.some((r) => r.field.kind === "unknown")) {
        setTab("check");
        setError("Fix the fields marked in red before sending.");
        return;
      }
      const bytes = await getDocumentBytes();
      const fd = new FormData();
      const fileName = `${(name || documentTitle() || "Template").replace(/[\\/:*?"<>|]+/g, " ").trim()}.docx`;
      fd.append("file", new File([bytes as BlobPart], fileName, { type: DOCX }));
      fd.append("mode", sendMode);
      if (sendMode === "new") {
        fd.append("name", name.trim());
        fd.append("subtypeId", subtypeId);
      } else {
        fd.append("templateId", templateId);
      }
      const res = await api("/api/word-addin/templates", { method: "POST", body: fd });
      if (!res.success) {
        setError(res.error ?? "ClearHR couldn't save the template.");
        return;
      }
      const tplName = sendMode === "new" ? name.trim() : templates.find((t) => t.id === templateId)?.name ?? "the template";
      setSent(sendMode === "new" ? `Saved as a new template: ${tplName}.` : `Saved as a new version of ${tplName}.`);
      await loadAll();
    } catch (e) {
      if (e instanceof Error && e.message === "signed-out") setPhase("signed-out");
      else setError(e instanceof Error ? e.message : "Couldn't send the document.");
    } finally {
      setSending(false);
    }
  }

  // ---------------------------------------------------------------------

  const Label_ = capitalize(memberLabel);
  const groupTitle: Record<CatalogueGroup, string> = {
    member: `${Label_} fields`,
    organisation: "Organisation",
    custom: "Custom fields",
    dates: "Dates",
  };
  const q = query.trim().toLowerCase();
  const visible = fields.filter((f) => !q || f.label.toLowerCase().includes(q) || f.tag.toLowerCase().includes(q));
  const groups = (["member", "custom", "organisation", "dates"] as CatalogueGroup[])
    .map((g) => ({ g, list: visible.filter((f) => f.group === g) }))
    .filter((x) => x.list.length > 0);
  const askName = toAskName(question);

  if (phase === "loading") {
    return (
      <Shell>
        <div className="flex justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      </Shell>
    );
  }

  if (phase === "not-in-word") {
    return (
      <Shell>
        <p className="text-sm text-muted-foreground">
          This is the ClearHR panel for Microsoft Word. Add it to Word from <strong>Settings → Documents → Templates → Get the Word
          panel</strong> in ClearHR, then open it from <strong>ClearHR fields</strong> on Word&apos;s Home tab.
        </p>
      </Shell>
    );
  }

  if (phase === "signed-out") {
    return (
      <Shell>
        <p className="text-sm text-muted-foreground">Sign in to see your organisation&apos;s merge fields and send templates to ClearHR.</p>
        <Button className="w-full" onClick={() => void signIn()}>
          Sign in to ClearHR
        </Button>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </Shell>
    );
  }

  return (
    <Shell onSignOut={() => void signOut()}>
      <div className="grid grid-cols-3 gap-1 rounded-md bg-muted p-1 text-xs font-medium">
        {(["fields", "check", "send"] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            className={cn("rounded px-2 py-1.5", tab === t ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground")}
            onClick={() => setTab(t)}
          >
            {t === "fields" ? "Fields" : t === "check" ? "Check" : "Send"}
          </button>
        ))}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {tab === "fields" && (
        <div className="space-y-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input className="pl-8" placeholder="Search fields" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <p className="text-xs text-muted-foreground">Click a field to insert it where the cursor is.</p>
          {groups.map(({ g, list }) => (
            <div key={g} className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{groupTitle[g]}</p>
              <ul className="divide-y rounded-md border">
                {list.map((f) => (
                  <li key={f.tag}>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left text-sm hover:bg-muted/60"
                      onClick={() => void insert(`{{${f.tag}}}`)}
                      title={`{{${f.tag}}}`}
                    >
                      <span className="truncate">
                        {f.label}
                        {f.sensitive && <span className="ml-1 text-xs text-amber-600 dark:text-amber-400">(sensitive)</span>}
                      </span>
                      <Plus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {groups.length === 0 && <p className="text-sm text-muted-foreground">No fields match.</p>}

          <div className="space-y-1.5 rounded-md border p-2.5">
            <Label htmlFor="wa-q" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Add a question
            </Label>
            <p className="text-xs text-muted-foreground">Asked each time a document is made from this template — e.g. Salary.</p>
            <div className="flex gap-1.5">
              <Input id="wa-q" value={question} placeholder="Question label" onChange={(e) => setQuestion(e.target.value)} />
              <Button
                type="button"
                variant="outline"
                disabled={!askName}
                onClick={() => {
                  void insert(`{{ask.${askName}}}`);
                  setQuestion("");
                }}
              >
                Insert
              </Button>
            </div>
            {askName && <p className="font-mono text-[11px] text-muted-foreground">{`{{ask.${askName}}}`}</p>}
          </div>
          {flash && <p className="text-xs text-green-700 dark:text-green-400">{flash}</p>}
        </div>
      )}

      {tab === "check" && (
        <div className="space-y-3">
          <Button type="button" variant="outline" className="w-full" disabled={checking} onClick={() => void runCheck()}>
            {checking && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Check this document
          </Button>
          {checkRows && checkRows.length === 0 && <p className="text-sm text-muted-foreground">No merge fields found in the document yet.</p>}
          {checkRows && checkRows.length > 0 && (
            <>
              {checkRows.some((r) => r.field.kind === "unknown") ? (
                <p className="flex items-start gap-1.5 text-sm text-destructive">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  Some fields aren&apos;t recognised. Click one to find it in the document.
                </p>
              ) : (
                <p className="flex items-center gap-1.5 text-sm text-green-700 dark:text-green-400">
                  <CheckCircle2 className="h-4 w-4" /> All {checkRows.length} fields are recognised.
                </p>
              )}
              <ul className="divide-y rounded-md border text-sm">
                {checkRows.map((r) => (
                  <li key={r.raw}>
                    <button
                      type="button"
                      className="flex w-full flex-col px-2.5 py-1.5 text-left hover:bg-muted/60"
                      onClick={() => void selectText(r.raw)}
                    >
                      <span className={cn("font-mono text-xs", r.field.kind === "unknown" ? "text-destructive" : "")}>{r.raw}</span>
                      <span className="text-xs text-muted-foreground">
                        {r.field.kind === "unknown"
                          ? "Not recognised"
                          : r.field.kind === "ask"
                            ? `Question: ${r.field.label}`
                            : r.field.label}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {tab === "send" && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-1 rounded-md border p-1 text-xs">
            {(["new", "version"] as const).map((m) => (
              <button
                key={m}
                type="button"
                disabled={m === "version" && templates.length === 0}
                className={cn("rounded px-2 py-1.5 disabled:opacity-50", sendMode === m ? "bg-primary text-primary-foreground" : "hover:bg-muted")}
                onClick={() => setSendMode(m)}
              >
                {m === "new" ? "New template" : "New version"}
              </button>
            ))}
          </div>

          {sendMode === "new" ? (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="wa-name">Template name</Label>
                <Input id="wa-name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="wa-kind">Produces</Label>
                <select
                  id="wa-kind"
                  className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                  value={subtypeId}
                  onChange={(e) => setSubtypeId(e.target.value)}
                >
                  <optgroup label="Employment">
                    {subtypes.filter((s) => s.type === "contract").map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Other">
                    {subtypes.filter((s) => s.type === "attachment").map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </optgroup>
                </select>
              </div>
            </>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="wa-tpl">Template</Label>
              <select
                id="wa-tpl"
                className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                value={templateId}
                onChange={(e) => setTemplateId(e.target.value)}
              >
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} (v{t.versionNumber})
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">Documents already made keep the version that made them.</p>
            </div>
          )}

          <Button
            type="button"
            className="w-full"
            disabled={sending || (sendMode === "new" ? !name.trim() || !subtypeId : !templateId)}
            onClick={() => void send()}
          >
            {sending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Send className="mr-1.5 h-4 w-4" />}
            Send to ClearHR
          </Button>
          <p className="text-xs text-muted-foreground">The document is checked first. Save it in Word too if you want to keep a copy.</p>

          {sent && (
            <div className="space-y-2 rounded-md border border-green-300 bg-green-50 p-2.5 text-sm text-green-800 dark:border-green-800 dark:bg-green-950/40 dark:text-green-200">
              <p className="flex items-start gap-1.5">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> {sent}
              </p>
              <a
                href="/settings/documents"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs font-medium underline-offset-2 hover:underline"
              >
                Open in ClearHR to preview <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          )}
        </div>
      )}
    </Shell>
  );
}

function Shell({ children, onSignOut }: { children: React.ReactNode; onSignOut?: () => void }) {
  return (
    <div className="min-h-screen space-y-4 bg-background px-3 py-4 text-foreground">
      <div className="flex items-center justify-between">
        <p className="text-base font-semibold">ClearHR fields</p>
        {onSignOut && (
          <button type="button" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" onClick={onSignOut}>
            <LogOut className="h-3 w-3" /> Sign out
          </button>
        )}
      </div>
      {children}
    </div>
  );
}
