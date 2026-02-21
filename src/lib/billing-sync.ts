import { getStripe } from "@/lib/stripe";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

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

export async function syncEmployeeCount(organisationId: string): Promise<void> {
  const admin = createAdminClient();

  const { data: org } = await admin
    .from("organisations")
    .select("stripe_subscription_id")
    .eq("id", organisationId)
    .single();

  if (!org?.stripe_subscription_id) return;

  const { count } = await admin
    .from("members")
    .select("id", { count: "exact", head: true })
    .eq("organisation_id", organisationId);

  const stripeClient = getStripe();
  const subscription = await stripeClient.subscriptions.retrieve(org.stripe_subscription_id);

  await stripeClient.subscriptions.update(org.stripe_subscription_id, {
    items: [
      {
        id: subscription.items.data[0].id,
        quantity: count || 1,
      },
    ],
    proration_behavior: "create_prorations",
  });
}
