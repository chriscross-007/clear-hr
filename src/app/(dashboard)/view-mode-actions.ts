"use server";

/**
 * CLE-218 — "Switch View" toggle. Lets admin-scope callers view the
 * app as if they were an Employee (default Employee profile of the
 * org). Strict reduce; never elevates. State lives in an HttpOnly
 * cookie the resolver reads; every consumer of
 * `getEffectiveRightsForUser` picks up the effective rights
 * transparently.
 */

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  VIEW_MODE_COOKIE,
  getRealRightsForUser,
  type ViewMode,
} from "@/lib/rights-resolver";
import { logAudit } from "@/lib/audit";

// Paths an Employee-mode caller can't view. When the caller toggles
// to "self" from one of these, we redirect them to /dashboard rather
// than let them sit on a page whose page-level gate is about to
// bounce them anyway.
const ADMIN_ONLY_PATH_PREFIXES = [
  "/employees",
  "/audit",
  "/settings",
  "/documents/compliance",
  "/documents/organisation",
  "/admin-dashboard",
  "/absence-types",
  "/availability",
  "/approvals",
  "/shifts",
  "/reports",
  "/health-and-safety",
  "/billing",
];

function pathAllowedInSelfMode(pathname: string | null | undefined): boolean {
  if (!pathname) return true;
  return !ADMIN_ONLY_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

export async function getCurrentViewMode(): Promise<ViewMode> {
  try {
    const store = await cookies();
    const raw = store.get(VIEW_MODE_COOKIE)?.value;
    return raw === "self" ? "self" : "admin";
  } catch {
    return "admin";
  }
}

export async function setViewMode(
  mode: ViewMode,
  currentPath?: string
): Promise<
  | { success: true; redirectTo?: string; viewMode: ViewMode }
  | { success: false; error: string }
> {
  try {
    if (mode !== "self" && mode !== "admin") {
      return { success: false, error: "Invalid view mode" };
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { success: false, error: "Not authenticated" };

    const resolved = await getRealRightsForUser(user.id);
    if (!resolved) return { success: false, error: "Not a member" };

    // Pure employees can't switch — the toggle can never elevate.
    // Silently accept "admin" (their default state) but reject "self"
    // requests from real employees.
    if (resolved.rights.crossUserAccess === "self" && mode === "self") {
      return {
        success: false,
        error: "Only administrators can switch to Employee view",
      };
    }

    const store = await cookies();
    const previous: ViewMode =
      store.get(VIEW_MODE_COOKIE)?.value === "self" ? "self" : "admin";

    if (mode === "admin") {
      // Clearing the cookie is equivalent to "admin". Keep it explicit
      // for the sake of the client seeing a defined value.
      store.set(VIEW_MODE_COOKIE, "admin", {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 60 * 60 * 24 * 30,
      });
    } else {
      store.set(VIEW_MODE_COOKIE, "self", {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 60 * 60 * 24 * 30,
      });
    }

    // Audit — always log the toggle, even a no-op flip. Cheap and
    // useful for compliance ("who was in Employee mode when X
    // happened?"). The action's target is the caller themselves —
    // switching only affects their own session.
    const { data: member } = await supabase
      .from("members")
      .select("first_name, last_name")
      .eq("id", resolved.ctx.memberId)
      .single();
    const fallbackName = user.email ?? "Unknown";
    const targetLabel = member
      ? [member.first_name, member.last_name].filter(Boolean).join(" ") ||
        fallbackName
      : fallbackName;

    await logAudit({
      organisationId: resolved.ctx.organisationId,
      actorId: resolved.ctx.memberId,
      actorName: targetLabel,
      action: "member.view_mode_switched",
      targetType: "member",
      targetId: resolved.ctx.memberId,
      targetLabel,
      changes: { view_mode: { old: previous, new: mode } },
      metadata: { from: previous, to: mode },
    });

    // Force the whole shell + every server component to re-render with
    // the new effective rights.
    revalidatePath("/", "layout");

    // Redirect out of admin-only paths when dropping to self mode.
    let redirectTo: string | undefined;
    if (mode === "self" && !pathAllowedInSelfMode(currentPath)) {
      redirectTo = "/dashboard";
    }
    return { success: true, redirectTo, viewMode: mode };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "An error occurred",
    };
  }
}
