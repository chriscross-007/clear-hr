// Shared sort order for every document grid (admin member Documents
// tabs, Trash, the member's own My Documents tabs, both Organisation
// tabs): document type, then subtype, then file name. Case-insensitive,
// natural number order ("Policy 2" before "Policy 10"). Plain module so
// client components and server code can both use it.

import { DOCUMENT_TYPE_LABEL } from "@/app/(dashboard)/settings/documents/subtype-types";

const collator = new Intl.Collator("en-GB", { sensitivity: "base", numeric: true });

export interface DocSortKey {
  /** Internal type key (`contract`, `certificate`, …) — compared by its display label. */
  type?: string | null;
  subtypeName?: string | null;
  fileName?: string | null;
}

function typeLabel(type: string | null | undefined): string {
  if (!type) return "";
  return (DOCUMENT_TYPE_LABEL as Record<string, string>)[type] ?? type;
}

export function compareDocs(a: DocSortKey, b: DocSortKey): number {
  return (
    collator.compare(typeLabel(a.type), typeLabel(b.type)) ||
    collator.compare(a.subtypeName ?? "", b.subtypeName ?? "") ||
    collator.compare(a.fileName ?? "", b.fileName ?? "")
  );
}

/** Returns a sorted copy (does not mutate the input). */
export function sortDocs<T>(rows: readonly T[], key: (row: T) => DocSortKey): T[] {
  return [...rows].sort((x, y) => compareDocs(key(x), key(y)));
}
