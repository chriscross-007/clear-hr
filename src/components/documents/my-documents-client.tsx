"use client";

// CLE-220 — Tabs shell for the /my-documents page.
//
// Two tabs: "My Documents" (per-member required-docs list) and "Org
// Documents" (organisation-wide docs, if the caller has view rights).
// Tab state is URL-driven via `?tab=my|org` so a bookmark of the org
// tab lands on it, and a page-reload from within the tab keeps the
// user in place.
//
// Follows the CLAUDE.md "Tabs in the sticky header" convention: the
// <Tabs> wrapper spans both <StickyPageHeader> and the two
// <TabsContent> blocks, and the <TabsList> sits inside the sticky
// band so it stays pinned while row lists scroll beneath.

import { useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StickyPageHeader } from "@/components/ui/sticky-page-header";
import { MyDocumentsCard } from "@/components/documents/my-documents-card";
import { MyOtherDocumentsCard } from "@/components/documents/my-other-documents-card";
import { MyOrgDocumentsList } from "@/components/documents/my-org-documents-list";
import type { OrgDocumentRow } from "@/app/(dashboard)/documents/organisation/org-document-actions-impl";

type TabKey = "my" | "org";

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
  /** When false the "Org Documents" tab is hidden entirely (the
   *  caller's rights profile doesn't grant `can_view_organisation_
   *  documents`). We render just the My Documents tab; the tab strip
   *  degrades to a single trigger. */
  canViewOrgDocs: boolean;
  initialOrgRows: OrgDocumentRow[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const onTabChange = useCallback(
    (v: string) => {
      const next = v === "org" ? "org" : "my";
      const params = new URLSearchParams(searchParams.toString());
      if (next === "my") params.delete("tab");
      else params.set("tab", next);
      const qs = params.toString();
      router.replace(qs ? `/my-documents?${qs}` : "/my-documents", { scroll: false });
    },
    [router, searchParams],
  );

  return (
    <Tabs
      value={initialTab}
      onValueChange={onTabChange}
      className="w-full"
    >
      <StickyPageHeader>
        <div className="flex items-center justify-between gap-4 mb-3">
          <h1 className="text-2xl font-bold">Documents</h1>
        </div>
        <TabsList>
          <TabsTrigger value="my">My Documents</TabsTrigger>
          {canViewOrgDocs && (
            <TabsTrigger value="org">Org Documents</TabsTrigger>
          )}
        </TabsList>
      </StickyPageHeader>

      <TabsContent value="my" className="mt-4">
        <div className="mx-auto max-w-4xl space-y-6">
          <MyDocumentsCard memberId={memberId} memberName={memberName} />
          {/* CLE-221 — informational tail. Every member-scope doc the
              caller owns that the required card does NOT already
              surface. Read-only; refreshes off the same event bus. */}
          <MyOtherDocumentsCard memberId={memberId} />
        </div>
      </TabsContent>

      {canViewOrgDocs && (
        <TabsContent value="org" className="mt-4">
          <div className="mx-auto max-w-4xl space-y-6">
            <MyOrgDocumentsList memberId={memberId} initialRows={initialOrgRows} />
          </div>
        </TabsContent>
      )}
    </Tabs>
  );
}
