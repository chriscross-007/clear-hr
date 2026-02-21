import { NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";

function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    }
  );
}

export async function POST(request: Request) {
  const body = await request.text();
  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const admin = createAdminClient();

  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const subscription = event.data.object as Stripe.Subscription;
      const orgId = subscription.metadata.organisation_id;
      if (!orgId) break;

      const updateData: Record<string, unknown> = {
        stripe_subscription_id: subscription.id,
        subscription_status: subscription.status,
        trial_ends_at: subscription.trial_end
          ? new Date(subscription.trial_end * 1000).toISOString()
          : null,
      };

      // current_period_end may be available depending on Stripe API version
      if ("current_period_end" in subscription) {
        updateData.current_period_end = new Date(
          (subscription as unknown as { current_period_end: number }).current_period_end * 1000
        ).toISOString();
      }

      await admin
        .from("organisations")
        .update(updateData)
        .eq("id", orgId);
      break;
    }

    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      const orgId = subscription.metadata.organisation_id;
      if (!orgId) break;

      await admin
        .from("organisations")
        .update({
          subscription_status: "cancelled",
          stripe_subscription_id: null,
        })
        .eq("id", orgId);
      break;
    }

    case "invoice.payment_succeeded": {
      const invoice = event.data.object as Stripe.Invoice;
      const sub = invoice.parent?.subscription_details?.subscription;
      const subscriptionId = typeof sub === "string" ? sub : sub?.id;
      if (!subscriptionId) break;

      await admin
        .from("organisations")
        .update({ subscription_status: "active" })
        .eq("stripe_subscription_id", subscriptionId);
      break;
    }

    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      const sub = invoice.parent?.subscription_details?.subscription;
      const subscriptionId = typeof sub === "string" ? sub : sub?.id;
      if (!subscriptionId) break;

      await admin
        .from("organisations")
        .update({ subscription_status: "past_due" })
        .eq("stripe_subscription_id", subscriptionId);
      break;
    }
  }

  return NextResponse.json({ received: true });
}
