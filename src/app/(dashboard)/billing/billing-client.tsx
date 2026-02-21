"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PLANS, type PlanName, estimateMonthlyCost } from "@/lib/billing-config";
import { createCheckoutSession, createPortalSession, switchPlan, updateMaxEmployees } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Check, Minus, Plus } from "lucide-react";
import { useMemberLabel } from "@/contexts/member-label-context";
import { capitalize, pluralize } from "@/lib/label-utils";

interface BillingClientProps {
  plan: string;
  subscriptionStatus: string;
  trialEndsAt: string | null;
  hasSubscription: boolean;
  employeeCount: number;
  maxEmployees: number;
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    trialing: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
    active: "bg-green-500/10 text-green-700 dark:text-green-400",
    past_due: "bg-red-500/10 text-red-700 dark:text-red-400",
    cancelled: "bg-muted text-muted-foreground",
    unpaid: "bg-red-500/10 text-red-700 dark:text-red-400",
    incomplete: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  };

  const labels: Record<string, string> = {
    trialing: "Trial",
    active: "Active",
    past_due: "Past Due",
    cancelled: "Cancelled",
    unpaid: "Unpaid",
    incomplete: "Incomplete",
  };

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${styles[status] ?? styles.cancelled}`}
    >
      {labels[status] ?? status}
    </span>
  );
}

export function BillingClient({
  plan,
  subscriptionStatus,
  trialEndsAt,
  hasSubscription,
  employeeCount,
  maxEmployees,
}: BillingClientProps) {
  const router = useRouter();
  const { memberLabel } = useMemberLabel();
  const label = memberLabel.toLowerCase();
  const labelPlural = pluralize(label);
  const [currentPlan, setCurrentPlan] = useState(plan);
  const [currentMax, setCurrentMax] = useState(maxEmployees);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const daysRemaining = trialEndsAt
    ? Math.max(0, Math.ceil((new Date(trialEndsAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
    : 0;

  const estimatedCost = estimateMonthlyCost(currentPlan as PlanName, currentMax);

  async function handleSwitchPlan(newPlan: PlanName) {
    setLoading(newPlan);
    setError(null);
    const result = await switchPlan(newPlan);
    if (result.success) {
      setCurrentPlan(newPlan);
      router.refresh();
    } else {
      setError(result.error ?? "Failed to switch plan");
    }
    setLoading(null);
  }

  async function handleCheckout() {
    setLoading("checkout");
    setError(null);
    const result = await createCheckoutSession();
    if (result.url) {
      window.location.href = result.url;
    } else {
      setError(result.error ?? "Failed to create checkout session");
      setLoading(null);
    }
  }

  async function handlePortal() {
    setLoading("portal");
    setError(null);
    const result = await createPortalSession();
    if (result.url) {
      window.location.href = result.url;
    } else {
      setError(result.error ?? "Failed to open billing portal");
      setLoading(null);
    }
  }

  async function handleUpdateMax(newMax: number) {
    if (newMax === currentMax) return;
    setLoading("max");
    setError(null);
    const result = await updateMaxEmployees(newMax);
    if (result.success) {
      setCurrentMax(newMax);
      router.refresh();
    } else {
      setError(result.error ?? "Failed to update limit");
    }
    setLoading(null);
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-bold mb-6">Billing</h1>

      {error && (
        <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive mb-6">
          {error}
        </div>
      )}

      {/* Current plan summary */}
      <Card className="mb-8">
        <CardHeader>
          <div className="flex items-center gap-3">
            <CardTitle>Current Plan: {currentPlan}</CardTitle>
            <StatusBadge status={subscriptionStatus} />
          </div>
          <CardDescription>
            {subscriptionStatus === "trialing" && daysRemaining > 0 && (
              <>{daysRemaining} day{daysRemaining !== 1 ? "s" : ""} remaining in your free trial. </>
            )}
            {employeeCount} of {currentMax} {capitalize(labelPlural)} used — estimated{" "}
            <strong>£{estimatedCost}/month</strong>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <span className="text-sm font-medium whitespace-nowrap">
              Max {capitalize(labelPlural)}:
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                disabled={currentMax <= employeeCount || loading === "max"}
                onClick={() => handleUpdateMax(currentMax - 1)}
              >
                <Minus className="h-4 w-4" />
              </Button>
              <Input
                type="number"
                min={employeeCount}
                value={currentMax}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  if (!isNaN(val)) setCurrentMax(val);
                }}
                onBlur={() => handleUpdateMax(currentMax)}
                className="h-8 w-20 text-center"
              />
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                disabled={loading === "max"}
                onClick={() => handleUpdateMax(currentMax + 1)}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            {loading === "max" && (
              <span className="text-sm text-muted-foreground">Updating...</span>
            )}
          </div>
          <div className="flex gap-3">
            {!hasSubscription ? (
              <Button onClick={handleCheckout} disabled={loading === "checkout"}>
                {loading === "checkout" ? "Redirecting..." : "Add payment method"}
              </Button>
            ) : (
              <Button variant="outline" onClick={handlePortal} disabled={loading === "portal"}>
                {loading === "portal" ? "Redirecting..." : "Manage billing"}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Plan comparison */}
      <h2 className="text-lg font-semibold mb-4">
        {subscriptionStatus === "trialing" ? "Switch plan (free during trial)" : "Change plan"}
      </h2>
      <div className="grid gap-6 md:grid-cols-3">
        {(Object.keys(PLANS) as PlanName[]).map((planKey) => {
          const planConfig = PLANS[planKey];
          const isCurrentPlan = currentPlan === planKey;
          const planEstimate = estimateMonthlyCost(planKey, currentMax);

          return (
            <Card
              key={planKey}
              className={`flex flex-col ${isCurrentPlan ? "border-primary" : ""}`}
            >
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  {planConfig.name}
                  {isCurrentPlan && (
                    <span className="text-xs font-normal text-primary">Current</span>
                  )}
                </CardTitle>
                <CardDescription>{planConfig.description}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col space-y-4">
                {/* Tier pricing */}
                <div className="space-y-1 text-sm">
                  {planConfig.tiers.map((tier, i) => (
                    <div key={i} className="text-muted-foreground">
                      {tier.upTo
                        ? `${i === 0 ? "First" : `Next ${tier.upTo - (planConfig.tiers[i - 1]?.upTo ?? 0)}`} ${i === 0 ? tier.upTo : ""} ${labelPlural}`
                        : `${(planConfig.tiers[i - 1]?.upTo ?? 0) + 1}+ ${labelPlural}`}
                      : <strong className="text-foreground">£{tier.pricePerEmployee}/mo</strong>
                    </div>
                  ))}
                </div>

                <div className="text-sm font-medium">
                  Estimated: £{planEstimate}/month
                </div>

                {/* Features */}
                <ul className="space-y-1.5 text-sm">
                  {planConfig.features.map((feature) => (
                    <li key={feature} className="flex items-center gap-2">
                      <Check className="h-4 w-4 text-primary shrink-0" />
                      {feature}
                    </li>
                  ))}
                </ul>

                <div className="mt-auto pt-2">
                  {!isCurrentPlan ? (
                    <Button
                      variant="outline"
                      className="w-full"
                      onClick={() => handleSwitchPlan(planKey)}
                      disabled={loading === planKey}
                    >
                      {loading === planKey
                        ? "Switching..."
                        : `Switch to ${planConfig.name}`}
                    </Button>
                  ) : (
                    <Button variant="outline" className="w-full" disabled>
                      Current plan
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
