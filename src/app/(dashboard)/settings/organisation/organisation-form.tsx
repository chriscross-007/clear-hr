"use client";

// CLE-191 — Organisation Settings form. Lifted from the General +
// Holiday Year tabs of the old OrganisationEditDialog. Single Save
// button at the bottom; on success we router.refresh() to pick up any
// downstream side-effects (e.g. member_label propagates into the
// dashboard layout).

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Info } from "lucide-react";
import { updateOrganisation } from "@/app/(dashboard)/organisation-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface OrganisationSettingsFormProps {
  initialName: string;
  initialMemberLabel: string;
  initialCurrencySymbol: string;
  initialCountryCode: string;
  initialRequireMfa: boolean;
  plan: string;
  initialHolidayYearStartType: string;
  initialHolidayYearStartDay: number;
  initialHolidayYearStartMonth: number;
  initialBankHolidayHandling: string;
  initialBankHolidayColour: string;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function OrganisationSettingsForm({
  initialName,
  initialMemberLabel,
  initialCurrencySymbol,
  initialCountryCode,
  initialRequireMfa,
  plan,
  initialHolidayYearStartType,
  initialHolidayYearStartDay,
  initialHolidayYearStartMonth,
  initialBankHolidayHandling,
  initialBankHolidayColour,
}: OrganisationSettingsFormProps) {
  const router = useRouter();

  const [name, setName] = useState(initialName);
  const [memberLabel, setMemberLabel] = useState(initialMemberLabel);
  const [currencySymbol, setCurrencySymbol] = useState(initialCurrencySymbol);
  const [countryCode, setCountryCode] = useState(initialCountryCode);
  const [requireMfa, setRequireMfa] = useState(initialRequireMfa);
  const [holidayYearStartType, setHolidayYearStartType] = useState(initialHolidayYearStartType);
  const [holidayYearStartDay, setHolidayYearStartDay] = useState(initialHolidayYearStartDay);
  const [holidayYearStartMonth, setHolidayYearStartMonth] = useState(initialHolidayYearStartMonth);
  const [bankHolidayHandling, setBankHolidayHandling] = useState(initialBankHolidayHandling);
  const [bankHolidayColour, setBankHolidayColour] = useState(initialBankHolidayColour);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSavedFlash(false);
    const result = await updateOrganisation({
      name: name.trim(),
      memberLabel: memberLabel.trim() || "member",
      currencySymbol: currencySymbol.trim() || "£",
      countryCode,
      requireMfa,
      holidayYearStartType,
      holidayYearStartDay,
      holidayYearStartMonth,
      bankHolidayHandling,
      bankHolidayColour,
    });
    setSaving(false);
    if (!result.success) {
      setError(result.error ?? "Failed to save");
      return;
    }
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 2500);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
      )}
      {savedFlash && (
        <div className="rounded-md bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 p-3 text-sm text-green-700 dark:text-green-300">
          Saved.
        </div>
      )}

      {/* Identity */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Identity</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="org-name">Organisation Name</Label>
            <Input
              id="org-name"
              type="text"
              maxLength={50}
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <Label htmlFor="org-member-label">Member Type</Label>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="h-4 w-4 text-muted-foreground cursor-help" />
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-xs">
                  <p>How you refer to employees e.g. colleague, employee, member etc. This word will be used throughout the app.</p>
                </TooltipContent>
              </Tooltip>
            </div>
            <Input
              id="org-member-label"
              type="text"
              placeholder="e.g. employee, colleague, member"
              maxLength={50}
              value={memberLabel}
              onChange={(e) => setMemberLabel(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="org-currency-symbol">Currency Symbol</Label>
            <Input
              id="org-currency-symbol"
              type="text"
              maxLength={5}
              placeholder="£"
              value={currencySymbol}
              onChange={(e) => setCurrencySymbol(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>Country / Region</Label>
            <select
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={countryCode}
              onChange={(e) => setCountryCode(e.target.value)}
            >
              <option value="england-and-wales">England &amp; Wales</option>
              <option value="scotland">Scotland</option>
              <option value="northern-ireland">Northern Ireland</option>
            </select>
          </div>

          <div className="flex items-center justify-between rounded-md border px-3 py-3">
            <div className="space-y-0.5">
              <Label htmlFor="org-require-mfa">Require Two-Factor Authentication</Label>
              <p className="text-xs text-muted-foreground">
                All members must verify with an authenticator app when signing in.
              </p>
            </div>
            <Switch
              id="org-require-mfa"
              checked={requireMfa}
              onCheckedChange={setRequireMfa}
            />
          </div>

          <div className="space-y-2">
            <Label>Plan</Label>
            <div className="flex items-center justify-between rounded-md border px-3 py-2">
              <span className="text-sm">{plan} plan</span>
              <Link
                href="/billing"
                className="text-sm text-primary underline-offset-4 hover:underline"
              >
                Manage billing
              </Link>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Holiday year */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Holiday year</CardTitle>
          <p className="text-xs text-muted-foreground">
            Defines the start of every employee&apos;s holiday year. Not a per-member rule — the year start is a property of the organisation as a whole.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label className="text-sm font-medium">Holiday year starts on</Label>
            <div className="space-y-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="holidayYearType"
                  value="fixed"
                  checked={holidayYearStartType === "fixed"}
                  onChange={() => setHolidayYearStartType("fixed")}
                  className="accent-primary"
                />
                <span className="text-sm">Fixed date (same for all employees)</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="holidayYearType"
                  value="employee_start_date"
                  checked={holidayYearStartType === "employee_start_date"}
                  onChange={() => setHolidayYearStartType("employee_start_date")}
                  className="accent-primary"
                />
                <span className="text-sm">Employee start date (individual anniversary)</span>
              </label>
            </div>
          </div>

          {holidayYearStartType === "fixed" && (
            <div className="flex items-center gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Day</Label>
                <select
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                  value={holidayYearStartDay}
                  onChange={(e) => setHolidayYearStartDay(parseInt(e.target.value, 10))}
                >
                  {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Month</Label>
                <select
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                  value={holidayYearStartMonth}
                  onChange={(e) => setHolidayYearStartMonth(parseInt(e.target.value, 10))}
                >
                  {MONTHS.map((name, i) => (
                    <option key={i + 1} value={i + 1}>{name}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            {holidayYearStartType === "fixed"
              ? `All employees share the same holiday year starting ${holidayYearStartDay} ${MONTHS[holidayYearStartMonth - 1]}.`
              : "Each employee's holiday year starts on the anniversary of their start date."}
          </p>
        </CardContent>
      </Card>

      {/* Bank holiday handling */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Bank holidays</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label className="text-sm font-medium">Handling</Label>
            <div className="space-y-2">
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="bankHolidayHandling"
                  value="additional"
                  checked={bankHolidayHandling === "additional"}
                  onChange={() => setBankHolidayHandling("additional")}
                  className="accent-primary mt-0.5"
                />
                <div>
                  <span className="text-sm font-medium">Additional</span>
                  <p className="text-xs text-muted-foreground">Bank holidays are added on top of employees&apos; annual leave allowance.</p>
                </div>
              </label>
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="bankHolidayHandling"
                  value="deducted"
                  checked={bankHolidayHandling === "deducted"}
                  onChange={() => setBankHolidayHandling("deducted")}
                  className="accent-primary mt-0.5"
                />
                <div>
                  <span className="text-sm font-medium">Deducted</span>
                  <p className="text-xs text-muted-foreground">Bank holidays are deducted from employees&apos; annual leave allowance when taken.</p>
                </div>
              </label>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-medium">Bank holiday colour</Label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={bankHolidayColour}
                onChange={(e) => setBankHolidayColour(e.target.value)}
                className="h-9 w-12 cursor-pointer rounded-md border border-input bg-background p-1"
              />
              <Input
                type="text"
                value={bankHolidayColour}
                onChange={(e) => setBankHolidayColour(e.target.value)}
                maxLength={7}
                placeholder="#EF4444"
                className="w-28 font-mono text-sm uppercase"
              />
            </div>
            <p className="text-xs text-muted-foreground">Used to highlight bank holidays on calendar views.</p>
          </div>
        </CardContent>
      </Card>

      {/* Save */}
      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </div>
  );
}
