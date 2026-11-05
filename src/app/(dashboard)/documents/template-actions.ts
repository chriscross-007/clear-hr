"use server";

// CLE-237 — Document templates (merge fields → PDF).
// Spec: Spec Vault → specs/Documents/09 Document Templates.md
//
// Thin cookies-auth wrappers over `template-actions-impl.ts`, which the
// Word add-in API routes (CLE-238, /api/word-addin/*) share.
//
// Setup (Settings → Documents → Templates) needs `can_edit_org_settings`.
// Generating a member's document needs Documents-tab update with reach
// over the member (the same rule as uploading one).
//
// Types live in `./template-types` (and `CatalogueField` in the impl) —
// import them from there (never re-export types from this "use server"
// file; Turbopack's production build breaks on it).

import { buildDocumentsCallerFromCookies } from "@/lib/documents-caller";
import {
  _createDocumentTemplate,
  _generateDocumentFromTemplate,
  _getTemplateGenerationData,
  _getTemplateVersionDownloadUrl,
  _inspectTemplateFile,
  _listDocumentTemplates,
  _listTemplatePreviewMembers,
  _listTemplatesForMember,
  _listTemplateSubtypes,
  _previewDocumentTemplate,
  _setDocumentTemplateArchived,
  _updateDocumentTemplate,
  _uploadTemplateVersion,
} from "./template-actions-impl";

const NOT_AUTH = { success: false as const, error: "Not authenticated" };

export async function listDocumentTemplates() {
  const caller = await buildDocumentsCallerFromCookies();
  if (!caller) return NOT_AUTH;
  return _listDocumentTemplates(caller);
}

export async function listTemplateSubtypes() {
  const caller = await buildDocumentsCallerFromCookies();
  if (!caller) return NOT_AUTH;
  return _listTemplateSubtypes(caller);
}

/** Reads a .docx and lists its merge fields — nothing is saved. */
export async function inspectTemplateFile(formData: FormData) {
  const caller = await buildDocumentsCallerFromCookies();
  if (!caller) return NOT_AUTH;
  return _inspectTemplateFile(caller, formData);
}

/** formData: name, subtypeId, file (.docx). */
export async function createDocumentTemplate(formData: FormData) {
  const caller = await buildDocumentsCallerFromCookies();
  if (!caller) return NOT_AUTH;
  return _createDocumentTemplate(caller, formData);
}

export async function updateDocumentTemplate(templateId: string, input: { name: string; subtypeId: string }) {
  const caller = await buildDocumentsCallerFromCookies();
  if (!caller) return NOT_AUTH;
  return _updateDocumentTemplate(caller, templateId, input);
}

/** Replace the template's .docx — kept as a new template version. */
export async function uploadTemplateVersion(templateId: string, formData: FormData) {
  const caller = await buildDocumentsCallerFromCookies();
  if (!caller) return NOT_AUTH;
  return _uploadTemplateVersion(caller, templateId, formData);
}

export async function setDocumentTemplateArchived(templateId: string, archived: boolean) {
  const caller = await buildDocumentsCallerFromCookies();
  if (!caller) return NOT_AUTH;
  return _setDocumentTemplateArchived(caller, templateId, archived);
}

export async function getTemplateVersionDownloadUrl(versionId: string) {
  const caller = await buildDocumentsCallerFromCookies();
  if (!caller) return NOT_AUTH;
  return _getTemplateVersionDownloadUrl(caller, versionId);
}

export async function listTemplatePreviewMembers() {
  const caller = await buildDocumentsCallerFromCookies();
  if (!caller) return NOT_AUTH;
  return _listTemplatePreviewMembers(caller);
}

/** Sample PDF with a chosen member's details — nothing is filed. */
export async function previewDocumentTemplate(templateId: string, memberId: string) {
  const caller = await buildDocumentsCallerFromCookies();
  if (!caller) return NOT_AUTH;
  return _previewDocumentTemplate(caller, templateId, memberId);
}

export async function listTemplatesForMember(memberId: string, bucket: "employment" | "other") {
  const caller = await buildDocumentsCallerFromCookies();
  if (!caller) return NOT_AUTH;
  return _listTemplatesForMember(caller, memberId, bucket);
}

export async function getTemplateGenerationData(templateId: string, memberId: string) {
  const caller = await buildDocumentsCallerFromCookies();
  if (!caller) return NOT_AUTH;
  return _getTemplateGenerationData(caller, templateId, memberId);
}

/** Fill → PDF → file as a new member document. */
export async function generateDocumentFromTemplate(templateId: string, memberId: string, values: Record<string, string>) {
  const caller = await buildDocumentsCallerFromCookies();
  if (!caller) return NOT_AUTH;
  return _generateDocumentFromTemplate(caller, templateId, memberId, values);
}
