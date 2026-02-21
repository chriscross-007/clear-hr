export const PLANS = {
  Lite: {
    name: "Lite",
    description: "For small teams getting started",
    features: [
      "Member directory",
      "Basic leave management",
      "Email support",
    ],
    tiers: [
      { upTo: 10, pricePerEmployee: 5 },
      { upTo: 25, pricePerEmployee: 4 },
      { upTo: 50, pricePerEmployee: 3 },
      { upTo: null, pricePerEmployee: 2 },
    ],
  },
  Pro: {
    name: "Pro",
    description: "For growing organisations",
    features: [
      "Everything in Lite",
      "Performance reviews",
      "Advanced reporting",
      "Team management",
      "Priority support",
    ],
    tiers: [
      { upTo: 10, pricePerEmployee: 7 },
      { upTo: 25, pricePerEmployee: 6 },
      { upTo: 50, pricePerEmployee: 5 },
      { upTo: null, pricePerEmployee: 4 },
    ],
  },
  Enterprise: {
    name: "Enterprise",
    description: "For large organisations",
    features: [
      "Everything in Pro",
      "Custom integrations",
      "Dedicated account manager",
      "SSO & audit logs",
    ],
    tiers: [
      { upTo: 10, pricePerEmployee: 10 },
      { upTo: 25, pricePerEmployee: 8 },
      { upTo: 50, pricePerEmployee: 7 },
      { upTo: null, pricePerEmployee: 6 },
    ],
  },
} as const;

export type PlanName = keyof typeof PLANS;

/** Server-only: get the Stripe Price ID for a plan */
export function getStripePriceId(plan: PlanName): string {
  const priceIds: Record<PlanName, string | undefined> = {
    Lite: process.env.STRIPE_PRICE_LITE,
    Pro: process.env.STRIPE_PRICE_PRO,
    Enterprise: process.env.STRIPE_PRICE_ENTERPRISE,
  };
  return priceIds[plan] ?? "";
}

export function estimateMonthlyCost(plan: PlanName, employeeCount: number): number {
  const tiers = PLANS[plan].tiers as ReadonlyArray<{ upTo: number | null; pricePerEmployee: number }>;
  let total = 0;
  let remaining = employeeCount;

  for (let i = 0; i < tiers.length; i++) {
    const tier = tiers[i];
    const limit = tier.upTo ?? Infinity;
    const prevLimit = i === 0 ? 0 : (tiers[i - 1].upTo ?? 0);
    const tierCapacity = limit === Infinity ? remaining : limit - prevLimit;
    const count = Math.min(remaining, tierCapacity);
    total += count * tier.pricePerEmployee;
    remaining -= count;
    if (remaining <= 0) break;
  }

  return total;
}
