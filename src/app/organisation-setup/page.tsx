"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Info, Check } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { PLANS, type PlanName } from "@/lib/billing-config";
import { cn } from "@/lib/utils";

export default function OrganisationSetupPage() {
  const [name, setName] = useState("");
  const [memberLabel, setMemberLabel] = useState("");
  const [selectedPlan, setSelectedPlan] = useState<PlanName>("Lite");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  function generateSlug(value: string) {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const slug = generateSlug(name);
    if (!slug) {
      setError("Please enter a valid organisation name");
      setLoading(false);
      return;
    }

    // Create org + owner membership in a single transaction via RPC
    const { error: rpcError } = await supabase.rpc("create_organisation", {
      org_name: name,
      org_slug: slug,
      org_member_label: memberLabel || "member",
      org_plan: selectedPlan,
    });

    if (rpcError) {
      if (rpcError.code === "23505") {
        setError(
          "An organisation with this name already exists. Please choose a different name."
        );
      } else {
        setError(rpcError.message);
      }
      setLoading(false);
      return;
    }

    router.push("/");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-8">
      <div className="w-full max-w-3xl space-y-6">
        <Card>
          <CardHeader className="text-center">
            <CardTitle className="text-2xl">Set up your organisation</CardTitle>
            <CardDescription>
              Tell us about your company to get started
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-6">
              {error && (
                <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                  {error}
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="name">Organisation Name</Label>
                <Input
                  id="name"
                  type="text"
                  placeholder="e.g. Acme Corp"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="memberLabel">Member Type</Label>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="h-4 w-4 text-muted-foreground cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent side="right" className="max-w-xs">
                      <p>
                        How you refer to employees e.g. colleague, employee,
                        member etc. This word will be used throughout the app to
                        refer to the employee.
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </div>
                <Input
                  id="memberLabel"
                  type="text"
                  placeholder="e.g. employee, colleague, member"
                  value={memberLabel}
                  onChange={(e) => setMemberLabel(e.target.value)}
                />
              </div>

              <div className="space-y-3">
                <Label>Choose your plan</Label>
                <p className="text-sm text-muted-foreground">
                  All plans include a 30-day free trial. You can switch plans at any time.
                </p>
                <div className="grid gap-4 sm:grid-cols-3">
                  {(Object.keys(PLANS) as PlanName[]).map((planKey) => {
                    const plan = PLANS[planKey];
                    const isSelected = selectedPlan === planKey;
                    return (
                      <button
                        key={planKey}
                        type="button"
                        onClick={() => setSelectedPlan(planKey)}
                        className={cn(
                          "relative rounded-lg border-2 p-4 text-left transition-colors",
                          isSelected
                            ? "border-primary bg-primary/5"
                            : "border-muted hover:border-muted-foreground/50"
                        )}
                      >
                        {isSelected && (
                          <div className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                            <Check className="h-3 w-3" />
                          </div>
                        )}
                        <div className="font-semibold">{plan.name}</div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {plan.description}
                        </div>
                        <div className="mt-2 text-sm font-medium">
                          From £{plan.tiers[plan.tiers.length - 1].pricePerEmployee}/employee/mo
                        </div>
                        <ul className="mt-3 space-y-1">
                          {plan.features.map((feature) => (
                            <li
                              key={feature}
                              className="flex items-start gap-1.5 text-xs text-muted-foreground"
                            >
                              <Check className="mt-0.5 h-3 w-3 shrink-0 text-primary" />
                              {feature}
                            </li>
                          ))}
                        </ul>
                      </button>
                    );
                  })}
                </div>
              </div>

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Creating..." : "Create organisation"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
