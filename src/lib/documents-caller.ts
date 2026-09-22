// CLE-227 — Shared "resolved caller" context for Documents impls.
//
// Server actions in the Documents domain and the mobile API-route
// wrappers at /api/mobile/documents/* need identical downstream logic
// but different auth preludes:
//   • Web (server actions) — Supabase session via cookies from Next
//     headers. `buildDocumentsCallerFromCookies()`.
//   • Mobile (API routes) — bearer token in `Authorization`. Verified
//     against Supabase auth to yield the same shape.
// `DocumentsCaller` is the resolved shape both preludes hand to the
// underlying impls, so the impls have exactly one signature.
//
// Impls live in sibling `*-impl.ts` files (non-`"use server"`) so the
// impl functions can be imported from BOTH the action file (via the
// cookies builder) and the mobile route (via the bearer builder). A
// `"use server"` file forces every export to be a Server Action
// callable from the client — which is the wrong lifecycle for these
// helpers.

import { createClient as createAdminClient, type SupabaseClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { getEffectiveRightsForUser } from "@/lib/rights-resolver";
import { headers } from "next/headers";
import type { EffectiveRights } from "@/lib/rights-types";

export type DocumentsCaller = {
  /** Service-role client for cross-user reads/writes. All Documents
   *  impls use `admin` for their DB work; RLS is enforced at the
   *  boundary via app-layer scope checks (owner_scope/owner_id +
   *  crossUserAccess helpers). */
  admin: SupabaseClient;
  userId: string;
  memberId: string;
  organisationId: string;
  teamId: string | null;
  rights: EffectiveRights;
  /** Client IP for audit trails. Vercel forwards it in
   *  `x-forwarded-for`; falls back to `x-real-ip`; null when neither
   *  header is present. Truncated to 200 chars defensively. */
  ip: string | null;
  /** Best-effort user-agent, truncated to 500 chars (the ack table's
   *  check-constraint cap). */
  userAgent: string | null;
};

export function getDocumentsAdminClient(): SupabaseClient {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
  );
}

async function readHeaders(): Promise<{ ip: string | null; userAgent: string | null }> {
  try {
    const h = await headers();
    const xff = h.get("x-forwarded-for");
    let ip: string | null = null;
    if (xff) {
      const first = xff.split(",")[0]?.trim();
      if (first) ip = first.slice(0, 200);
    } else {
      const real = h.get("x-real-ip");
      if (real) ip = real.slice(0, 200);
    }
    const uaRaw = h.get("user-agent");
    const userAgent = uaRaw ? (uaRaw.length > 500 ? uaRaw.slice(0, 500) : uaRaw) : null;
    return { ip, userAgent };
  } catch {
    return { ip: null, userAgent: null };
  }
}

function readHeadersFromRequest(request: Request): { ip: string | null; userAgent: string | null } {
  const xff = request.headers.get("x-forwarded-for");
  let ip: string | null = null;
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) ip = first.slice(0, 200);
  } else {
    const real = request.headers.get("x-real-ip");
    if (real) ip = real.slice(0, 200);
  }
  const uaRaw = request.headers.get("user-agent");
  const userAgent = uaRaw ? (uaRaw.length > 500 ? uaRaw.slice(0, 500) : uaRaw) : null;
  return { ip, userAgent };
}

/**
 * Web (server-action) builder. Reads the caller's Supabase session
 * from cookies via `@/lib/supabase/server`, resolves rights + ctx via
 * the rights resolver, and instantiates an admin client for DB work.
 * Returns null when the caller isn't authenticated or has no
 * membership — action files handle the null by returning their
 * standard `{ success: false, error: "Not authenticated" }` envelope.
 */
export async function buildDocumentsCallerFromCookies(): Promise<DocumentsCaller | null> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const resolved = await getEffectiveRightsForUser(user.id);
  if (!resolved) return null;
  const { rights, ctx } = resolved;
  const { ip, userAgent } = await readHeaders();
  return {
    admin: getDocumentsAdminClient(),
    userId: user.id,
    memberId: ctx.memberId,
    organisationId: ctx.organisationId,
    teamId: ctx.teamId,
    rights,
    ip,
    userAgent,
  };
}

/**
 * Mobile (bearer-token) builder. Verifies the `Authorization: Bearer
 * <token>` header against Supabase auth, resolves rights + ctx, and
 * instantiates an admin client. Returns a `{ error, status }`
 * envelope on failure so the caller can surface it as the HTTP
 * response.
 *
 * Mirrors the existing `verifyCaller` in `src/app/api/mobile/lib.ts`
 * plus rights resolution, so mobile Documents routes get the full
 * `DocumentsCaller` in one call.
 */
export async function buildDocumentsCallerFromBearer(
  request: Request,
): Promise<DocumentsCaller | { error: string; status: number }> {
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return { error: "Missing token", status: 401 };

  const admin = getDocumentsAdminClient();
  const { data: { user }, error: authErr } = await admin.auth.getUser(token);
  if (authErr || !user) return { error: "Invalid token", status: 401 };

  const resolved = await getEffectiveRightsForUser(user.id);
  if (!resolved) return { error: "No organisation", status: 403 };
  const { rights, ctx } = resolved;
  const { ip, userAgent } = readHeadersFromRequest(request);
  return {
    admin,
    userId: user.id,
    memberId: ctx.memberId,
    organisationId: ctx.organisationId,
    teamId: ctx.teamId,
    rights,
    ip,
    userAgent,
  };
}
