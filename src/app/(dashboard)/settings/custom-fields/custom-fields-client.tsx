"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CustomFieldsManager } from "@/app/(dashboard)/organisation-edit-dialog-custom-fields";
import type { FieldDef } from "@/app/(dashboard)/employees/custom-field-actions";

// CLE-191 — Thin client wrapper around CustomFieldsManager. The manager
// owns CRUD via its own server actions; we hold the list in state and
// trigger router.refresh() when defs change so consuming pages (e.g.
// employees directory) pick up the new shape.
//
// `canEdit` is derived from the new tri-state `can_define_custom_fields`
// right ("read" lands here with canEdit=false). The manager hides write
// affordances when canEdit=false; the server actions also enforce the
// gate as a defence in depth.

interface CustomFieldsPageClientProps {
  initialDefs: FieldDef[];
  currencySymbol: string;
  canEdit: boolean;
}

export function CustomFieldsPageClient({
  initialDefs,
  currencySymbol,
  canEdit,
}: CustomFieldsPageClientProps) {
  const router = useRouter();
  const [defs, setDefs] = useState<FieldDef[]>(initialDefs);

  return (
    <div className="space-y-4">
      {!canEdit && (
        <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          You have read-only access to custom field definitions. Ask an owner
          for write access if you need to add, edit or delete fields.
        </div>
      )}
      <CustomFieldsManager
        defs={defs}
        onDefsChange={(next) => {
          setDefs(next);
          // Surface schema changes to other pages that key off field defs.
          router.refresh();
        }}
        currencySymbol={currencySymbol}
        canEdit={canEdit}
      />
    </div>
  );
}
