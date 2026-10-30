"use client";

// CLE-236 — Row pills for signing documents, one per signing party (same
// as Settings → Documents): person icon + "Sign" for the member, house
// icon + "Sign" for the organisation (company signatory). Colour = that
// party's state — dashed grey: not sent yet (senders only); violet:
// waiting; solid violet: waiting for the viewer; green "Signed"; red
// "Declined". The tooltip names the signer and when / what's next.
// `useSignatureBadges(ids)` fetches them for a list in one call.

import { useEffect, useMemo, useState } from "react";
import { House, User } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useMemberLabel } from "@/contexts/member-label-context";
import { capitalize } from "@/lib/label-utils";
import { getSignatureBadges } from "@/app/(dashboard)/documents/signature-actions";
import type { SignatureBadge as Badge } from "@/app/(dashboard)/documents/signature-actions-impl";

export function useSignatureBadges(documentIds: string[]): Record<string, Badge> {
  const key = useMemo(() => [...documentIds].sort().join(","), [documentIds]);
  const [badges, setBadges] = useState<Record<string, Badge>>({});
  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    void (async () => {
      const res = await getSignatureBadges(key.split(","));
      if (!cancelled && res.success) setBadges(res.badges);
    })();
    return () => {
      cancelled = true;
    };
  }, [key]);
  return badges;
}

function fmt(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

type Tone = "todo" | "mine" | "done" | "declined" | "notSent";
const PILL: Record<Tone, string> = {
  // Waiting for someone else.
  todo: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300",
  // The viewer is asked to sign.
  mine: "bg-violet-600 font-medium text-white dark:bg-violet-500",
  done: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
  declined: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  notSent: "border border-dashed border-slate-400 bg-slate-50 text-slate-600 dark:border-slate-500 dark:bg-slate-800 dark:text-slate-300",
};

interface PillSpec {
  role: "member" | "company";
  tone: Tone;
  label: string;
  tip: string[];
}

/** One pill per signing party — a person icon + "Sign" for the member, a
 *  house icon + "Sign" for the organisation (same as Settings →
 *  Documents). Colour = that party's state; the tooltip says who and
 *  where they are. */
export function SignatureBadge({ badge }: { badge: Badge | undefined }) {
  const { memberLabel } = useMemberLabel();
  if (!badge) return null;
  const Member = capitalize(memberLabel);
  const pills: PillSpec[] = [];

  const fromSigner = (sg: Badge["signers"][number]): PillSpec => {
    const who = sg.role === "member" ? `${sg.name} (${Member})` : `${sg.name}, for the organisation`;
    const mine = badge.kind === "to_sign" && badge.callerRole === sg.role && sg.status === "pending";
    switch (sg.status) {
      case "signed":
        return { role: sg.role, tone: "done", label: "Signed", tip: [`${who} signed${sg.signedAt ? ` on ${fmt(sg.signedAt)}` : ""}.`] };
      case "declined":
        return { role: sg.role, tone: "declined", label: "Declined", tip: [`${who} declined to sign.`] };
      case "waiting":
        return { role: sg.role, tone: "todo", label: "Sign", tip: [`${who} is asked once the ${memberLabel} has signed.`] };
      default:
        return {
          role: sg.role,
          tone: mine ? "mine" : "todo",
          label: "Sign",
          tip: [mine ? "Waiting for your signature." : `Waiting for ${who} to sign.`],
        };
    }
  };

  if (badge.kind === "not_sent") {
    const mode = badge.defaultMode ?? "member";
    const tip = (role: "member" | "company") => [
      "Not sent for signature yet.",
      role === "member" ? `The ${memberLabel} usually signs.` : "A company signatory usually signs for the organisation.",
      "Open the document to send it.",
    ];
    if (mode !== "company") pills.push({ role: "member", tone: "notSent", label: "Sign", tip: tip("member") });
    if (mode !== "member") pills.push({ role: "company", tone: "notSent", label: "Sign", tip: tip("company") });
  } else if (badge.signers.length > 0) {
    for (const sg of badge.signers) pills.push(fromSigner(sg));
    // Org documents: after the company signs, the viewer (a member) signs too.
    if (badge.kind === "to_sign" && badge.callerRole === "member" && !badge.signers.some((x) => x.role === "member")) {
      pills.unshift({ role: "member", tone: "mine", label: "Sign", tip: ["Waiting for your signature."] });
    }
  } else if (badge.kind === "to_sign") {
    pills.push({
      role: badge.callerRole ?? "member",
      tone: "mine",
      label: "Sign",
      tip: [
        badge.ownerScope === "organisation"
          ? `Every ${memberLabel} this document is visible to is asked to sign it — waiting for your signature.`
          : "Waiting for your signature.",
      ],
    });
  } else if (badge.kind === "signed") {
    pills.push({ role: "member", tone: "done", label: "Signed", tip: ["You've signed this document."] });
  }

  if (pills.length === 0) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {pills.map((p, i) => (
        <Tooltip key={i}>
          <TooltipTrigger asChild>
            <span className={`inline-flex cursor-default items-center gap-1 rounded-full px-2 py-0.5 text-xs ${PILL[p.tone]}`}>
              {p.role === "member" ? (
                <User className="h-3 w-3" aria-label={Member} />
              ) : (
                <House className="h-3 w-3" aria-label="Organisation" />
              )}
              {p.label}
            </span>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs">
            {p.tip.map((l, j) => (
              <p key={j}>{l}</p>
            ))}
          </TooltipContent>
        </Tooltip>
      ))}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Batched per-row loader: drop <SignatureBadgeFor documentId={…} /> into any
// row; ids requested in the same tick are fetched in one call and cached
// briefly so re-renders don't refetch.
// ---------------------------------------------------------------------------

const CACHE_MS = 10_000;
const cache = new Map<string, { at: number; badge: Badge | null }>();
let queue: Set<string> | null = null;
const waiters = new Map<string, Array<(b: Badge | null) => void>>();

function requestBadge(id: string): Promise<Badge | null> {
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < CACHE_MS) return Promise.resolve(hit.badge);
  return new Promise((resolve) => {
    const list = waiters.get(id) ?? [];
    list.push(resolve);
    waiters.set(id, list);
    if (!queue) {
      queue = new Set();
      setTimeout(async () => {
        const ids = Array.from(queue ?? []);
        queue = null;
        const res = await getSignatureBadges(ids).catch(() => null);
        const badges = res && res.success ? res.badges : {};
        for (const i of ids) {
          const b = badges[i] ?? null;
          cache.set(i, { at: Date.now(), badge: b });
          for (const w of waiters.get(i) ?? []) w(b);
          waiters.delete(i);
        }
      }, 0);
    }
    queue.add(id);
  });
}

/** Forget cached badges (call after signing / sending). */
export function invalidateSignatureBadges() {
  cache.clear();
}

export function SignatureBadgeFor({ documentId }: { documentId: string }) {
  const [badge, setBadge] = useState<Badge | null>(null);
  useEffect(() => {
    let alive = true;
    void requestBadge(documentId).then((b) => {
      if (alive) setBadge(b);
    });
    return () => {
      alive = false;
    };
  }, [documentId]);
  return <SignatureBadge badge={badge ?? undefined} />;
}
