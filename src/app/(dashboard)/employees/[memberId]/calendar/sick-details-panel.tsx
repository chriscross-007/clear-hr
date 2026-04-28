"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CalendarCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  getSickDetails,
  getSelfCertTemplateUrl,
} from "../../../sick-booking-actions";
import { computeCompletionStatus } from "../../../sick-booking-types";
import type { SickDetailsInput, CompletionStatus } from "../../../sick-booking-types";
import { CompletionStatusBadge } from "@/components/completion-status-badge";

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export interface OrgAdminOption {
  id: string;
  firstName: string;
  lastName: string;
}

interface SickDetailsPanelProps {
  bookingId: string | null;
  /** The booking's end_date — used to compute the live completion status. */
  bookingEndDate: string | null;
  callerMemberId: string;
  orgAdmins: OrgAdminOption[];
  hasSelfCertTemplate: boolean;
  onSickDetailsChange: (input: Omit<SickDetailsInput, "bookingId">) => void;
  /** Called once when the panel finishes loading — passes the loaded state as the dirty-check baseline. */
  onLoaded?: (baseline: Omit<SickDetailsInput, "bookingId">) => void;
}

type LoadedExtras = {
  self_cert_received_by: string | null;
  med_cert_received_by: string | null;
  hr_approved_by: string | null;
  hr_approved_at: string | null;
};

const DEFAULT_INPUT: Omit<SickDetailsInput, "bookingId"> = {
  selfCertRequired: false,
  selfCertReceivedDate: null,
  selfCertDocumentId: null,
  btwRequired: false,
  btwDate: null,
  btwInterviewerId: null,
  btwCompleted: false,
  medCertRequired: false,
  medCertReceivedDate: null,
  isPaid: true,
  hrApproved: false,
};

function formatDateTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function SickDetailsPanel({
  bookingId,
  bookingEndDate,
  callerMemberId,
  orgAdmins,
  hasSelfCertTemplate,
  onSickDetailsChange,
  onLoaded,
}: SickDetailsPanelProps) {
  const [input, setInput] = useState<Omit<SickDetailsInput, "bookingId">>(DEFAULT_INPUT);
  const [loaded, setLoaded] = useState<LoadedExtras>({ hr_approved_by: null, hr_approved_at: null });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Live-compute the completion status from the current form state so it
  // always reflects unsaved changes and doesn't rely on the stored value.
  const completionStatus: CompletionStatus = computeCompletionStatus(input, bookingEndDate);

  // Stable callback ref so the parent can pass an inline lambda without
  // forcing this effect to re-fire on every render.
  const onChangeRef = useRef(onSickDetailsChange);
  onChangeRef.current = onSickDetailsChange;
  const onLoadedRef = useRef(onLoaded);
  onLoadedRef.current = onLoaded;

  // Load on mount when editing an existing booking
  useEffect(() => {
    if (bookingId === null) {
      setInput(DEFAULT_INPUT);
      setLoaded({ self_cert_received_by: null, med_cert_received_by: null, hr_approved_by: null, hr_approved_at: null });

      onLoadedRef.current?.(DEFAULT_INPUT);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      const res = await getSickDetails(bookingId);
      if (cancelled) return;
      if (!res.success) {
        setError(res.error ?? "Could not load sick details");
        setLoading(false);
  
        onLoadedRef.current?.(DEFAULT_INPUT);
        return;
      }
      if (res.details) {
        const loaded: Omit<SickDetailsInput, "bookingId"> = {
          selfCertRequired: res.details.self_cert_required,
          selfCertReceivedDate: res.details.self_cert_received_date,
          selfCertDocumentId: res.details.self_cert_document_id,
          btwRequired: res.details.btw_required,
          btwDate: res.details.btw_date,
          btwInterviewerId: res.details.btw_interviewer_id,
          btwCompleted: res.details.btw_completed,
          medCertRequired: res.details.med_cert_required,
          medCertReceivedDate: res.details.med_cert_received_date,
          isPaid: res.details.is_paid,
          hrApproved: res.details.hr_approved,
        };
        setInput(loaded);
        setLoaded({
          self_cert_received_by: res.details.self_cert_received_by,
          med_cert_received_by: res.details.med_cert_received_by,
          hr_approved_by: res.details.hr_approved_by,
          hr_approved_at: res.details.hr_approved_at,
        });
        onLoadedRef.current?.(loaded);
      } else {
        setInput(DEFAULT_INPUT);
        setLoaded({ self_cert_received_by: null, med_cert_received_by: null, hr_approved_by: null, hr_approved_at: null });
  
        onLoadedRef.current?.(DEFAULT_INPUT);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [bookingId]);

  // Push the current draft up to the parent whenever it changes.
  useEffect(() => {
    onChangeRef.current(input);
  }, [input]);


  // -- Field updates --
  const update = useCallback(<K extends keyof typeof DEFAULT_INPUT>(key: K, value: (typeof DEFAULT_INPUT)[K]) => {
    setInput((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handleDownloadTemplate = useCallback(async () => {
    const res = await getSelfCertTemplateUrl();
    if (res.success && res.url) {
      window.open(res.url, "_blank", "noopener,noreferrer");
    }
  }, []);

  const adminById = (id: string | null): string => {
    if (!id) return "";
    const m = orgAdmins.find((a) => a.id === id);
    return m ? `${m.firstName} ${m.lastName}`.trim() : "";
  };

  const approvalLine = (() => {
    if (!input.hrApproved) return null;
    if (loaded.hr_approved_by && loaded.hr_approved_at) {
      const name = adminById(loaded.hr_approved_by) || "an admin";
      return `Approved by ${name} on ${formatDateTime(loaded.hr_approved_at)}`;
    }
    return "Will be recorded as approved by you on save";
  })();

  // Highlight the self-cert date field when required but not filled
  const selfCertDateMissing = input.selfCertRequired && !input.selfCertReceivedDate;

  return (
    <div className="space-y-3 rounded-md border bg-muted/30 p-3 text-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h4 className="font-semibold">Sick Absence Management</h4>
          {!loading && (
            <CompletionStatusBadge status={completionStatus} />
          )}
        </div>
        {loading && <span className="text-xs text-muted-foreground">Loading…</span>}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}

      {/* Self Certification ---------------------------------------------- */}
      <div className="space-y-2">
        <label className="flex cursor-pointer items-center gap-2">
          <Checkbox
            checked={input.selfCertRequired}
            onCheckedChange={(v) => update("selfCertRequired", v === true)}
          />
          <span>Self Certification Form required</span>
        </label>
        {input.selfCertRequired && (
          <div className="ml-6 space-y-2">
            <div className="flex flex-col gap-1">
              <Label
                htmlFor="self-cert-date"
                className={cn("text-xs", selfCertDateMissing && "text-destructive")}
              >
                Date Received
              </Label>
              <div className="flex w-fit items-center gap-1.5">
                <Input
                  id="self-cert-date"
                  type="date"
                  max={todayISO()}
                  value={input.selfCertReceivedDate ?? ""}
                  onChange={(e) => update("selfCertReceivedDate", e.target.value || null)}
                  className={cn(selfCertDateMissing && "border-destructive")}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  title="Set to today"
                  onClick={() => update("selfCertReceivedDate", todayISO())}
                >
                  <CalendarCheck className="h-4 w-4" />
                </Button>
              </div>
              {input.selfCertReceivedDate && (
                <p className="text-xs text-muted-foreground">
                  Recorded by {adminById(loaded.self_cert_received_by) || "you (on save)"}
                </p>
              )}
            </div>
            <div>
              {hasSelfCertTemplate ? (
                <Button
                  type="button"
                  variant="link"
                  className="h-auto p-0 text-xs"
                  onClick={handleDownloadTemplate}
                >
                  Download Form
                </Button>
              ) : (
                <span className="text-xs text-muted-foreground">(no template uploaded)</span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Back to Work Interview ------------------------------------------ */}
      <div className="space-y-2">
        <label className="flex cursor-pointer items-center gap-2">
          <Checkbox
            checked={input.btwRequired}
            onCheckedChange={(v) => update("btwRequired", v === true)}
          />
          <span>Back to Work Interview required</span>
        </label>
        {input.btwRequired && (
          <div className="ml-6 space-y-2">
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <Label htmlFor="btw-date" className="text-xs">Interview Date</Label>
                <div className="flex w-fit items-center gap-1.5">
                  <Input
                    id="btw-date"
                    type="date"
                    value={input.btwDate ?? ""}
                    onChange={(e) => update("btwDate", e.target.value || null)}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    title="Set to today"
                    onClick={() => update("btwDate", todayISO())}
                  >
                    <CalendarCheck className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="btw-with" className="text-xs">With</Label>
                <Select
                  value={input.btwInterviewerId ?? "__none__"}
                  onValueChange={(v) => update("btwInterviewerId", v === "__none__" ? null : v)}
                >
                  <SelectTrigger id="btw-with">
                    <SelectValue placeholder="Select admin" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">—</SelectItem>
                    {orgAdmins.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.firstName} {a.lastName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <label className="flex cursor-pointer items-center gap-2">
              <Checkbox
                checked={input.btwCompleted}
                onCheckedChange={(v) => update("btwCompleted", v === true)}
              />
              <span>Interview completed</span>
            </label>
          </div>
        )}
      </div>

      {/* Medical Certificate ----------------------------------------------- */}
      <div className="space-y-2">
        <label className="flex cursor-pointer items-center gap-2">
          <Checkbox
            checked={input.medCertRequired}
            onCheckedChange={(v) => update("medCertRequired", v === true)}
          />
          <span>Medical Certificate required</span>
        </label>
        {input.medCertRequired && (
          <div className="ml-6 space-y-1">
            <div className="flex flex-col gap-1">
              <Label
                htmlFor="med-cert-date"
                className={cn("text-xs", input.medCertRequired && !input.medCertReceivedDate && "text-destructive")}
              >
                Date Received
              </Label>
              <div className="flex w-fit items-center gap-1.5">
                <Input
                  id="med-cert-date"
                  type="date"
                  max={todayISO()}
                  value={input.medCertReceivedDate ?? ""}
                  onChange={(e) => update("medCertReceivedDate", e.target.value || null)}
                  className={cn(input.medCertRequired && !input.medCertReceivedDate && "border-destructive")}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  title="Set to today"
                  onClick={() => update("medCertReceivedDate", todayISO())}
                >
                  <CalendarCheck className="h-4 w-4" />
                </Button>
              </div>
              {input.medCertReceivedDate && (
                <p className="text-xs text-muted-foreground">
                  Recorded by {adminById(loaded.med_cert_received_by) || "you (on save)"}
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Pay status segmented toggle ------------------------------------- */}
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs">Pay Status</Label>
        <div className="inline-flex w-fit overflow-hidden rounded-md border">
          <button
            type="button"
            onClick={() => update("isPaid", true)}
            className={cn(
              "px-3 py-1 text-xs",
              input.isPaid ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted",
            )}
          >
            Paid
          </button>
          <button
            type="button"
            onClick={() => update("isPaid", false)}
            className={cn(
              "border-l px-3 py-1 text-xs",
              !input.isPaid ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted",
            )}
          >
            Unpaid
          </button>
        </div>
      </div>

      {/* HR Approved ------------------------------------------------------ */}
      <div className="space-y-1">
        <label className="flex cursor-pointer items-center gap-2">
          <Checkbox
            checked={input.hrApproved}
            onCheckedChange={(v) => update("hrApproved", v === true)}
          />
          <span>HR Approved</span>
        </label>
        {approvalLine && (
          <p className="ml-6 text-xs text-muted-foreground">{approvalLine}</p>
        )}
      </div>
      {/* callerMemberId is read by the server when stamping new approvals */}
      <input type="hidden" value={callerMemberId} readOnly />
    </div>
  );
}
