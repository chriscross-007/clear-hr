import { NextResponse } from "next/server";
import { verifyCaller } from "../lib";

/**
 * GET /api/mobile/document-subtypes
 *
 * Returns the tenant's member-scope document subtypes for the mobile
 * ad-hoc capture flow's subtype picker. Org-scope subtypes
 * (`organisation_document`) are excluded — org docs are uploaded via
 * the web only.
 *
 * Ordered by (type, sort_order, name). Includes `expiryRequired` so
 * the mobile UI knows whether to prompt for an expiry date.
 */
export async function GET(request: Request) {
  try {
    const v = await verifyCaller(request);
    if ("error" in v) return NextResponse.json({ error: v.error }, { status: v.status });
    const { admin, organisationId } = v;

    const { data, error } = await admin
      .from("document_subtype")
      .select("id, type, name, sort_order, expiry_required, default_expiry_months")
      .eq("organisation_id", organisationId)
      .neq("type", "organisation_document")
      .order("type", { ascending: true })
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const subtypes = (data ?? []).map((s) => ({
      id: s.id as string,
      type: s.type as string,
      name: s.name as string,
      sortOrder: (s.sort_order as number) ?? 0,
      expiryRequired: s.expiry_required === true,
      defaultExpiryMonths: (s.default_expiry_months as number | null) ?? null,
    }));

    return NextResponse.json({ success: true, subtypes });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
