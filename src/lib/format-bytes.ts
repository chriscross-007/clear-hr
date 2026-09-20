// CLE-221 follow-up — shared byte-size formatter.
//
// Same rounding used by the audit MetadataDetail panel and by the
// three document list surfaces (My Documents, My other documents,
// Org Documents), so a doc's size reads identically wherever it
// appears. Whole-KB under 1 MB; one-decimal MB above.
//
// Returns the raw input as a string for non-finite inputs so
// unexpected values (e.g. a legacy row missing a size) never crash
// the render.

export function fmtBytes(bytes: unknown): string {
  if (typeof bytes !== "number" || !Number.isFinite(bytes)) return String(bytes);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
