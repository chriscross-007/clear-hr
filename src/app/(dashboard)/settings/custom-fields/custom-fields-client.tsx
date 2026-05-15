"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CustomFieldsManager } from "@/app/(dashboard)/organisation-edit-dialog-custom-fields";
import type { FieldDef } from "@/app/(dashboard)/employees/custom-field-actions";

// CLE-191 — Thin client wrapper around CustomFieldsManager. The manager
// owns CRUD via its own server actions; we hold the list in state and
// trigger router.refresh() when defs change so consuming pages (e.g.
// employees directory) pick up the new shape.

interface CustomFieldsPageClientProps {
  initialDefs: FieldDef[];
  currencySymbol: string;
}

export function CustomFieldsPageClient({ initialDefs, currencySymbol }: CustomFieldsPageClientProps) {
  const router = useRouter();
  const [defs, setDefs] = useState<FieldDef[]>(initialDefs);

  return (
    <CustomFieldsManager
      defs={defs}
      onDefsChange={(next) => {
        setDefs(next);
        // Surface schema changes to other pages that key off field defs.
        router.refresh();
      }}
      currencySymbol={currencySymbol}
    />
  );
}
