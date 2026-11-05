"use client";

// CLE-238 — Sign-in window for the ClearHR panel in Word (opened with
// Office's dialog API). It signs in with a client that doesn't persist
// anything, so the panel gets its own session that never collides with
// the person's ClearHR session in a browser, then hands the tokens to
// the panel with `messageParent`. Two-step verification is handled here
// (same rule as /mfa-verify). No data is read beyond the caller's own
// membership row.

import { useEffect, useMemo, useState } from "react";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { loadOffice } from "../office";

type Step = "loading" | "not-in-word" | "credentials" | "mfa" | "done";

export default function WordAddinSignInPage() {
  const supabase = useMemo(
    () =>
      createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      }),
    [],
  );
  const [step, setStep] = useState<Step>("loading");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [factorId, setFactorId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadOffice().then(() => {
      if (cancelled) return;
      const canMessage = typeof window.Office?.context?.ui?.messageParent === "function";
      setStep(canMessage ? "credentials" : "not-in-word");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function finish() {
    const { data } = await supabase.auth.getSession();
    const s = data.session;
    if (!s) {
      setError("Sign-in didn't complete. Please try again.");
      return;
    }
    window.Office.context.ui.messageParent(
      JSON.stringify({ type: "clearhr-session", access_token: s.access_token, refresh_token: s.refresh_token }),
    );
    setStep("done");
  }

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
      if (err) return setError(err.message);
      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aal?.nextLevel === "aal2" && aal.currentLevel !== "aal2") {
        const { data: factors } = await supabase.auth.mfa.listFactors();
        const totp = factors?.totp.find((f) => f.status === "verified");
        if (!totp) return setError("Two-step verification isn't set up. Set it up in ClearHR first, then try again.");
        setFactorId(totp.id);
        setStep("mfa");
        return;
      }
      // Organisation requires two-step verification but none is set up.
      const { data: userData } = await supabase.auth.getUser();
      if (userData.user) {
        const { data: m } = await supabase
          .from("members")
          .select("organisations(require_mfa)")
          .eq("user_id", userData.user.id)
          .limit(1)
          .maybeSingle();
        const requireMfa = (m?.organisations as unknown as { require_mfa?: boolean } | null)?.require_mfa === true;
        if (requireMfa && aal?.currentLevel !== "aal2") {
          await supabase.auth.signOut({ scope: "local" });
          return setError("Your organisation requires two-step verification. Set it up in ClearHR first, then try again.");
        }
      }
      await finish();
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    if (!factorId) return;
    setBusy(true);
    setError(null);
    try {
      const { error: err } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.trim() });
      if (err) return setError(err.message);
      await finish();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 px-6 py-8">
      <div>
        <h1 className="text-xl font-semibold">Sign in to ClearHR</h1>
        <p className="text-sm text-muted-foreground">For the ClearHR panel in Word.</p>
      </div>

      {step === "loading" && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}

      {step === "not-in-word" && (
        <p className="text-sm text-muted-foreground">
          This window is opened by the ClearHR panel in Word. Open Word, choose <strong>ClearHR fields</strong> on the Home tab, then
          <strong> Sign in</strong>.
        </p>
      )}

      {step === "credentials" && (
        <form className="space-y-3" onSubmit={signIn}>
          <div className="space-y-1.5">
            <Label htmlFor="wa-email">Email</Label>
            <Input id="wa-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wa-password">Password</Label>
            <Input
              id="wa-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <Button type="submit" className="w-full" disabled={busy || !email || !password}>
            {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Sign in
          </Button>
        </form>
      )}

      {step === "mfa" && (
        <form className="space-y-3" onSubmit={verify}>
          <div className="space-y-1.5">
            <Label htmlFor="wa-code">Code from your authenticator app</Label>
            <Input
              id="wa-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              required
            />
          </div>
          <Button type="submit" className="w-full" disabled={busy || code.length !== 6}>
            {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Verify
          </Button>
        </form>
      )}

      {step === "done" && <p className="text-sm text-muted-foreground">Signed in. You can close this window.</p>}

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
