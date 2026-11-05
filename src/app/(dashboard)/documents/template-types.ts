// CLE-237 — Document templates: DTOs shared by the template actions
// and their client components. Plain module (not "use server") so the
// types can be imported anywhere — never re-export them from the
// "use server" action file (Turbopack production build breaks on it).

import type { TemplateField, TemplateFieldKind } from "@/lib/document-template-fields";

export type { TemplateField, TemplateFieldKind };

/** Kinds a template may produce: org-issued member documents. */
export const TEMPLATE_SUBTYPE_TYPES = ["contract", "attachment"] as const;
export type TemplateSubtypeType = (typeof TEMPLATE_SUBTYPE_TYPES)[number];

export interface TemplateVersionRow {
  id: string;
  versionNumber: number;
  fileName: string;
  fileSize: number;
  uploadedAt: string;
  uploadedByName: string | null;
  fields: TemplateField[];
}

export interface DocumentTemplateRow {
  id: string;
  name: string;
  subtypeId: string;
  subtypeName: string;
  subtypeType: string;
  signOff: "none" | "acknowledge" | "sign";
  archivedAt: string | null;
  createdAt: string;
  current: TemplateVersionRow | null;
  versions: TemplateVersionRow[];
}

export interface TemplateSubtypeOption {
  id: string;
  name: string;
  type: TemplateSubtypeType;
  signOff: "none" | "acknowledge" | "sign";
}

/** One field on the "Create from template" check screen. */
export interface GenerationField {
  tag: string;
  kind: TemplateFieldKind;
  label: string;
  sensitive: boolean;
  /** Value taken from the member's record ("" when empty; "•••" when
   *  the caller can't view a sensitive value). Always "" for ask.*. */
  value: string;
}

export interface TemplateForMember {
  id: string;
  name: string;
  subtypeName: string;
  signOff: "none" | "acknowledge" | "sign";
}

export interface GenerationData {
  templateId: string;
  templateName: string;
  versionNumber: number;
  subtypeName: string;
  signOff: "none" | "acknowledge" | "sign";
  fields: GenerationField[];
  /** Labels of sensitive fields the caller can't merge (generation refused). */
  blockedSensitive: string[];
  rendererReady: boolean;
}
