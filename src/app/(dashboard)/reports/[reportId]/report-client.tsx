"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Star, Save, Plus } from "lucide-react";
import { DataGrid } from "@/components/data-grid/data-grid";
import {
  buildEmployeeColumns,
  type Member,
  type Team,
  ALL_EMPLOYEE_COLS,
  DEFAULT_EMPLOYEE_COLS,
  EMPLOYEE_COL_LABELS,
} from "@/app/(dashboard)/employees/employee-columns";
import type { ColPref } from "@/lib/grid-prefs-actions";
import type { Profile } from "@/app/(dashboard)/employees/profile-actions";
import type { FieldDef } from "@/app/(dashboard)/employees/custom-field-actions";
import type { StandardReport } from "../definitions";
import { toggleFavourite, createCustomReport } from "../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { capitalize, pluralize } from "@/lib/label-utils";
import { useMemberLabel } from "@/contexts/member-label-context";

interface ReportClientProps {
  report: StandardReport;
  members: Member[];
  teams: Team[];
  adminProfiles: Profile[];
  employeeProfiles: Profile[];
  customFieldDefs: FieldDef[];
  currencySymbol: string;
  canSeeCurrency: boolean;
  initialColumnPrefs: ColPref[];
  initialGroupBy?: string;
  initialPdfPageBreak?: boolean;
  initialPdfRepeatHeaders?: boolean;
  initialAggregateMetrics?: string[];
  gridId: string;
  userId: string;
  isFavourited: boolean;
  canCreateCustom: boolean;
  callerMemberId: string;
  existingCustomReports: { id: string; name: string; based_on: string; shared: boolean; created_by: string }[];
  orgName: string;
}

export function ReportClient({
  report,
  members,
  teams,
  adminProfiles,
  employeeProfiles,
  customFieldDefs,
  currencySymbol,
  initialColumnPrefs,
  initialGroupBy,
  initialPdfPageBreak,
  initialPdfRepeatHeaders,
  initialAggregateMetrics,
  gridId,
  userId,
  isFavourited: initialFavourited,
  canCreateCustom,
  orgName,
}: ReportClientProps) {
  const { memberLabel } = useMemberLabel();
  const router = useRouter();
  const [favourited, setFavourited] = useState(initialFavourited);
  const [isPending, startTransition] = useTransition();
  const [showSaveAsDialog, setShowSaveAsDialog] = useState(false);
  const [saveAsName, setSaveAsName] = useState("");
  const [saveAsShared, setSaveAsShared] = useState<"private" | "shared">("private");
  const [saveAsLoading, setSaveAsLoading] = useState(false);
  const [saveAsError, setSaveAsError] = useState<string | null>(null);

  const customFieldColIds = customFieldDefs.map((d) => `cf_${d.field_key}`);
  // For "custom-fields" report, default to showing all custom field columns
  const effectiveDefaultCols = report.id === "employees.custom-fields"
    ? [...(report.defaultColumns ?? DEFAULT_EMPLOYEE_COLS), ...customFieldColIds]
    : (report.defaultColumns ?? DEFAULT_EMPLOYEE_COLS);

  const allColIds = [...ALL_EMPLOYEE_COLS, ...customFieldColIds];
  const allColLabels: Record<string, string> = {
    ...EMPLOYEE_COL_LABELS,
    ...Object.fromEntries(customFieldDefs.map((d) => [`cf_${d.field_key}`, d.label])),
  };

  const initialFilters = report.defaultFilters
    ? Object.entries(report.defaultFilters).map(([id, value]) => ({ id, value }))
    : [];

  const columns = buildEmployeeColumns({
    teams,
    adminProfiles,
    employeeProfiles,
    memberLabel,
    canAdd: false,
    currencySymbol,
    customFieldDefs,
  });

  function handleToggleFavourite() {
    startTransition(async () => {
      const result = await toggleFavourite(report.id);
      if (result.success) {
        setFavourited(result.isFavourited ?? !favourited);
        router.refresh();
      }
    });
  }

  async function handleExportPdf(
    rows: Member[],
    prefs: ColPref[],
    colLabels: Record<string, string>,
    orientation: "portrait" | "landscape",
    groupBy?: string,
    pdfPageBreak?: boolean,
    pdfRepeatHeaders?: boolean,
    aggregateMetrics?: string[]
  ) {
    try {
      const [{ pdf }, { EmployeePDF }, { formatMemberForPdf }] = await Promise.all([
        import("@react-pdf/renderer"),
        import("@/app/(dashboard)/employees/employee-pdf"),
        import("@/lib/format-member-pdf-row"),
      ]);
      const formattedRows = rows.map((m) =>
        formatMemberForPdf(m, { teams, customFieldDefs, currencySymbol, memberLabel })
      );
      const sortedRows = groupBy
        ? [...formattedRows].sort((a, b) => (a[groupBy] ?? "").localeCompare(b[groupBy] ?? ""))
        : formattedRows;
      const pdfColumns = prefs.filter((c) => c.visible && c.id !== "avatar").map((c) => {
        const def = c.id.startsWith("cf_") ? customFieldDefs.find((d) => `cf_${d.field_key}` === c.id) : null;
        return {
          id: c.id,
          label: colLabels[c.id] ?? c.id,
          ...(def && (def.field_type === "number" || def.field_type === "currency") ? {
            aggregateFormat: def.field_type as "currency" | "number",
            aggregateCurrencySymbol: def.field_type === "currency" ? currencySymbol : undefined,
            aggregateDecimals: def.field_type === "number" ? def.max_decimal_places : 2,
          } : {}),
        };
      });
      const title = report.name;
      const blob = await pdf(
        <EmployeePDF rows={sortedRows} columns={pdfColumns} orgName={orgName} title={title} orientation={orientation} groupBy={groupBy} groupByLabel={groupBy ? (colLabels[groupBy] ?? groupBy) : undefined} pdfPageBreak={pdfPageBreak} pdfRepeatHeaders={pdfRepeatHeaders} aggregateMetrics={aggregateMetrics} />
      ).toBlob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${title}.pdf`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("PDF generation failed:", err);
    }
  }

  async function handleSaveAs() {
    if (!saveAsName.trim()) return;
    setSaveAsLoading(true);
    setSaveAsError(null);
    const result = await createCustomReport({
      name: saveAsName.trim(),
      based_on: report.id,
      shared: saveAsShared === "shared",
    });
    setSaveAsLoading(false);
    if (!result.success) {
      setSaveAsError(result.error ?? "Failed to create report");
    } else {
      setShowSaveAsDialog(false);
      setSaveAsName("");
      router.refresh();
    }
  }

  const toolbar = (
    <div className="flex items-center gap-2">
      <Button
        variant="ghost"
        size="sm"
        onClick={handleToggleFavourite}
        disabled={isPending}
        className={favourited ? "text-amber-500 hover:text-amber-600" : "text-muted-foreground"}
      >
        <Star className={`h-4 w-4 mr-1.5 ${favourited ? "fill-current" : ""}`} />
        {favourited ? "Favourited" : "Favourite"}
      </Button>
      {canCreateCustom && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setSaveAsName(`${report.name} (copy)`);
            setShowSaveAsDialog(true);
          }}
        >
          <Save className="h-4 w-4 mr-1.5" />
          Save As...
        </Button>
      )}
    </div>
  );

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6">
        <p className="text-sm text-muted-foreground">{report.groupLabel} · Report</p>
        <h1 className="text-2xl font-bold">{report.name}</h1>
        <p className="text-sm text-muted-foreground mt-1">{report.description}</p>
      </div>

      <DataGrid<Member>
        data={members}
        columns={columns}
        gridId={gridId}
        allCols={allColIds}
        defaultCols={effectiveDefaultCols}
        standardCols={ALL_EMPLOYEE_COLS}
        colLabels={allColLabels}
        initialColPrefs={initialColumnPrefs}
        initialGroupBy={initialGroupBy}
        initialPdfPageBreak={initialPdfPageBreak}
        initialPdfRepeatHeaders={initialPdfRepeatHeaders}
        initialAggregateMetrics={initialAggregateMetrics}
        userId={userId}
        toolbar={toolbar}
        emptyMessage={`No ${pluralize(memberLabel)} found.`}
        initialFilters={initialFilters}
        onExportPdf={handleExportPdf}
      />

      {/* Save As dialog */}
      <Dialog open={showSaveAsDialog} onOpenChange={setShowSaveAsDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save as Custom Report</DialogTitle>
            <DialogDescription>
              Create a named custom report based on &ldquo;{report.name}&rdquo;.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {saveAsError && (
              <p className="text-sm text-destructive">{saveAsError}</p>
            )}
            <div className="space-y-2">
              <Label htmlFor="report-name">Report name</Label>
              <Input
                id="report-name"
                value={saveAsName}
                onChange={(e) => setSaveAsName(e.target.value)}
                placeholder="Enter a name..."
              />
            </div>
            <div className="space-y-2">
              <Label>Visibility</Label>
              <Select
                value={saveAsShared}
                onValueChange={(v) => setSaveAsShared(v as "private" | "shared")}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="private">Private (only me)</SelectItem>
                  <SelectItem value="shared">Shared (all admins)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSaveAsDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveAs} disabled={saveAsLoading || !saveAsName.trim()}>
              <Plus className="h-4 w-4 mr-1.5" />
              {saveAsLoading ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Re-export for convenience
export { capitalize };
