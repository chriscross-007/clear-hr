"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Share2, Lock, Trash2, Star } from "lucide-react";
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
import type { StandardReport } from "../../definitions";
import { updateCustomReport, deleteCustomReport, toggleFavourite } from "../../actions";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { pluralize } from "@/lib/label-utils";
import { useMemberLabel } from "@/contexts/member-label-context";

interface CustomReportViewClientProps {
  customReport: {
    id: string;
    name: string;
    based_on: string;
    shared: boolean;
    created_by: string;
    prefs: { columns?: ColPref[]; filters?: Record<string, unknown>; groupBy?: string };
  };
  baseReport: StandardReport;
  members: Member[];
  teams: Team[];
  adminProfiles: Profile[];
  employeeProfiles: Profile[];
  customFieldDefs: FieldDef[];
  currencySymbol: string;
  userId: string;
  isCreator: boolean;
  isFavourited: boolean;
  orgName: string;
}

export function CustomReportViewClient({
  customReport,
  baseReport,
  members,
  teams,
  adminProfiles,
  employeeProfiles,
  customFieldDefs,
  currencySymbol,
  userId,
  isCreator,
  isFavourited: initialFavourited,
  orgName,
}: CustomReportViewClientProps) {
  const { memberLabel } = useMemberLabel();
  const router = useRouter();
  const [shared, setShared] = useState(customReport.shared);
  const [shareLoading, setShareLoading] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [favourited, setFavourited] = useState(initialFavourited);
  const [isPending, startTransition] = useTransition();

  const customFieldColIds = customFieldDefs.map((d) => `cf_${d.field_key}`);
  const effectiveDefaultCols = customReport.prefs.columns
    ? customReport.prefs.columns.filter((c) => c.visible).map((c) => c.id)
    : (baseReport.defaultColumns ?? DEFAULT_EMPLOYEE_COLS);

  const allColIds = [...ALL_EMPLOYEE_COLS, ...customFieldColIds];
  const allColLabels: Record<string, string> = {
    ...EMPLOYEE_COL_LABELS,
    ...Object.fromEntries(customFieldDefs.map((d) => [`cf_${d.field_key}`, d.label])),
  };

  const initialFilters = customReport.prefs.filters
    ? Object.entries(customReport.prefs.filters).map(([id, value]) => ({ id, value }))
    : baseReport.defaultFilters
    ? Object.entries(baseReport.defaultFilters).map(([id, value]) => ({ id, value }))
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

  async function handleExportPdf(
    rows: Member[],
    prefs: ColPref[],
    colLabels: Record<string, string>,
    orientation: "portrait" | "landscape",
    groupBy?: string
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
      const pdfColumns = prefs.filter((c) => c.visible && c.id !== "avatar").map((c) => ({ id: c.id, label: colLabels[c.id] ?? c.id }));
      const title = customReport.name;
      const blob = await pdf(
        <EmployeePDF rows={sortedRows} columns={pdfColumns} orgName={orgName} title={title} orientation={orientation} groupBy={groupBy} groupByLabel={groupBy ? (colLabels[groupBy] ?? groupBy) : undefined} />
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

  function handleToggleFavourite() {
    startTransition(async () => {
      const result = await toggleFavourite(customReport.id);
      if (result.success) {
        setFavourited(result.isFavourited ?? !favourited);
        router.refresh();
      }
    });
  }

  async function handleToggleShare() {
    setShareLoading(true);
    const result = await updateCustomReport(customReport.id, { shared: !shared });
    setShareLoading(false);
    if (result.success) setShared((s) => !s);
  }

  async function handleDelete() {
    setDeleteLoading(true);
    const result = await deleteCustomReport(customReport.id);
    setDeleteLoading(false);
    if (result.success) {
      router.refresh();
      router.push("/employees");
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
      {isCreator && (
        <>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleToggleShare}
            disabled={shareLoading}
          >
            {shared ? (
              <><Share2 className="h-4 w-4 mr-1.5" /> Shared</>
            ) : (
              <><Lock className="h-4 w-4 mr-1.5" /> Private</>
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={() => setShowDeleteDialog(true)}
          >
            <Trash2 className="h-4 w-4 mr-1.5" />
            Delete
          </Button>
        </>
      )}
    </div>
  );

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6">
        <p className="text-sm text-muted-foreground">Custom Report · based on {baseReport.groupLabel} — {baseReport.name}</p>
        <h1 className="text-2xl font-bold">{customReport.name}</h1>
      </div>

      <DataGrid<Member>
        data={members}
        columns={columns}
        gridId={`custom_${customReport.id}`}
        allCols={allColIds}
        defaultCols={effectiveDefaultCols}
        standardCols={ALL_EMPLOYEE_COLS}
        colLabels={allColLabels}
        initialColPrefs={customReport.prefs.columns ?? []}
        initialGroupBy={customReport.prefs.groupBy}
        userId={userId}
        toolbar={toolbar}
        emptyMessage={`No ${pluralize(memberLabel)} found.`}
        initialFilters={initialFilters}
        onExportPdf={handleExportPdf}
      />

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Custom Report</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &ldquo;{customReport.name}&rdquo;? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteLoading}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteLoading}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => { e.preventDefault(); handleDelete(); }}
            >
              {deleteLoading ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
