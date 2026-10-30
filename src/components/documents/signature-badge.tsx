"use client";

// CLE-236 — Row pills for signing documents: "Please sign" (the viewer
// can sign it), "Awaiting signature" (out for signature) and "Signed".
// `useSignatureBadges(ids)` fetches them for a list in one call.

import { useEffect, useMemo, useState } from "react";
import { PenLine } from "lucide-react";
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

export function SignatureBadge({ badge }: { badge: Badge | undefined }) {
  if (!badge) return null;
  if (badge === "to_sign") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-800 dark:bg-violet-900/40 dark:text-violet-200">
        <PenLine className="h-3 w-3" /> Please sign
      </span>
    );
  }
  if (badge === "awaiting") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-xs text-violet-700 ring-1 ring-violet-200 dark:bg-violet-950/40 dark:text-violet-300 dark:ring-violet-800">
        <PenLine className="h-3 w-3" /> Awaiting signature
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-xs text-green-700 ring-1 ring-green-200 dark:bg-green-950/40 dark:text-green-300 dark:ring-green-800">
      <PenLine className="h-3 w-3" /> Signed
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
