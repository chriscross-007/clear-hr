"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Plus, Trash2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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

interface BreakDef {
  start: string;         // "HH:MM"
  end: string;
  duration_mins: number;
}

interface OvertimeAfterRule {
  id?: string;
  period: string;        // 'daily' | 'weekly'
  threshold_hours: number;
  sort_order: number;
}

interface OvertimeBand {
  id?: string;
  name: string;
  from_hour: number;
  to_hour: number | null;
  rate_multiplier: number;
  sort_order: number;
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
  breaks: BreakDef[];
  overtimeAfterRules: OvertimeAfterRule[];
  overtimeBands: OvertimeBand[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function toTimeInput(val: string | null): string {
  if (!val) return "";
  return val.slice(0, 5); // "HH:MM" from "HH:MM:SS"
}

function durationFromTimes(start: string, end: string): number {
  if (!start || !end) return 0;
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  return Math.max(0, (eh * 60 + em) - (sh * 60 + sm));
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
  breaks, setBreaks, breakType,
}: {
  breaks: BreakDef[];
  setBreaks: (v: BreakDef[]) => void;
  breakType: string;
}) {
  function addBreak() {
    setBreaks([...breaks, { start: "12:00", end: "13:00", duration_mins: 60 }]);
  }

  function removeBreak(i: number) {
    setBreaks(breaks.filter((_, idx) => idx !== i));
  }

  function updateBreak(i: number, field: keyof BreakDef, value: string | number) {
    const next = breaks.map((b, idx) => {
      if (idx !== i) return b;
      const updated = { ...b, [field]: value };
      if (field === "start" || field === "end") {
        updated.duration_mins = durationFromTimes(updated.start, updated.end);
      }
      return updated;
    });
    setBreaks(next);
  }

  if (breakType === "none") {
    return (
      <p className="text-sm text-muted-foreground">
        Break type is set to <strong>No breaks</strong>. Change it in the General tab to configure break times.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {breakType === "clocked"
          ? "Define the expected break windows. Clockings near these times will be matched as break start (OUT) and break end (IN)."
          : "Define breaks to automatically deduct from worked hours. No clockings are required."}
      </p>

      {breaks.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">No breaks defined.</p>
      ) : (
        <div className="space-y-3">
          {breaks.map((br, i) => (
            <div key={i} className="flex items-end gap-3 p-3 rounded-md border border-border bg-muted/20">
              <div className="space-y-1">
                <Label className="text-xs">Start</Label>
                <Input type="time" value={br.start} onChange={(e) => updateBreak(i, "start", e.target.value)} className="w-32" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">End</Label>
                <Input type="time" value={br.end} onChange={(e) => updateBreak(i, "end", e.target.value)} className="w-32" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Duration (mins)</Label>
                <Input
                  type="number"
                  value={br.duration_mins}
                  onChange={(e) => updateBreak(i, "duration_mins", Number(e.target.value))}
                  className="w-24"
                  min={0}
                />
              </div>
              <Button variant="ghost" size="icon" onClick={() => removeBreak(i)} className="mb-0.5">
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <Button variant="outline" size="sm" onClick={addBreak}>
        <Plus className="h-4 w-4 mr-1.5" />
        Add Break
      </Button>
    </div>
  );
}

// ── Overtime Bands Tab ───────────────────────────────────────────────────────

function OvertimeBandsTab({
  bands, setBands,
}: {
  bands: OvertimeBand[];
  setBands: (v: OvertimeBand[]) => void;
}) {
  function addBand() {
    const maxOrder = bands.reduce((m, b) => Math.max(m, b.sort_order), -1);
    const lastTo = bands[bands.length - 1]?.to_hour ?? 0;
    setBands([...bands, { name: "", from_hour: lastTo, to_hour: null, rate_multiplier: 1.0, sort_order: maxOrder + 1 }]);
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
          <div className="grid grid-cols-[1fr_6rem_6rem_7rem_2.5rem] gap-2 px-3 text-xs text-muted-foreground font-medium">
            <span>Band name</span>
            <span>From (hrs)</span>
            <span>To (hrs)</span>
            <span>Rate multiplier</span>
            <span />
          </div>
          {bands.map((b, i) => (
            <div key={i} className="grid grid-cols-[1fr_6rem_6rem_7rem_2.5rem] gap-2 items-center p-3 rounded-md border border-border bg-muted/20">
              <Input
                value={b.name}
                onChange={(e) => updateBand(i, "name", e.target.value)}
                placeholder="e.g. Regular"
              />
              <Input
                type="number"
                value={b.from_hour}
                onChange={(e) => updateBand(i, "from_hour", Number(e.target.value))}
                min={0}
                step={0.5}
              />
              <Input
                type="number"
                value={b.to_hour ?? ""}
                onChange={(e) => updateBand(i, "to_hour", e.target.value === "" ? null : Number(e.target.value))}
                placeholder="∞"
                min={0}
                step={0.5}
              />
              <div className="flex items-center gap-1.5">
                <Input
                  type="number"
                  value={b.rate_multiplier}
                  onChange={(e) => updateBand(i, "rate_multiplier", Number(e.target.value))}
                  min={0}
                  step={0.25}
                />
                <span className="text-xs text-muted-foreground">×</span>
              </div>
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

      <p className="text-xs text-muted-foreground">
        Example: Regular (0–8h × 1.0), Overtime (8–10h × 1.5), Double Time (10h+ × 2.0).
      </p>
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
  breaks: initialBreaks,
  overtimeAfterRules: initialOvertimeAfterRules,
  overtimeBands: initialOvertimeBands,
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
  const [breaks, setBreaks] = useState<BreakDef[]>(initialBreaks);
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
      breaks,
      overtimeAfterRules,
      overtimeBands,
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
          <BreaksTab breaks={breaks} setBreaks={setBreaks} breakType={breakType} />
        </TabsContent>

        <TabsContent value="overtime-bands">
          <OvertimeBandsTab bands={overtimeBands} setBands={setOvertimeBands} />
        </TabsContent>

        <TabsContent value="overtime-after">
          <OvertimeAfterTab rules={overtimeAfterRules} setRules={setOvertimeAfterRules} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
