"use client";

// CLE-220 — Tabs shell for the /my-documents page.
//
// CLE-231 — Four tabs, mirroring the admin view of a member's
// Documents (minus Trash):
//   * Certifications — what the member supplies: Right to Work + the
//     certificates required of them.
//   * Employment — what the organisation has issued to them (contract,
//     reviews…). HR-only kinds never reach this list.
//   * Other — everything else held on their record.
//   * Org — organisation-wide documents (only when the caller's
//     profile grants `can_view_organisation_documents`).
// Tab state is URL-driven via `?tab=certifications|employment|other|org`
// (default certifications) so a bookmark or a dashboard ack chip
// lands on the right tab.
//
// Follows the CLAUDE.md "Tabs in the sticky header" convention: the
// <Tabs> wrapper spans both <StickyPageHeader> and the <TabsContent>
// blocks, and the <TabsList> sits inside the sticky band.

import { useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Tabs, TabsContent, TabsList } from "@/components/ui/tabs";
import {
  DOC_TAB_LIST_CLASS,
  DocTabTrigger,
  docTabTooltip,
} from "@/components/documents/doc-tab-theme";
import { useMemberLabel } from "@/contexts/member-label-context";
import { StickyPageHeader } from "@/components/ui/sticky-page-header";
import { MyDocumentsCard } from "@/components/documents/my-documents-card";
import { MyOtherDocumentsCard } from "@/components/documents/my-other-documents-card";
import { MyOrgDocumentsList } from "@/components/documents/my-org-documents-list";
import type { OrgDocumentRow } from "@/app/(dashboard)/documents/organisation/org-document-actions-impl";

type TabKey = "certifications" | "employment" | "other" | "org";
const TAB_KEYS: readonly TabKey[] = ["certifications", "employment", "other", "org"];

export function MyDocumentsClient({
  memberId,
  memberName,
  initialTab,
  canViewOrgDocs,
  initialOrgRows,
}: {
  memberId: string;
  memberName: string;
  initialTab: TabKey;
  /** When false the "Org" tab is hidden entirely (the caller's rights
   *  profile doesn't grant `can_view_organisation_documents`). */
  canViewOrgDocs: boolean;
  initialOrgRows: OrgDocumentRow[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { memberLabel } = useMemberLabel();
  const tipOpts = { self: true, memberLabel };
  const activeTab: TabKey = initialTab === "org" && !canViewOrgDocs ? "certifications" : initialTab;

  const onTabChange = useCallback(
    (v: string) => {
      const next: TabKey = (TAB_KEYS as readonly string[]).includes(v) ? (v as TabKey) : "certifications";
      const params = new URLSearchParams(searchParams.toString());
      if (next === "certifications") params.delete("tab");
      else params.set("tab", next);
      const qs = params.toString();
      router.replace(qs ? `/my-documents?${qs}` : "/my-documents", { scroll: false });
    },
    [router, searchParams],
  );

  return (
    <Tabs value={activeTab} onValueChange={onTabChange} className="w-full">
      <StickyPageHeader>
        <div className="flex items-center justify-between gap-4 mb-3">
          <h1 className="text-2xl font-bold">Documents</h1>
        </div>
        {/* Colour-keyed tab buttons (doc-tab-theme): the active tab's
            card header uses the same pastel. */}
        <TabsList className={DOC_TAB_LIST_CLASS}>
          <DocTabTrigger tab="certifications" tooltip={docTabTooltip("certifications", tipOpts)} />
          <DocTabTrigger tab="employment" tooltip={docTabTooltip("employment", tipOpts)} />
          <DocTabTrigger tab="other" tooltip={docTabTooltip("other", tipOpts)} />
          {canViewOrgDocs && <DocTabTrigger tab="org" tooltip={docTabTooltip("org", tipOpts)} />}
        </TabsList>
      </StickyPageHeader>

      <TabsContent value="certifications" className="mt-4">
        <div className="mx-auto max-w-4xl space-y-6">
          <MyDocumentsCard memberId={memberId} memberName={memberName} tone="certifications" />
        </div>
      </TabsContent>

      <TabsContent value="employment" className="mt-4">
        <div className="mx-auto max-w-4xl space-y-6">
          <MyOtherDocumentsCard memberId={memberId} bucket="employment" tone="employment" />
        </div>
      </TabsContent>

      <TabsContent value="other" className="mt-4">
        <div className="mx-auto max-w-4xl space-y-6">
          <MyOtherDocumentsCard memberId={memberId} bucket="other" tone="other" />
        </div>
      </TabsContent>

      {canViewOrgDocs && (
        <TabsContent value="org" className="mt-4">
          <div className="mx-auto max-w-4xl space-y-6">
            <MyOrgDocumentsList memberId={memberId} initialRows={initialOrgRows} tone="org" />
          </div>
        </TabsContent>
      )}
    </Tabs>
  );
}
