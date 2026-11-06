"use client";

import { Suspense, useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Eye, EyeOff } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const searchParams = useSearchParams();
  const welcome = searchParams.get("welcome");
  const welcomeName = searchParams.get("name");
  const nextPath = searchParams.get("next");
  // 2026-11-06 — email links carry `as=<recipient>`. If someone else is
  // already signed in on this browser, don't jump straight to `next`
  // (it would show *their* records) — say so and offer to switch.
  const asEmail = (searchParams.get("as") ?? "").trim().toLowerCase();
  const [signedInAs, setSignedInAs] = useState<string | null>(null);
  const [email, setEmail] = useState(asEmail);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  // If already authenticated and a next path is specified, redirect immediately
  useEffect(() => {
    if (!nextPath) return;
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      const current = (user.email ?? "").toLowerCase();
      if (asEmail && current && current !== asEmail) {
        setSignedInAs(current);
        return;
      }
      router.replace(nextPath);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setError(error.message);
      setLoading(false);
    } else {
      // Check if user has MFA factors enrolled — if so, go to verify page
      const { data: aalData } =
        await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

      if (aalData?.nextLevel === "aal2") {
        router.push("/mfa-verify");
        router.refresh();
        return;
      }

      // CLE-196b-1 — Determine the correct home page based on the
      // caller's rank via the joined rights_profile. Employee → own
      // dashboard, everyone else → the admin shell.
      const { data: { user } } = await supabase.auth.getUser();
      const { data: membership } = user
        ? await supabase
            .from("members")
            .select("rights_profiles(rank)")
            .eq("user_id", user.id)
            .limit(1)
            .single()
        : { data: null };

      const profile = membership?.rights_profiles as unknown as { rank?: string } | null;
      const defaultHome = (profile?.rank ?? "employee") === "employee" ? "/dashboard" : "/admin-dashboard";
      router.push(nextPath || defaultHome);
      router.refresh();
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">
            {welcome ? `Welcome to ${welcome}` : "Welcome back"}
          </CardTitle>
          <CardDescription>
            {welcome
              ? `Hi ${welcomeName ?? ""}, sign in to join the ClearHR portal`
              : "Sign in to your account"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {signedInAs && nextPath && (
            <div className="mb-4 space-y-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100">
              <p>
                This link was sent to <strong>{asEmail}</strong>, but this browser is signed in as{" "}
                <strong>{signedInAs}</strong>.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button asChild size="sm">
                  <a
                    href={`/logout?next=${encodeURIComponent(
                      `/login?as=${encodeURIComponent(asEmail)}&next=${encodeURIComponent(nextPath)}`,
                    )}`}
                  >
                    Sign out and continue as {asEmail}
                  </a>
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => router.replace(nextPath)}>
                  Stay as {signedInAs}
                </Button>
              </div>
            </div>
          )}
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Password</Label>
                <Link
                  href="/forgot-password"
                  className="text-sm text-muted-foreground hover:text-primary"
                >
                  Forgot password?
                </Link>
              </div>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Signing in..." : "Sign in"}
            </Button>
          </form>
          {!welcome && (
            <p className="mt-4 text-center text-sm text-muted-foreground">
              Don&apos;t have an account?{" "}
              <Link href="/signup" className="text-primary hover:underline">
                Sign up
              </Link>
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
