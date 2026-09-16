"use client";

// CLE-218 follow-up — Zero-dep flash notice.
//
// Centre-of-screen attention alert. Reads message + tone from URL
// search params, shows for 5 seconds, then clears itself. Loud on
// purpose — this fires on context-changing events (view-mode
// switch, etc.) where the user needs to notice.
//
// Implementation note — timer robustness (two attempts, this is #2).
//
// Attempt #1 kept everything in one effect keyed on `flash`. Bug:
// the URL-strip changed `sp` which flipped `flash` to null, which
// re-ran the effect, which fired the cleanup, which cancelled the
// dismiss timer before it could run. The pill stuck forever.
//
// Attempt #2 (this one) splits the concerns:
//  - Effect A reads the URL, sets `message` state, strips the URL.
//    No cleanup — safe to re-run.
//  - Effect B watches `message`. When it becomes truthy it starts
//    the 5s timer. Its cleanup only fires when `message` itself
//    changes (or on unmount), not when the URL churns. Timer
//    survives the router.replace round-trip.
//
// A `useRef` guard prevents the same flash text from being shown
// twice if the URL somehow lingers.
//
// The repo has no `sonner` / shadcn Toast primitive installed. When
// we want a proper toast pipeline later (multi-message queue,
// dismiss button, action buttons), swap this for `sonner` — the
// call sites just need to switch from
// `router.push(url + "?flash=…")` to `toast("…")` and this file can
// be deleted.
//
// Query param contract:
//   ?flash=<message>&flashTone=success|info|error   (tone optional)

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

const DURATION_MS = 5000;

const TONE_CLASSES: Record<string, string> = {
  success: "bg-green-600 border-green-700 text-white",
  info: "bg-blue-600 border-blue-700 text-white",
  error: "bg-red-600 border-red-700 text-white",
};

export function FlashNotice() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const flash = sp.get("flash");
  const tone = sp.get("flashTone") ?? "info";

  const [message, setMessage] = useState<string | null>(null);
  const [activeTone, setActiveTone] = useState<string>("info");
  const shownRef = useRef<string | null>(null);

  // Effect A — read URL, seed state, strip params. Deliberately no
  // cleanup so re-runs (triggered by the URL strip itself) don't
  // undo anything.
  useEffect(() => {
    if (!flash) return;
    if (shownRef.current === flash) return;
    shownRef.current = flash;

    setMessage(flash);
    setActiveTone(tone);

    const next = new URLSearchParams(sp.toString());
    next.delete("flash");
    next.delete("flashTone");
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flash]);

  // Effect B — auto-dismiss. Only reacts to `message` changing, so
  // the URL churn from Effect A doesn't kill the timer.
  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => {
      setMessage(null);
      // Reset the shown guard once the pill is gone, so a repeated
      // "same message" flash (rare, e.g. toggling view twice with
      // identical text) can still fire next time.
      shownRef.current = null;
    }, DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [message]);

  if (!message) return null;
  const toneClass = TONE_CLASSES[activeTone] ?? TONE_CLASSES.info;
  return (
    <div
      className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center p-4"
      aria-live="polite"
    >
      <div
        role="status"
        className={`pointer-events-auto max-w-lg rounded-xl border-2 px-8 py-6 text-center text-lg font-semibold shadow-2xl ${toneClass}`}
      >
        {message}
      </div>
    </div>
  );
}
