"use server";

import { createClient } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getStripe } from "@/lib/stripe";
import { type PlanName, getStripePriceId } from "@/lib/billing-config";
import { headers } from "next/headers";

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

async function getOwnerMembership() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  const { data: membership } = await supabase
    .from("members")
    .select("organisation_id, role")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  if (!membership) throw new Error("No organisation");
  if (membership.role !== "owner") throw new Error("Only the owner can manage billing");

  return membership;
}

async function ensureStripeCustomer(orgId: string): Promise<string> {
  const admin = createAdminClient();
  const { data: org } = await admin
    .from("organisations")
    .select("id, name, stripe_customer_id")
    .eq("id", orgId)
    .single();

  if (!org) throw new Error("Organisation not found");
  if (org.stripe_customer_id) return org.stripe_customer_id;

  const customer = await getStripe().customers.create({
    name: org.name,
    metadata: { organisation_id: orgId },
  });

  await admin
    .from("organisations")
    .update({ stripe_customer_id: customer.id })
    .eq("id", orgId);

  return customer.id;
}

export async function syncSubscriptionFromStripe(): Promise<void> {
  try {
    const membership = await getOwnerMembership();
    const admin = createAdminClient();

    const { data: org } = await admin
      .from("organisations")
      .select("id, stripe_customer_id, stripe_subscription_id")
      .eq("id", membership.organisation_id)
      .single();

    if (!org?.stripe_customer_id) return;

    // Already synced
    if (org.stripe_subscription_id) return;

    // Look up the customer's subscriptions in Stripe
    const subscriptions = await getStripe().subscriptions.list({
      customer: org.stripe_customer_id,
      limit: 1,
    });

    const subscription = subscriptions.data[0];
    if (!subscription) return;

    const updateData: Record<string, unknown> = {
      stripe_subscription_id: subscription.id,
      subscription_status: subscription.status,
      trial_ends_at: subscription.trial_end
        ? new Date(subscription.trial_end * 1000).toISOString()
        : null,
    };

    if ("current_period_end" in subscription) {
      updateData.current_period_end = new Date(
        (subscription as unknown as { current_period_end: number }).current_period_end * 1000
      ).toISOString();
    }

    await admin
      .from("organisations")
      .update(updateData)
      .eq("id", org.id);
  } catch {
    // Non-critical — webhook will eventually sync
  }
}

export async function createCheckoutSession(): Promise<{
  url: string | null;
  error?: string;
}> {
  try {
    const membership = await getOwnerMembership();
    const admin = createAdminClient();

    const { data: org } = await admin
      .from("organisations")
      .select("id, plan, trial_ends_at, stripe_customer_id")
      .eq("id", membership.organisation_id)
      .single();

    if (!org) return { url: null, error: "Organisation not found" };

    const customerId = await ensureStripeCustomer(org.id);

    // Check if this customer already has a subscription in Stripe
    const existing = await getStripe().subscriptions.list({
      customer: customerId,
      limit: 1,
    });

    if (existing.data.length > 0) {
      // Subscription exists — sync it to our DB and redirect to portal instead
      const subscription = existing.data[0];
      await admin
        .from("organisations")
        .update({
          stripe_subscription_id: subscription.id,
          subscription_status: subscription.status,
          trial_ends_at: subscription.trial_end
            ? new Date(subscription.trial_end * 1000).toISOString()
            : null,
        })
        .eq("id", org.id);

      // Open portal so they can manage their existing subscription
      const headersList = await headers();
      const origin = headersList.get("origin") || headersList.get("referer")?.replace(/\/[^/]*$/, "") || "";

      const portal = await getStripe().billingPortal.sessions.create({
        customer: customerId,
        return_url: `${origin}/billing`,
      });

      return { url: portal.url };
    }

    const { data: orgFull } = await admin
      .from("organisations")
      .select("max_employees")
      .eq("id", org.id)
      .single();

    const stripePriceId = getStripePriceId(org.plan as PlanName);
    if (!stripePriceId) {
      return { url: null, error: "Plan price not configured" };
    }

    const headersList = await headers();
    const origin = headersList.get("origin") || headersList.get("referer")?.replace(/\/[^/]*$/, "") || "";

    const trialEnd = org.trial_ends_at && new Date(org.trial_ends_at) > new Date()
      ? Math.floor(new Date(org.trial_ends_at).getTime() / 1000)
      : undefined;

    const session = await getStripe().checkout.sessions.create({
      customer: customerId,
      mode: "subscription",
      currency: "gbp",
      line_items: [
        {
          price: stripePriceId,
          quantity: orgFull?.max_employees || 1,
        },
      ],
      subscription_data: {
        trial_end: trialEnd,
        metadata: { organisation_id: org.id },
      },
      success_url: `${origin}/billing?success=true`,
      cancel_url: `${origin}/billing`,
    });

    return { url: session.url };
  } catch (e) {
    return { url: null, error: (e as Error).message };
  }
}

export async function createPortalSession(): Promise<{
  url: string | null;
  error?: string;
}> {
  try {
    const membership = await getOwnerMembership();
    const admin = createAdminClient();

    const { data: org } = await admin
      .from("organisations")
      .select("stripe_customer_id")
      .eq("id", membership.organisation_id)
      .single();

    if (!org?.stripe_customer_id) {
      return { url: null, error: "No billing account found. Please subscribe first." };
    }

    const headersList = await headers();
    const origin = headersList.get("origin") || headersList.get("referer")?.replace(/\/[^/]*$/, "") || "";

    const session = await getStripe().billingPortal.sessions.create({
      customer: org.stripe_customer_id,
      return_url: `${origin}/billing`,
    });

    return { url: session.url };
  } catch (e) {
    return { url: null, error: (e as Error).message };
  }
}

export async function switchPlan(
  newPlan: PlanName
): Promise<{ success: boolean; error?: string }> {
  try {
    const membership = await getOwnerMembership();
    const admin = createAdminClient();

    const { data: org } = await admin
      .from("organisations")
      .select("id, plan, stripe_subscription_id, subscription_status")
      .eq("id", membership.organisation_id)
      .single();

    if (!org) return { success: false, error: "Organisation not found" };

    // Update local plan field
    await admin
      .from("organisations")
      .update({ plan: newPlan })
      .eq("id", org.id);

    // If no Stripe subscription yet, just update the DB
    if (!org.stripe_subscription_id) return { success: true };

    const stripePriceId = getStripePriceId(newPlan);
    if (!stripePriceId) {
      return { success: false, error: "Plan price not configured" };
    }

    const subscription = await getStripe().subscriptions.retrieve(
      org.stripe_subscription_id
    );

    await getStripe().subscriptions.update(org.stripe_subscription_id, {
      items: [
        {
          id: subscription.items.data[0].id,
          price: stripePriceId,
        },
      ],
      proration_behavior:
        org.subscription_status === "trialing" ? "none" : "create_prorations",
    });

    return { success: true };
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}

export async function updateMaxEmployees(
  newMax: number
): Promise<{ success: boolean; error?: string }> {
  try {
    const membership = await getOwnerMembership();
    const admin = createAdminClient();

    if (newMax < 1) return { success: false, error: "Must have at least 1" };

    // Cannot go below the current actual employee count
    const { count } = await admin
      .from("members")
      .select("id", { count: "exact", head: true })
      .eq("organisation_id", membership.organisation_id);

    const currentCount = count ?? 0;
    if (newMax < currentCount) {
      return {
        success: false,
        error: `Cannot set below ${currentCount} — you currently have ${currentCount} members`,
      };
    }

    // Update the DB
    await admin
      .from("organisations")
      .update({ max_employees: newMax })
      .eq("id", membership.organisation_id);

    // Sync quantity to Stripe if subscription exists
    const { data: org } = await admin
      .from("organisations")
      .select("stripe_subscription_id, subscription_status")
      .eq("id", membership.organisation_id)
      .single();

    if (org?.stripe_subscription_id) {
      const subscription = await getStripe().subscriptions.retrieve(
        org.stripe_subscription_id
      );

      await getStripe().subscriptions.update(org.stripe_subscription_id, {
        items: [
          {
            id: subscription.items.data[0].id,
            quantity: newMax,
          },
        ],
        proration_behavior:
          org.subscription_status === "trialing" ? "none" : "create_prorations",
      });
    }

    return { success: true };
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}
