// CLE-220 — This component has been retired.
//
// The "Documents to acknowledge" list surface was folded into the
// per-row "Please Ack" pill on /my-documents (both the "My Documents"
// and "Org Documents" tabs). The dedicated ack card and its filter
// chip were dropped when the /my-documents route was consolidated
// into a tabbed shell.
//
// This file is intentionally left in place as a tombstone — Cowork
// shells can't delete files from the codebase, so the empty module
// takes the file's slot until a routine cleanup pass removes it from
// the tree.
//
// Callers must import from:
//   * <MyDocumentsCard>       — the per-member required-docs list.
//   * <MyOrgDocumentsList>    — the org-docs read view.
//   * <DocumentDetailsDialog> — the per-doc Acknowledgement section
//                                (renders the "I have read and
//                                understood" button when the caller
//                                is expected to ack).
export {};
