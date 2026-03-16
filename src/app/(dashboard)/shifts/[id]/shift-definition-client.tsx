"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Plus, Trash2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { saveShiftDefinition, deleteShiftDefinition } from "../actions";

// ── Types ────────────────────────────────────────────────────────────────────

interface OvertimeAfterRule {
  id?: string;
  period: string;        // 'daily' | 'weekly'
  threshold_hours: number;
  sort_order: number;
}

interface OvertimeBand {
  id?: string;
  rate_id: string | null;
  from_time: string;
  to_time: string | null;
  min_time: string | null;
  sort_order: number;
}

interface BreakRule {
  band_start:    string;        // "HH:MM" — start of break window
  band_end:      string;        // "HH:MM" — end of break window
  allowed_break: string;        // "HH:MM" — allowed break duration
  penalty_break: string | null; // "HH:MM" — deducted if break not clocked, or null
  paid:          boolean;       // whether the break is paid
  rate_id:       string | null; // rate that receives break deduction/addition
}

interface ShiftDef {
  id: string;
  name: string;
  isOpenShift: boolean;
  plannedStart: string | null;
  plannedEnd: string | null;
  crossesMidnight: boolean;
  breakType: string;
  active: boolean;
  sortOrder: number;
}

interface Props {
  organisationId: string;
  shiftDef: ShiftDef | null;
  breakRules: BreakRule[];
  overtimeAfterRules: OvertimeAfterRule[];
  overtimeBands: OvertimeBand[];
  rates: { id: string; name: string; rate_multiplier: number }[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function toTimeInput(val: string | null): string {
  if (!val) return "";
  return val.slice(0, 5); // "HH:MM" from "HH:MM:SS"
}

// ── Sub-components ───────────────────────────────────────────────────────────

function SectionCard({ title, description, children }: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border p-5 space-y-4">
      <div>
        <h3 className="font-semibold text-sm">{title}</h3>
        {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
      </div>
      {children}
    </div>
  );
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-4">
      <Label className="w-40 shrink-0 text-sm">{label}</Label>
      <div className="flex-1">{children}</div>
    </div>
  );
}

// ── General Tab ──────────────────────────────────────────────────────────────

function GeneralTab({
  name, setName,
  isOpenShift, setIsOpenShift,
  plannedStart, setPlannedStart,
  plannedEnd, setPlannedEnd,
  crossesMidnight, setCrossesMidnight,
  breakType, setBreakType,
  active, setActive,
  sortOrder, setSortOrder,
}: {
  name: string; setName: (v: string) => void;
  isOpenShift: boolean; setIsOpenShift: (v: boolean) => void;
  plannedStart: string; setPlannedStart: (v: string) => void;
  plannedEnd: string; setPlannedEnd: (v: string) => void;
  crossesMidnight: boolean; setCrossesMidnight: (v: boolean) => void;
  breakType: string; setBreakType: (v: string) => void;
  active: boolean; setActive: (v: boolean) => void;
  sortOrder: number; setSortOrder: (v: number) => void;
}) {
  return (
    <div className="space-y-4">
      <SectionCard title="Identity">
        <FieldRow label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. 09:00–17:00 1hr Lunch" />
        </FieldRow>
        <FieldRow label="Sort order">
          <Input
            type="number"
            value={sortOrder}
            onChange={(e) => setSortOrder(Number(e.target.value))}
            className="w-24"
            min={0}
          />
        </FieldRow>
        <FieldRow label="Active">
          <Switch checked={active} onCheckedChange={setActive} />
        </FieldRow>
      </SectionCard>

      <SectionCard title="Shift times" description="Leave blank for open shifts with no fixed start/end.">
        <FieldRow label="Open shift">
          <Switch checked={isOpenShift} onCheckedChange={(v) => { setIsOpenShift(v); if (v) { setPlannedStart(""); setPlannedEnd(""); } }} />
        </FieldRow>
        {!isOpenShift && (
          <>
            <FieldRow label="Planned start">
              <Input type="time" value={plannedStart} onChange={(e) => setPlannedStart(e.target.value)} className="w-36" />
            </FieldRow>
            <FieldRow label="Planned end">
              <Input type="time" value={plannedEnd} onChange={(e) => setPlannedEnd(e.target.value)} className="w-36" />
            </FieldRow>
            <FieldRow label="Crosses midnight">
              <Switch checked={crossesMidnight} onCheckedChange={setCrossesMidnight} />
            </FieldRow>
          </>
        )}
      </SectionCard>

      <SectionCard title="Breaks" description="How break time is handled for this shift.">
        <FieldRow label="Break type">
          <Select value={breakType} onValueChange={setBreakType}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No breaks</SelectItem>
              <SelectItem value="clocked">Clocked — employees clock in/out for breaks</SelectItem>
              <SelectItem value="auto_deduct">Auto-deduct — fixed break time deducted automatically</SelectItem>
            </SelectContent>
          </Select>
        </FieldRow>
      </SectionCard>
    </div>
  );
}

// ── Breaks Tab ───────────────────────────────────────────────────────────────

function BreaksTab({
  breakRules, setBreakRules, rates,
}: {
  breakRules: BreakRule[];
  setBreakRules: (v: BreakRule[]) => void;
  rates: { id: string; name: string }[];
}) {
  // ── Break rules (policy / penalty) ──
  function addBreakRule() {
    setBreakRules([...breakRules, {
      band_start:    "12:00",
      band_end:      "14:00",
      allowed_break: "01:00",
      penalty_break: null,
      paid:          false,
      rate_id:       null,
    }]);
  }
  function removeBreakRule(i: number) {
    setBreakRules(breakRules.filter((_, idx) => idx !== i));
  }
  function updateBreakRule<K extends keyof BreakRule>(i: number, field: K, value: BreakRule[K]) {
    setBreakRules(breakRules.map((r, idx) => idx === i ? { ...r, [field]: value } : r));
  }

  return (
    <div className="space-y-6">
      <SectionCard
        title="Break rules"
        description="Define break entitlements and penalties. If the employee does not clock the break, the penalty duration is deducted automatically."
      >
        {breakRules.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">No break rules defined.</p>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-[6rem_6rem_6rem_6rem_10rem_4rem_2.5rem] gap-2 px-3 text-xs text-muted-foreground font-medium">
              <span>Window start</span>
              <span>Window end</span>
              <span>Allowed</span>
              <span>Penalty</span>
              <span>Rate</span>
              <span>Paid</span>
              <span />
            </div>
            {breakRules.map((r, i) => (
              <div key={i} className="grid grid-cols-[6rem_6rem_6rem_6rem_10rem_4rem_2.5rem] gap-2 items-center p-3 rounded-md border border-border bg-muted/20">
                <Input
                  type="time"
                  value={r.band_start}
                  onChange={(e) => updateBreakRule(i, "band_start", e.target.value)}
                />
                <Input
                  type="time"
                  value={r.band_end}
                  onChange={(e) => updateBreakRule(i, "band_end", e.target.value)}
                />
                <Input
                  type="time"
                  value={r.allowed_break}
                  onChange={(e) => updateBreakRule(i, "allowed_break", e.target.value)}
                />
                <Input
                  type="time"
                  value={r.penalty_break ?? ""}
                  onChange={(e) => updateBreakRule(i, "penalty_break", e.target.value || null)}
                  placeholder="—"
                />
                <Select
                  value={r.rate_id ?? "__none__"}
                  onValueChange={(v) => updateBreakRule(i, "rate_id", v === "__none__" ? null : v)}
                >
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue placeholder="— select rate —" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— none —</SelectItem>
                    {rates.map((rate) => (
                      <SelectItem key={rate.id} value={rate.id}>{rate.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="flex items-center justify-center">
                  <Checkbox
                    checked={r.paid}
                    onCheckedChange={(v) => updateBreakRule(i, "paid", v === true)}
                  />
                </div>
                <Button variant="ghost" size="icon" onClick={() => removeBreakRule(i)}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            ))}
          </div>
        )}
        <Button variant="outline" size="sm" onClick={addBreakRule}>
          <Plus className="h-4 w-4 mr-1.5" />
          Add Break Rule
        </Button>
      </SectionCard>
    </div>
  );
}

// ── Overtime Bands Tab ───────────────────────────────────────────────────────

function OvertimeBandsTab({
  bands, setBands, rates,
}: {
  bands: OvertimeBand[];
  setBands: (v: OvertimeBand[]) => void;
  rates: { id: string; name: string; rate_multiplier: number }[];
}) {
  function addBand() {
    const maxOrder = bands.reduce((m, b) => Math.max(m, b.sort_order), -1);
    const lastTo = bands[bands.length - 1]?.to_time ?? "00:00";
    setBands([...bands, { rate_id: null, from_time: lastTo, to_time: null, min_time: null, sort_order: maxOrder + 1 }]);
  }

  function removeBand(i: number) {
    setBands(bands.filter((_, idx) => idx !== i));
  }

  function updateBand(i: number, field: keyof OvertimeBand, value: string | number | null) {
    setBands(bands.map((b, idx) => idx === i ? { ...b, [field]: value } : b));
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Define time bands that determine which rate applies to each block of hours worked.
        Bands are applied in order; the last band can have no upper limit.
      </p>

      {bands.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">No bands defined.</p>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-[1fr_6rem_6rem_6rem_2.5rem] gap-2 px-3 text-xs text-muted-foreground font-medium">
            <span>Rate</span>
            <span>From</span>
            <span>To</span>
            <span>Min</span>
            <span />
          </div>
          {bands.map((b, i) => (
            <div key={i} className="grid grid-cols-[1fr_6rem_6rem_6rem_2.5rem] gap-2 items-center p-3 rounded-md border border-border bg-muted/20">
              <Select
                value={b.rate_id ?? "__none__"}
                onValueChange={(v) => updateBand(i, "rate_id", v === "__none__" ? null : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="— no rate —" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— no rate —</SelectItem>
                  {rates.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name} <span className="text-muted-foreground">×{Number(r.rate_multiplier).toFixed(2)}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                type="time"
                value={b.from_time ?? ""}
                onChange={(e) => updateBand(i, "from_time", e.target.value)}
              />
              <Input
                type="time"
                value={b.to_time ?? ""}
                onChange={(e) => updateBand(i, "to_time", e.target.value || null)}
                placeholder="—"
              />
              <Input
                type="time"
                value={b.min_time ?? ""}
                onChange={(e) => updateBand(i, "min_time", e.target.value || null)}
                placeholder="hh:mm"
              />
              <Button variant="ghost" size="icon" onClick={() => removeBand(i)}>
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <Button variant="outline" size="sm" onClick={addBand}>
        <Plus className="h-4 w-4 mr-1.5" />
        Add Band
      </Button>
    </div>
  );
}

// ── Overtime After Tab ───────────────────────────────────────────────────────

function OvertimeAfterTab({
  rules, setRules,
}: {
  rules: OvertimeAfterRule[];
  setRules: (v: OvertimeAfterRule[]) => void;
}) {
  function addRule() {
    const maxOrder = rules.reduce((m, r) => Math.max(m, r.sort_order), -1);
    setRules([...rules, { period: "daily", threshold_hours: 8, sort_order: maxOrder + 1 }]);
  }

  function removeRule(i: number) {
    setRules(rules.filter((_, idx) => idx !== i));
  }

  function updateRule(i: number, field: keyof OvertimeAfterRule, value: string | number) {
    setRules(rules.map((r, idx) => idx === i ? { ...r, [field]: value } : r));
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Define when overtime starts. Multiple thresholds can apply simultaneously —
        for example a daily threshold of 8h and a weekly threshold of 40h.
        Once a threshold is exceeded, the Overtime Bands determine which rate applies.
      </p>

      {rules.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">No overtime rules defined. All hours use the first Overtime Band.</p>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-[10rem_8rem_2.5rem] gap-2 px-3 text-xs text-muted-foreground font-medium">
            <span>Period</span>
            <span>After (hours)</span>
            <span />
          </div>
          {rules.map((r, i) => (
            <div key={i} className="grid grid-cols-[10rem_8rem_2.5rem] gap-2 items-center p-3 rounded-md border border-border bg-muted/20">
              <Select value={r.period} onValueChange={(v) => updateRule(i, "period", v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="weekly">Weekly</SelectItem>
                </SelectContent>
              </Select>
              <Input
                type="number"
                value={r.threshold_hours}
                onChange={(e) => updateRule(i, "threshold_hours", Number(e.target.value))}
                min={0}
                step={0.5}
              />
              <Button variant="ghost" size="icon" onClick={() => removeRule(i)}>
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <Button variant="outline" size="sm" onClick={addRule}>
        <Plus className="h-4 w-4 mr-1.5" />
        Add Rule
      </Button>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function ShiftDefinitionClient({
  organisationId,
  shiftDef,
  breakRules: initialBreakRules,
  overtimeAfterRules: initialOvertimeAfterRules,
  overtimeBands: initialOvertimeBands,
  rates,
}: Props) {
  const router = useRouter();
  const isNew = !shiftDef;

  // General tab state
  const [name, setName] = useState(shiftDef?.name ?? "");
  const [isOpenShift, setIsOpenShift] = useState(shiftDef?.isOpenShift ?? false);
  const [plannedStart, setPlannedStart] = useState(toTimeInput(shiftDef?.plannedStart ?? null));
  const [plannedEnd, setPlannedEnd] = useState(toTimeInput(shiftDef?.plannedEnd ?? null));
  const [crossesMidnight, setCrossesMidnight] = useState(shiftDef?.crossesMidnight ?? false);
  const [breakType, setBreakType] = useState(shiftDef?.breakType ?? "none");
  const [active, setActive] = useState(shiftDef?.active ?? true);
  const [sortOrder, setSortOrder] = useState(shiftDef?.sortOrder ?? 0);

  // Other tabs state
  const [breakRules, setBreakRules] = useState<BreakRule[]>(initialBreakRules);
  const [overtimeAfterRules, setOvertimeAfterRules] = useState<OvertimeAfterRule[]>(initialOvertimeAfterRules);
  const [overtimeBands, setOvertimeBands] = useState<OvertimeBand[]>(initialOvertimeBands);

  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    if (!shiftDef?.id) return;
    setDeleting(true);
    const result = await deleteShiftDefinition(shiftDef.id);
    setDeleting(false);
    if (result.success) {
      router.replace("/shifts");
    } else {
      setError(result.error ?? "Delete failed");
    }
  }

  async function handleSave() {
    if (!name.trim()) { setError("Name is required."); return; }
    setSaving(true);
    setError(null);

    const result = await saveShiftDefinition({
      id: shiftDef?.id,
      organisationId,
      name: name.trim(),
      isOpenShift,
      plannedStart: isOpenShift ? null : (plannedStart || null),
      plannedEnd: isOpenShift ? null : (plannedEnd || null),
      crossesMidnight: isOpenShift ? false : crossesMidnight,
      breakType,
      active,
      sortOrder,
      breakRules,
      overtimeAfterRules,
      overtimeBands: overtimeBands.map((b) => ({
        id:         b.id,
        rate_id:    b.rate_id,
        from_time:  b.from_time,
        to_time:    b.to_time,
        min_time:   b.min_time,
        sort_order: b.sort_order,
      })),
    });

    setSaving(false);
    if (result.success) {
      if (isNew && result.id) {
        router.replace(`/shifts/${result.id}`);
      } else {
        router.refresh();
      }
    } else {
      setError(result.error ?? "Save failed");
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/shifts">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-muted-foreground">Shifts</p>
          <h1 className="text-2xl font-bold truncate">{isNew ? "New Shift" : name}</h1>
        </div>
        {!isNew && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="icon" disabled={deleting} className="text-destructive hover:text-destructive hover:bg-destructive/10">
                <Trash2 className="h-4 w-4" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete shift?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently delete <strong>{name}</strong> and all its breaks, overtime bands, and overtime rules. This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleDelete}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
        <Button onClick={handleSave} disabled={saving}>
          <Save className="h-4 w-4 mr-1.5" />
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>

      {error && (
        <p className="mb-4 text-sm text-destructive">{error}</p>
      )}

      <Tabs defaultValue="general">
        <TabsList className="mb-6">
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="breaks">Breaks</TabsTrigger>
          <TabsTrigger value="overtime-bands">Overtime Bands</TabsTrigger>
          <TabsTrigger value="overtime-after">Overtime After</TabsTrigger>
        </TabsList>

        <TabsContent value="general">
          <GeneralTab
            name={name} setName={setName}
            isOpenShift={isOpenShift} setIsOpenShift={setIsOpenShift}
            plannedStart={plannedStart} setPlannedStart={setPlannedStart}
            plannedEnd={plannedEnd} setPlannedEnd={setPlannedEnd}
            crossesMidnight={crossesMidnight} setCrossesMidnight={setCrossesMidnight}
            breakType={breakType} setBreakType={setBreakType}
            active={active} setActive={setActive}
            sortOrder={sortOrder} setSortOrder={setSortOrder}
          />
        </TabsContent>

        <TabsContent value="breaks">
          <BreaksTab
            breakRules={breakRules} setBreakRules={setBreakRules} rates={rates}
          />
        </TabsContent>

        <TabsContent value="overtime-bands">
          <OvertimeBandsTab bands={overtimeBands} setBands={setOvertimeBands} rates={rates} />
        </TabsContent>

        <TabsContent value="overtime-after">
          <OvertimeAfterTab rules={overtimeAfterRules} setRules={setOvertimeAfterRules} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
