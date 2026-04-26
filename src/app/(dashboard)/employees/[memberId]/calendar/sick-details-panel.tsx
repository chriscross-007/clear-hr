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
import { cn } from "@/lib/utils";
import {
  getSickDetails,
  getSelfCertTemplateUrl,
  type SickDetailsInput,
} from "../../../sick-booking-actions";

export interface OrgAdminOption {
  id: string;
  firstName: string;
  lastName: string;
}

interface SickDetailsPanelProps {
  bookingId: string | null;
  callerMemberId: string;
  orgAdmins: OrgAdminOption[];
  hasSelfCertTemplate: boolean;
  onSickDetailsChange: (input: Omit<SickDetailsInput, "bookingId">) => void;
}

type LoadedExtras = {
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
  callerMemberId,
  orgAdmins,
  hasSelfCertTemplate,
  onSickDetailsChange,
}: SickDetailsPanelProps) {
  const [input, setInput] = useState<Omit<SickDetailsInput, "bookingId">>(DEFAULT_INPUT);
  const [loaded, setLoaded] = useState<LoadedExtras>({ hr_approved_by: null, hr_approved_at: null });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Stable callback ref so the parent can pass an inline lambda without
  // forcing this effect to re-fire on every render.
  const onChangeRef = useRef(onSickDetailsChange);
  onChangeRef.current = onSickDetailsChange;

  // Load on mount when editing an existing booking
  useEffect(() => {
    if (bookingId === null) {
      setInput(DEFAULT_INPUT);
      setLoaded({ hr_approved_by: null, hr_approved_at: null });
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
        return;
      }
      if (res.details) {
        setInput({
          selfCertRequired: res.details.self_cert_required,
          selfCertReceivedDate: res.details.self_cert_received_date,
          selfCertDocumentId: res.details.self_cert_document_id,
          btwRequired: res.details.btw_required,
          btwDate: res.details.btw_date,
          btwInterviewerId: res.details.btw_interviewer_id,
          isPaid: res.details.is_paid,
          hrApproved: res.details.hr_approved,
        });
        setLoaded({
          hr_approved_by: res.details.hr_approved_by,
          hr_approved_at: res.details.hr_approved_at,
        });
      } else {
        setInput(DEFAULT_INPUT);
        setLoaded({ hr_approved_by: null, hr_approved_at: null });
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
        <h4 className="font-semibold">Sick Absence Management</h4>
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
              <Input
                id="self-cert-date"
                type="date"
                value={input.selfCertReceivedDate ?? ""}
                onChange={(e) => update("selfCertReceivedDate", e.target.value || null)}
                className={cn("max-w-[180px]", selfCertDateMissing && "border-destructive")}
              />
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
          <div className="ml-6 grid gap-2 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor="btw-date" className="text-xs">Interview Date</Label>
              <Input
                id="btw-date"
                type="date"
                value={input.btwDate ?? ""}
                onChange={(e) => update("btwDate", e.target.value || null)}
              />
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
