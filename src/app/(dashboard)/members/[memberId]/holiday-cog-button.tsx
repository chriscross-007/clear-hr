// CLE-170 — Cog icon next to the Holiday item in the employee sidebar.
//
// Opens a sheet for editing the per-employee Holiday cog values that seed
// every new Holiday Period. The cog values were snapshotted from the org
// defaults at employee creation; admins can override them per-employee.
// Changes only affect newly-created Holiday Periods, not existing ones.

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Settings, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

import {
  getMemberHolidayCog,
  updateMemberHolidayCog,
  type MemberHolidayCog,
} from "@/app/(dashboard)/holiday-period-actions";

type CogForm = {
  type: "fixed" | "earned";
  units: "days" | "hours";
  earnedFactor: string;
  allowance: string;
  toilHoursPerDay: string;
  maxCarryForward: string;
  minCarryForward: string;
};

function cogToForm(c: MemberHolidayCog): CogForm {
  return {
    type: c.type,
    units: c.units,
    earnedFactor: String(c.earnedFactor),
    allowance: String(c.allowance),
    toilHoursPerDay: String(c.toilHoursPerDay),
    maxCarryForward: String(c.maxCarryForward),
    minCarryForward: String(c.minCarryForward),
  };
}

function formToCog(f: CogForm): MemberHolidayCog {
  return {
    type: f.type,
    units: f.units,
    earnedFactor: Number(f.earnedFactor) || 0,
    allowance: Number(f.allowance) || 0,
    toilHoursPerDay: Number(f.toilHoursPerDay) || 0,
    maxCarryForward: Number(f.maxCarryForward) || 0,
    minCarryForward: Number(f.minCarryForward) || 0,
  };
}

// Same input filters as the Org Settings dialog (CLE-169) and the period
// sheet (CLE-170 main client) — string state, regex-controlled keystrokes.
function acceptNonNegative(v: string): boolean {
  return /^\d*\.?\d*$/.test(v);
}
function acceptNonPositive(v: string): boolean {
  return (
    v === "" ||
    v === "-" ||
    /^0\.?0*$/.test(v) ||
    /^-(\d*\.?\d*|\.\d*)$/.test(v)
  );
}

export function HolidayCogButton({ memberId }: { memberId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<CogForm | null>(null);
  const [initialForm, setInitialForm] = useState<CogForm | null>(null);

  async function openSheet(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setLoading(true);
    setError(null);
    const result = await getMemberHolidayCog(memberId);
    setLoading(false);
    if (!result.success || !result.cog) {
      setError(result.error ?? "Could not load cog values");
      setOpen(true);
      return;
    }
    const f = cogToForm(result.cog);
    setForm(f);
    setInitialForm(f);
    setOpen(true);
  }

  function handleClose() {
    setOpen(false);
    setForm(null);
    setInitialForm(null);
    setError(null);
  }

  /** Cancel: discard pending edits and close the form. */
  function handleCancel() {
    if (initialForm) setForm(initialForm);
    handleClose();
  }

  /** Save: persist, refresh, then close on success. Errors keep the form open. */
  async function handleSave() {
    if (!form) return;
    setSaving(true);
    setError(null);
    const result = await updateMemberHolidayCog(memberId, formToCog(form));
    setSaving(false);
    if (!result.success) {
      setError(result.error ?? "Save failed");
      return;
    }
    router.refresh();
    handleClose();
  }

  const hasChanges = form !== null && initialForm !== null && (
    form.type !== initialForm.type ||
    form.units !== initialForm.units ||
    (Number(form.earnedFactor) || 0) !== (Number(initialForm.earnedFactor) || 0) ||
    (Number(form.allowance) || 0) !== (Number(initialForm.allowance) || 0) ||
    (Number(form.toilHoursPerDay) || 0) !== (Number(initialForm.toilHoursPerDay) || 0) ||
    (Number(form.maxCarryForward) || 0) !== (Number(initialForm.maxCarryForward) || 0) ||
    (Number(form.minCarryForward) || 0) !== (Number(initialForm.minCarryForward) || 0)
  );

  return (
    <>
      <button
        type="button"
        onClick={openSheet}
        className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        title="Holiday defaults for this employee"
        aria-label="Holiday defaults for this employee"
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Settings className="h-4 w-4" />}
      </button>

      <Sheet open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Holiday Defaults</SheetTitle>
            <SheetDescription>
              These values seed any <strong>new</strong> Holiday Period created for this
              employee. Existing periods aren&apos;t affected.
            </SheetDescription>
          </SheetHeader>

          {form && (
            <div className="overflow-y-auto max-h-[70vh] px-1 flex flex-col gap-4 mt-4">
              <div className="flex flex-col gap-1.5">
                <Label>Type</Label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="cogType"
                      checked={form.type === "fixed"}
                      onChange={() => setForm({ ...form, type: "fixed" })}
                      className="accent-primary"
                    />
                    <span className="text-sm">Fixed</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="cogType"
                      checked={form.type === "earned"}
                      onChange={() => setForm({ ...form, type: "earned" })}
                      className="accent-primary"
                    />
                    <span className="text-sm">Earned</span>
                  </label>
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label>Units</Label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="cogUnits"
                      checked={form.units === "days"}
                      onChange={() => setForm({ ...form, units: "days" })}
                      className="accent-primary"
                    />
                    <span className="text-sm">Days</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="cogUnits"
                      checked={form.units === "hours"}
                      onChange={() => setForm({ ...form, units: "hours" })}
                      className="accent-primary"
                    />
                    <span className="text-sm">Hours</span>
                  </label>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="cog-allowance">Allowance ({form.units})</Label>
                  <Input
                    id="cog-allowance"
                    type="text"
                    inputMode="decimal"
                    value={form.allowance}
                    onChange={(e) => {
                      if (acceptNonNegative(e.target.value)) {
                        setForm({ ...form, allowance: e.target.value });
                      }
                    }}
                  />
                </div>

                {form.type === "earned" && (
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="cog-earned-factor">Earned Factor (%)</Label>
                    <Input
                      id="cog-earned-factor"
                      type="text"
                      inputMode="decimal"
                      value={form.earnedFactor}
                      onChange={(e) => {
                        if (acceptNonNegative(e.target.value)) {
                          setForm({ ...form, earnedFactor: e.target.value });
                        }
                      }}
                    />
                  </div>
                )}

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="cog-toil">Toil hours per Day</Label>
                  <Input
                    id="cog-toil"
                    type="text"
                    inputMode="decimal"
                    value={form.toilHoursPerDay}
                    onChange={(e) => {
                      if (acceptNonNegative(e.target.value)) {
                        setForm({ ...form, toilHoursPerDay: e.target.value });
                      }
                    }}
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="cog-max-cf">Max Carry Forward ({form.units})</Label>
                  <Input
                    id="cog-max-cf"
                    type="text"
                    inputMode="decimal"
                    value={form.maxCarryForward}
                    onChange={(e) => {
                      if (acceptNonNegative(e.target.value)) {
                        setForm({ ...form, maxCarryForward: e.target.value });
                      }
                    }}
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="cog-min-cf">Min Carry Forward ({form.units}, ≤ 0)</Label>
                  <Input
                    id="cog-min-cf"
                    type="text"
                    inputMode="decimal"
                    value={form.minCarryForward}
                    onChange={(e) => {
                      if (acceptNonPositive(e.target.value)) {
                        setForm({ ...form, minCarryForward: e.target.value });
                      }
                    }}
                  />
                </div>
              </div>

              {error && <p className="text-sm text-destructive">{error}</p>}
            </div>
          )}

          {!form && error && (
            <p className="mt-4 text-sm text-destructive">{error}</p>
          )}

          <SheetFooter>
            <Button
              variant="outline"
              onClick={handleCancel}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving || !form || !hasChanges}
            >
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save Changes
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}
