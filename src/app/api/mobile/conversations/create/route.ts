import { NextResponse } from "next/server";
import { verifyCaller } from "../../lib";

/**
 * POST /api/mobile/conversations/create
 * Body: { bookingId }
 * Returns the existing conversation for the booking, or creates one.
 * Employees can only create conversations on their own bookings.
 */
export async function POST(request: Request) {
  console.log("[mobile/conversations/create] POST hit");
  try {
    const v = await verifyCaller(request);
    if ("error" in v) return NextResponse.json({ error: v.error }, { status: v.status });
    const { admin, user, organisationId } = v;

    const { data: callerMember } = await admin
      .from("members")
      .select("id, role")
      .eq("user_id", user.id)
      .eq("organisation_id", organisationId)
      .single();
    if (!callerMember) return NextResponse.json({ error: "Member not found" }, { status: 404 });

    let body: { bookingId?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    if (!body.bookingId) return NextResponse.json({ error: "bookingId required" }, { status: 400 });

    // Verify the booking is in the org. If caller is an employee, also verify it's their own.
    const { data: booking } = await admin
      .from("holiday_bookings")
      .select("id, member_id, organisation_id")
      .eq("id", body.bookingId)
      .eq("organisation_id", organisationId)
      .single();
    if (!booking) return NextResponse.json({ error: "Booking not found" }, { status: 404 });
    if (callerMember.role === "employee" && booking.member_id !== callerMember.id) {
      return NextResponse.json({ error: "Not authorised" }, { status: 403 });
    }

    // Already exists?
    const { data: existing } = await admin
      .from("conversations")
      .select("id")
      .eq("entity_type", "absence_booking")
      .eq("entity_id", body.bookingId)
      .maybeSingle();
    if (existing) {
      return NextResponse.json({ success: true, conversationId: existing.id });
    }

    const { data: created, error: insertError } = await admin
      .from("conversations")
      .insert({
        organisation_id: organisationId,
        entity_type: "absence_booking",
        entity_id: body.bookingId,
      })
      .select("id")
      .single();
    if (insertError || !created) {
      return NextResponse.json({ error: insertError?.message ?? "Could not create conversation" }, { status: 500 });
    }
    return NextResponse.json({ success: true, conversationId: created.id });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[mobile/conversations/create] POST threw:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
