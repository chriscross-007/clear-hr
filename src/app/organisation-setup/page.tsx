"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Info } from "lucide-react";
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

export default function OrganisationSetupPage() {
  const [name, setName] = useState("");
  const [memberLabel, setMemberLabel] = useState("");
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
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Set up your organisation</CardTitle>
          <CardDescription>
            Tell us about your company to get started
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
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
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Creating..." : "Create organisation"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
