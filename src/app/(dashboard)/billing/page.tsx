import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { BillingClient } from "./billing-client";
import { syncSubscriptionFromStripe } from "./actions";

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const params = await searchParams;

  // After Stripe checkout redirect, sync subscription data from Stripe
  if (params.success === "true") {
    await syncSubscriptionFromStripe();
  }

  const { data: membership } = await supabase
    .from("members")
    .select("organisation_id, role, organisations(name, plan, subscription_status, trial_ends_at, stripe_subscription_id, max_employees)")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  if (!membership) redirect("/organisation-setup");
  if (membership.role !== "owner") redirect("/employees");

  const org = membership.organisations as unknown as {
    name: string;
    plan: string;
    subscription_status: string | null;
    trial_ends_at: string | null;
    stripe_subscription_id: string | null;
    max_employees: number;
  };

  // Count all members
  const { count } = await supabase
    .from("members")
    .select("id", { count: "exact", head: true })
    .eq("organisation_id", membership.organisation_id);

  return (
    <BillingClient
      plan={org.plan}
      subscriptionStatus={org.subscription_status ?? "trialing"}
      trialEndsAt={org.trial_ends_at}
      hasSubscription={!!org.stripe_subscription_id}
      employeeCount={count ?? 0}
      maxEmployees={org.max_employees}
    />
  );
}
