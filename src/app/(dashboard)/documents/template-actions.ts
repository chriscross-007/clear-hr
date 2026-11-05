"use server";

// CLE-237 — Document templates (merge fields → PDF).
// Spec: Spec Vault → specs/Documents/09 Document Templates.md
//
// Setup (Settings → Documents → Templates) needs `can_edit_org_settings`.
// Generating a member's document needs Documents-tab update with reach
// over the member (the same rule as uploading one).
//
// Types live in `./template-types` — import them from there (never
// re-export types from this "use server" file).

import { revalidatePath } from "next/cache";
import { buildDocumentsCallerFromCookies, type DocumentsCaller } from "@/lib/documents-caller";
import { logAudit } from "@/lib/audit";
import { seedNextReviewOnUpload } from "@/lib/document-status";
import { MEMBER_DOCUMENTS_BUCKET } from "@/lib/document-limits";
import { SENSITIVE_REDACTION } from "@/lib/sensitive-fields";
import {
  BUILT_IN_FIELDS,
  DOCX_CONTENT_TYPE,
  classifyTag,
  extractTemplateTags,
  fillTemplate,
  resolveTemplateValues,
  type TemplateCustomFieldDef,
  type TemplateField,
} from "@/lib/document-template-fields";
import { renderDocxToPdf, rendererConfigured, RENDERER_NOT_CONFIGURED_ERROR } from "@/lib/document-renderer";
import {
  TEMPLATE_SUBTYPE_TYPES,
  type DocumentTemplateRow,
  type GenerationData,
  type GenerationField,
  type TemplateForMember,
  type TemplateSubtypeOption,
  type TemplateVersionRow,
} from "./template-types";

const TEMPLATE_BUCKET = "document-templates";
const MAX_TEMPLATE_SIZE = 10 * 1024 * 1024;
const NOT_AUTH = { success: false as const, error: "Not authenticated" };
const NO_SETUP = { success: false as const, error: "You don't have permission to manage document templates." };

type Fail = { success: false; error: string };
const fail = (e: unknown): Fail => ({ success: false, error: e instanceof Error ? e.message : "An error occurred" });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function callerName(caller: DocumentsCaller): Promise<string> {
  const { data } = await caller.admin.from("members").select("first_name, last_name").eq("id", caller.memberId).single();
  return `${data?.first_name ?? ""} ${data?.last_name ?? ""}`.trim() || "Unknown";
}

async function loadCustomDefs(caller: DocumentsCaller): Promise<TemplateCustomFieldDef[]> {
  const { data } = await caller.admin
    .from("custom_field_definitions")
    .select("field_key, label, field_type, input_mode, is_sensitive")
    .eq("organisation_id", caller.organisationId)
    .eq("object_type", "member");
  return (data ?? []) as TemplateCustomFieldDef[];
}

function signOffOf(v: unknown): "none" | "acknowledge" | "sign" {
  return v === "sign" || v === "acknowledge" ? v : "none";
}

/** Reads and classifies an uploaded .docx. */
async function readTemplateFile(
  file: FormDataEntryValue | null,
  defs: TemplateCustomFieldDef[],
): Promise<{ ok: true; bytes: Uint8Array; name: string; size: number; fields: TemplateField[] } | { ok: false; error: string }> {
  if (!(file instanceof File)) return { ok: false, error: "Choose a Word (.docx) file." };
  if (!file.name.toLowerCase().endsWith(".docx")) return { ok: false, error: "Templates must be Word .docx files." };
  if (file.size > MAX_TEMPLATE_SIZE) return { ok: false, error: "This file is too large. The limit is 10 MB." };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const tags = extractTemplateTags(bytes);
  if (!tags.ok) return { ok: false, error: tags.error };
  return { ok: true, bytes, name: file.name.substring(0, 255), size: file.size, fields: tags.tags.map((t) => classifyTag(t, defs)) };
}

function unknownFieldsError(fields: TemplateField[]): string | null {
  const unknown = fields.filter((f) => f.kind === "unknown").map((f) => `{{${f.tag}}}`);
  if (unknown.length === 0) return null;
  return `This template has merge fields ClearHR doesn't recognise: ${unknown.join(", ")}. Fix them in Word and upload again.`;
}

async function loadSubtype(caller: DocumentsCaller, subtypeId: string) {
  const { data } = await caller.admin
    .from("document_subtype")
    .select("id, type, name, retention_class, visible_to_member, review_period_months, requires_verification, sign_off")
    .eq("id", subtypeId)
    .eq("organisation_id", caller.organisationId)
    .single();
  if (!data || !(TEMPLATE_SUBTYPE_TYPES as readonly string[]).includes(data.type as string)) return null;
  return data as {
    id: string;
    type: string;
    name: string;
    retention_class: string;
    visible_to_member: boolean | null;
    review_period_months: number | null;
    requires_verification: boolean | null;
    sign_off: string | null;
  };
}

interface TemplateDb {
  id: string;
  organisation_id: string;
  name: string;
  subtype_id: string;
  archived_at: string | null;
  created_at: string;
}

async function loadTemplate(caller: DocumentsCaller, templateId: string): Promise<TemplateDb | null> {
  const { data } = await caller.admin
    .from("document_template")
    .select("id, organisation_id, name, subtype_id, archived_at, created_at")
    .eq("id", templateId)
    .eq("organisation_id", caller.organisationId)
    .single();
  return (data as TemplateDb | null) ?? null;
}

interface VersionDb {
  id: string;
  template_id: string;
  version_number: number;
  storage_path: string;
  file_name: string;
  file_size: number;
  fields: TemplateField[] | null;
  uploaded_by: string | null;
  uploaded_at: string;
}
const VERSION_COLS = "id, template_id, version_number, storage_path, file_name, file_size, fields, uploaded_by, uploaded_at";

async function latestVersion(caller: DocumentsCaller, templateId: string): Promise<VersionDb | null> {
  const { data } = await caller.admin
    .from("document_template_version")
    .select(VERSION_COLS)
    .eq("template_id", templateId)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as VersionDb | null) ?? null;
}

async function storeVersion(
  caller: DocumentsCaller,
  templateId: string,
  versionNumber: number,
  file: { bytes: Uint8Array; name: string; size: number; fields: TemplateField[] },
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const storagePath = `${caller.organisationId}/${templateId}/v${versionNumber}-${crypto.randomUUID()}.docx`;
  const { error: upErr } = await caller.admin.storage
    .from(TEMPLATE_BUCKET)
    .upload(storagePath, file.bytes, { contentType: DOCX_CONTENT_TYPE, upsert: false });
  if (upErr) return { ok: false, error: upErr.message };
  const { data, error } = await caller.admin
    .from("document_template_version")
    .insert({
      template_id: templateId,
      version_number: versionNumber,
      storage_path: storagePath,
      file_name: file.name,
      file_size: file.size,
      fields: file.fields,
      uploaded_by: caller.memberId,
    })
    .select("id")
    .single();
  if (error || !data) {
    await caller.admin.storage.from(TEMPLATE_BUCKET).remove([storagePath]);
    return { ok: false, error: error?.message ?? "Failed to save the template file" };
  }
  return { ok: true, id: data.id as string };
}

async function downloadVersion(caller: DocumentsCaller, v: VersionDb): Promise<Uint8Array> {
  const { data, error } = await caller.admin.storage.from(TEMPLATE_BUCKET).download(v.storage_path);
  if (error || !data) throw new Error("The template file couldn't be read.");
  return new Uint8Array(await data.arrayBuffer());
}

function canUpdateMember(caller: DocumentsCaller, target: { id: string; team_id: string | null }): boolean {
  const update = caller.rights.tabs.documents?.update === true;
  if (!update) return false;
  if (target.id === caller.memberId) return true;
  if (caller.rights.crossUserAccess === "all") return true;
  if (caller.rights.crossUserAccess === "team") return target.team_id !== null && target.team_id === caller.teamId;
  return false;
}

interface MemberDb {
  id: string;
  team_id: string | null;
  first_name: string | null;
  last_name: string | null;
  known_as: string | null;
  email: string | null;
  start_date: string | null;
  custom_fields: Record<string, unknown> | null;
}

async function loadMember(caller: DocumentsCaller, memberId: string): Promise<MemberDb | null> {
  const { data } = await caller.admin
    .from("members")
    .select("id, team_id, first_name, last_name, known_as, email, start_date, custom_fields")
    .eq("id", memberId)
    .eq("organisation_id", caller.organisationId)
    .single();
  return (data as MemberDb | null) ?? null;
}

/** Fields (re-classified against today's custom fields) + record values. */
async function resolveForMember(caller: DocumentsCaller, version: VersionDb, member: MemberDb) {
  const defs = await loadCustomDefs(caller);
  const fields = (version.fields ?? []).map((f) => classifyTag(f.tag, defs));
  const [{ data: org }, { data: team }] = await Promise.all([
    caller.admin.from("organisations").select("name, currency_symbol").eq("id", caller.organisationId).single(),
    member.team_id
      ? caller.admin.from("teams").select("name").eq("id", member.team_id).single()
      : Promise.resolve({ data: null as { name: string } | null }),
  ]);
  const values = resolveTemplateValues(fields, {
    member,
    teamName: (team as { name: string } | null)?.name ?? null,
    organisationName: (org?.name as string) ?? "",
    currencySymbol: (org?.currency_symbol as string) ?? "£",
    customDefs: defs,
  });
  const blockedSensitive = caller.rights.canViewSensitiveFields
    ? []
    : fields.filter((f) => f.sensitive).map((f) => f.label);
  return { fields, values, blockedSensitive };
}

/** Builds the PDF bytes for a member. `input` = ask answers + overrides. */
async function buildPdf(
  caller: DocumentsCaller,
  version: VersionDb,
  member: MemberDb,
  input: Record<string, string>,
): Promise<
  | { ok: true; pdf: Uint8Array; generationValues: Record<string, string>; fields: TemplateField[] }
  | { ok: false; error: string }
> {
  const { fields, values, blockedSensitive } = await resolveForMember(caller, version, member);
  if (fields.some((f) => f.kind === "unknown")) {
    return { ok: false, error: unknownFieldsError(fields) ?? "This template has unrecognised merge fields." };
  }
  if (blockedSensitive.length > 0) {
    return {
      ok: false,
      error: `This template uses sensitive fields you can't view (${blockedSensitive.join(", ")}), so you can't generate it.`,
    };
  }
  const merged: Record<string, string> = { ...values };
  const generationValues: Record<string, string> = {};
  for (const f of fields) {
    const supplied = typeof input[f.tag] === "string" ? input[f.tag].trim().slice(0, 2000) : undefined;
    if (supplied === undefined) continue;
    if (f.kind === "ask" || supplied !== (values[f.tag] ?? "")) {
      merged[f.tag] = supplied;
      generationValues[f.tag] = supplied;
    }
  }
  const missingAsk = fields.filter((f) => f.kind === "ask" && !merged[f.tag]).map((f) => f.label);
  if (missingAsk.length > 0) return { ok: false, error: `Please answer: ${missingAsk.join(", ")}.` };

  const bytes = await downloadVersion(caller, version);
  let filled: Uint8Array;
  try {
    filled = fillTemplate(bytes, merged);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "The template couldn't be filled." };
  }
  try {
    const pdf = await renderDocxToPdf(filled);
    return { ok: true, pdf, generationValues, fields };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "PDF conversion failed." };
  }
}

function toVersionRow(v: VersionDb, names: Map<string, string>): TemplateVersionRow {
  return {
    id: v.id,
    versionNumber: v.version_number,
    fileName: v.file_name,
    fileSize: Number(v.file_size ?? 0),
    uploadedAt: v.uploaded_at,
    uploadedByName: v.uploaded_by ? (names.get(v.uploaded_by) ?? null) : null,
    fields: v.fields ?? [],
  };
}

function safeFilePart(s: string): string {
  return s.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Setup — Settings → Documents → Templates
// ---------------------------------------------------------------------------

export async function listDocumentTemplates(): Promise<
  | { success: true; templates: DocumentTemplateRow[]; rendererReady: boolean; catalogue: { tag: string; label: string }[] }
  | Fail
> {
  try {
    const caller = await buildDocumentsCallerFromCookies();
    if (!caller) return NOT_AUTH;
    if (!caller.rights.canEditOrgSettings) return NO_SETUP;
    const { data: tpls, error: tplErr } = await caller.admin
      .from("document_template")
      .select("id, organisation_id, name, subtype_id, archived_at, created_at")
      .eq("organisation_id", caller.organisationId)
      .order("name");
    if (tplErr) {
      const missing = tplErr.code === "42P01" || tplErr.code === "PGRST205";
      return {
        success: false,
        error: missing ? "Templates aren't available yet — the database update for templates hasn't been applied." : tplErr.message,
      };
    }
    const templates = (tpls ?? []) as TemplateDb[];
    const ids = templates.map((t) => t.id);
    const subtypeIds = Array.from(new Set(templates.map((t) => t.subtype_id)));
    const [{ data: vers }, { data: subs }] = await Promise.all([
      ids.length
        ? caller.admin.from("document_template_version").select(VERSION_COLS).in("template_id", ids).order("version_number", { ascending: false })
        : Promise.resolve({ data: [] as VersionDb[] }),
      subtypeIds.length
        ? caller.admin.from("document_subtype").select("id, name, type, sign_off").in("id", subtypeIds)
        : Promise.resolve({ data: [] as { id: string; name: string; type: string; sign_off: string }[] }),
    ]);
    const versions = (vers ?? []) as VersionDb[];
    const uploaderIds = Array.from(new Set(versions.map((v) => v.uploaded_by).filter(Boolean))) as string[];
    const names = new Map<string, string>();
    if (uploaderIds.length) {
      const { data: ms } = await caller.admin.from("members").select("id, first_name, last_name").in("id", uploaderIds);
      for (const m of (ms ?? []) as { id: string; first_name: string | null; last_name: string | null }[]) {
        names.set(m.id, `${m.first_name ?? ""} ${m.last_name ?? ""}`.trim());
      }
    }
    const subMap = new Map(((subs ?? []) as { id: string; name: string; type: string; sign_off: string }[]).map((s) => [s.id, s]));
    const rows: DocumentTemplateRow[] = templates.map((t) => {
      const vs = versions.filter((v) => v.template_id === t.id).map((v) => toVersionRow(v, names));
      const s = subMap.get(t.subtype_id);
      return {
        id: t.id,
        name: t.name,
        subtypeId: t.subtype_id,
        subtypeName: s?.name ?? "Unknown",
        subtypeType: s?.type ?? "contract",
        signOff: signOffOf(s?.sign_off),
        archivedAt: t.archived_at,
        createdAt: t.created_at,
        current: vs[0] ?? null,
        versions: vs,
      };
    });
    const defs = await loadCustomDefs(caller);
    const catalogue = [
      ...BUILT_IN_FIELDS,
      ...defs.map((d) => ({ tag: `custom.${d.field_key}`, label: d.label })),
    ];
    return { success: true, templates: rows, rendererReady: rendererConfigured(), catalogue };
  } catch (e) {
    return fail(e);
  }
}

export async function listTemplateSubtypes(): Promise<{ success: true; subtypes: TemplateSubtypeOption[] } | Fail> {
  try {
    const caller = await buildDocumentsCallerFromCookies();
    if (!caller) return NOT_AUTH;
    if (!caller.rights.canEditOrgSettings) return NO_SETUP;
    const { data } = await caller.admin
      .from("document_subtype")
      .select("id, name, type, sign_off, sort_order")
      .eq("organisation_id", caller.organisationId)
      .in("type", [...TEMPLATE_SUBTYPE_TYPES])
      .order("type")
      .order("sort_order")
      .order("name");
    const subtypes = ((data ?? []) as { id: string; name: string; type: string; sign_off: string }[]).map((s) => ({
      id: s.id,
      name: s.name,
      type: s.type as TemplateSubtypeOption["type"],
      signOff: signOffOf(s.sign_off),
    }));
    return { success: true, subtypes };
  } catch (e) {
    return fail(e);
  }
}

/** Reads a .docx and lists its merge fields — nothing is saved. */
export async function inspectTemplateFile(formData: FormData): Promise<{ success: true; fields: TemplateField[] } | Fail> {
  try {
    const caller = await buildDocumentsCallerFromCookies();
    if (!caller) return NOT_AUTH;
    if (!caller.rights.canEditOrgSettings) return NO_SETUP;
    const read = await readTemplateFile(formData.get("file"), await loadCustomDefs(caller));
    if (!read.ok) return { success: false, error: read.error };
    return { success: true, fields: read.fields };
  } catch (e) {
    return fail(e);
  }
}

/** formData: name, subtypeId, file (.docx). */
export async function createDocumentTemplate(formData: FormData): Promise<{ success: true; templateId: string } | Fail> {
  try {
    const caller = await buildDocumentsCallerFromCookies();
    if (!caller) return NOT_AUTH;
    if (!caller.rights.canEditOrgSettings) return NO_SETUP;
    const name = String(formData.get("name") ?? "").trim().slice(0, 120);
    if (!name) return { success: false, error: "Give the template a name." };
    const subtype = await loadSubtype(caller, String(formData.get("subtypeId") ?? ""));
    if (!subtype) return { success: false, error: "Choose the kind of document this template produces." };
    const read = await readTemplateFile(formData.get("file"), await loadCustomDefs(caller));
    if (!read.ok) return { success: false, error: read.error };
    const unknown = unknownFieldsError(read.fields);
    if (unknown) return { success: false, error: unknown };

    const { data: tpl, error } = await caller.admin
      .from("document_template")
      .insert({ organisation_id: caller.organisationId, name, subtype_id: subtype.id, created_by: caller.memberId })
      .select("id")
      .single();
    if (error || !tpl) {
      if (error?.code === "23505") return { success: false, error: "A template with that name already exists." };
      return { success: false, error: error?.message ?? "Failed to create the template" };
    }
    const stored = await storeVersion(caller, tpl.id as string, 1, read);
    if (!stored.ok) {
      await caller.admin.from("document_template").delete().eq("id", tpl.id);
      return { success: false, error: stored.error };
    }
    await logAudit({
      organisationId: caller.organisationId,
      actorId: caller.memberId,
      actorName: await callerName(caller),
      action: "document_template.created",
      targetType: "document_template",
      targetId: tpl.id as string,
      targetLabel: name,
      metadata: { subtype_name: subtype.name, file_name: read.name, template_version: 1, merge_fields: read.fields.length },
    });
    revalidatePath("/settings/documents");
    return { success: true, templateId: tpl.id as string };
  } catch (e) {
    return fail(e);
  }
}

export async function updateDocumentTemplate(
  templateId: string,
  input: { name: string; subtypeId: string },
): Promise<{ success: true } | Fail> {
  try {
    const caller = await buildDocumentsCallerFromCookies();
    if (!caller) return NOT_AUTH;
    if (!caller.rights.canEditOrgSettings) return NO_SETUP;
    const tpl = await loadTemplate(caller, templateId);
    if (!tpl) return { success: false, error: "Template not found" };
    const name = input.name.trim().slice(0, 120);
    if (!name) return { success: false, error: "Give the template a name." };
    const subtype = await loadSubtype(caller, input.subtypeId);
    if (!subtype) return { success: false, error: "Choose the kind of document this template produces." };
    const changes: Record<string, { old: unknown; new: unknown }> = {};
    if (name !== tpl.name) changes.name = { old: tpl.name, new: name };
    if (subtype.id !== tpl.subtype_id) {
      const { data: oldSub } = await caller.admin.from("document_subtype").select("name").eq("id", tpl.subtype_id).maybeSingle();
      changes.subtype = { old: (oldSub?.name as string) ?? null, new: subtype.name };
    }
    if (Object.keys(changes).length === 0) return { success: true };
    const { error } = await caller.admin
      .from("document_template")
      .update({ name, subtype_id: subtype.id, updated_at: new Date().toISOString() })
      .eq("id", templateId);
    if (error) {
      if (error.code === "23505") return { success: false, error: "A template with that name already exists." };
      return { success: false, error: error.message };
    }
    await logAudit({
      organisationId: caller.organisationId,
      actorId: caller.memberId,
      actorName: await callerName(caller),
      action: "document_template.updated",
      targetType: "document_template",
      targetId: templateId,
      targetLabel: name,
      changes,
    });
    revalidatePath("/settings/documents");
    return { success: true };
  } catch (e) {
    return fail(e);
  }
}

/** Replace the template's .docx — kept as a new template version. */
export async function uploadTemplateVersion(templateId: string, formData: FormData): Promise<{ success: true } | Fail> {
  try {
    const caller = await buildDocumentsCallerFromCookies();
    if (!caller) return NOT_AUTH;
    if (!caller.rights.canEditOrgSettings) return NO_SETUP;
    const tpl = await loadTemplate(caller, templateId);
    if (!tpl) return { success: false, error: "Template not found" };
    if (tpl.archived_at) return { success: false, error: "Restore this template before replacing its file." };
    const read = await readTemplateFile(formData.get("file"), await loadCustomDefs(caller));
    if (!read.ok) return { success: false, error: read.error };
    const unknown = unknownFieldsError(read.fields);
    if (unknown) return { success: false, error: unknown };
    const prev = await latestVersion(caller, templateId);
    const next = (prev?.version_number ?? 0) + 1;
    const stored = await storeVersion(caller, templateId, next, read);
    if (!stored.ok) return { success: false, error: stored.error };
    await caller.admin.from("document_template").update({ updated_at: new Date().toISOString() }).eq("id", templateId);
    await logAudit({
      organisationId: caller.organisationId,
      actorId: caller.memberId,
      actorName: await callerName(caller),
      action: "document_template.updated",
      targetType: "document_template",
      targetId: templateId,
      targetLabel: tpl.name,
      changes: { template_version: { old: prev?.version_number ?? null, new: next } },
      metadata: { file_name: read.name, merge_fields: read.fields.length },
    });
    revalidatePath("/settings/documents");
    return { success: true };
  } catch (e) {
    return fail(e);
  }
}

export async function setDocumentTemplateArchived(templateId: string, archived: boolean): Promise<{ success: true } | Fail> {
  try {
    const caller = await buildDocumentsCallerFromCookies();
    if (!caller) return NOT_AUTH;
    if (!caller.rights.canEditOrgSettings) return NO_SETUP;
    const tpl = await loadTemplate(caller, templateId);
    if (!tpl) return { success: false, error: "Template not found" };
    if (Boolean(tpl.archived_at) === archived) return { success: true };
    const { error } = await caller.admin
      .from("document_template")
      .update({ archived_at: archived ? new Date().toISOString() : null, updated_at: new Date().toISOString() })
      .eq("id", templateId);
    if (error) {
      if (error.code === "23505") return { success: false, error: "A live template already has this name. Rename one first." };
      return { success: false, error: error.message };
    }
    await logAudit({
      organisationId: caller.organisationId,
      actorId: caller.memberId,
      actorName: await callerName(caller),
      action: archived ? "document_template.archived" : "document_template.restored",
      targetType: "document_template",
      targetId: templateId,
      targetLabel: tpl.name,
    });
    revalidatePath("/settings/documents");
    return { success: true };
  } catch (e) {
    return fail(e);
  }
}

/** Short-lived download link for a template version's .docx. */
export async function getTemplateVersionDownloadUrl(versionId: string): Promise<{ success: true; url: string } | Fail> {
  try {
    const caller = await buildDocumentsCallerFromCookies();
    if (!caller) return NOT_AUTH;
    if (!caller.rights.canEditOrgSettings) return NO_SETUP;
    const { data: v } = await caller.admin.from("document_template_version").select(VERSION_COLS).eq("id", versionId).single();
    const version = v as VersionDb | null;
    if (!version || !(await loadTemplate(caller, version.template_id))) return { success: false, error: "Template not found" };
    const { data, error } = await caller.admin.storage
      .from(TEMPLATE_BUCKET)
      .createSignedUrl(version.storage_path, 120, { download: version.file_name });
    if (error || !data) return { success: false, error: error?.message ?? "Couldn't create a download link" };
    return { success: true, url: data.signedUrl };
  } catch (e) {
    return fail(e);
  }
}

/** Members the setup screen can preview with (whole org, name order). */
export async function listTemplatePreviewMembers(): Promise<{ success: true; members: { id: string; name: string }[] } | Fail> {
  try {
    const caller = await buildDocumentsCallerFromCookies();
    if (!caller) return NOT_AUTH;
    if (!caller.rights.canEditOrgSettings) return NO_SETUP;
    const { data } = await caller.admin
      .from("members")
      .select("id, first_name, last_name")
      .eq("organisation_id", caller.organisationId)
      .order("first_name")
      .order("last_name");
    const members = ((data ?? []) as { id: string; first_name: string | null; last_name: string | null }[]).map((m) => ({
      id: m.id,
      name: `${m.first_name ?? ""} ${m.last_name ?? ""}`.trim() || "Unknown",
    }));
    return { success: true, members };
  } catch (e) {
    return fail(e);
  }
}

/** Sample PDF with a chosen member's details — nothing is filed.
 *  `ask.*` fields without an answer show as "[Label]". */
export async function previewDocumentTemplate(
  templateId: string,
  memberId: string,
): Promise<{ success: true; pdfBase64: string; fileName: string } | Fail> {
  try {
    const caller = await buildDocumentsCallerFromCookies();
    if (!caller) return NOT_AUTH;
    if (!caller.rights.canEditOrgSettings) return NO_SETUP;
    if (!rendererConfigured()) return { success: false, error: RENDERER_NOT_CONFIGURED_ERROR };
    const tpl = await loadTemplate(caller, templateId);
    if (!tpl) return { success: false, error: "Template not found" };
    const version = await latestVersion(caller, templateId);
    if (!version) return { success: false, error: "This template has no file." };
    const member = await loadMember(caller, memberId);
    if (!member) return { success: false, error: "Member not found" };
    const placeholders: Record<string, string> = {};
    for (const f of version.fields ?? []) if (f.kind === "ask") placeholders[f.tag] = `[${f.label}]`;
    const built = await buildPdf(caller, version, member, placeholders);
    if (!built.ok) return { success: false, error: built.error };
    return {
      success: true,
      pdfBase64: Buffer.from(built.pdf).toString("base64"),
      fileName: `${safeFilePart(tpl.name)} - preview.pdf`,
    };
  } catch (e) {
    return fail(e);
  }
}

// ---------------------------------------------------------------------------
// Generation — member Docs page → Create from template
// ---------------------------------------------------------------------------

async function generationGuard(caller: DocumentsCaller, memberId: string) {
  const member = await loadMember(caller, memberId);
  if (!member) return { ok: false as const, error: "Member not found" };
  if (!canUpdateMember(caller, member)) {
    return { ok: false as const, error: "You don't have permission to add documents for this member." };
  }
  return { ok: true as const, member };
}

/** Live templates producing documents for one of the member Docs tabs. */
export async function listTemplatesForMember(
  memberId: string,
  bucket: "employment" | "other",
): Promise<{ success: true; templates: TemplateForMember[] } | Fail> {
  try {
    const caller = await buildDocumentsCallerFromCookies();
    if (!caller) return NOT_AUTH;
    const g = await generationGuard(caller, memberId);
    if (!g.ok) return { success: true, templates: [] };
    const type = bucket === "employment" ? "contract" : "attachment";
    const self = memberId === caller.memberId;
    const { data } = await caller.admin
      .from("document_template")
      .select("id, name, document_subtype!subtype_id(name, type, sign_off, visible_to_member)")
      .eq("organisation_id", caller.organisationId)
      .is("archived_at", null)
      .order("name");
    const rows = (data ?? []) as unknown as {
      id: string;
      name: string;
      document_subtype: { name: string; type: string; sign_off: string; visible_to_member: boolean | null } | null;
    }[];
    const templates = rows
      .filter((r) => r.document_subtype?.type === type)
      .filter((r) => !(self && r.document_subtype?.visible_to_member === false))
      .map((r) => ({
        id: r.id,
        name: r.name,
        subtypeName: r.document_subtype?.name ?? "",
        signOff: signOffOf(r.document_subtype?.sign_off),
      }));
    return { success: true, templates };
  } catch (e) {
    return fail(e);
  }
}

/** The check screen: every field with the value that will be used. */
export async function getTemplateGenerationData(
  templateId: string,
  memberId: string,
): Promise<{ success: true; data: GenerationData } | Fail> {
  try {
    const caller = await buildDocumentsCallerFromCookies();
    if (!caller) return NOT_AUTH;
    const g = await generationGuard(caller, memberId);
    if (!g.ok) return { success: false, error: g.error };
    const tpl = await loadTemplate(caller, templateId);
    if (!tpl || tpl.archived_at) return { success: false, error: "Template not found" };
    const version = await latestVersion(caller, templateId);
    if (!version) return { success: false, error: "This template has no file." };
    const { data: sub } = await caller.admin.from("document_subtype").select("name, sign_off").eq("id", tpl.subtype_id).single();
    const { fields, values, blockedSensitive } = await resolveForMember(caller, version, g.member);
    const out: GenerationField[] = fields.map((f) => ({
      tag: f.tag,
      kind: f.kind,
      label: f.label,
      sensitive: f.sensitive,
      value: f.kind === "ask" ? "" : f.sensitive && !caller.rights.canViewSensitiveFields ? SENSITIVE_REDACTION : (values[f.tag] ?? ""),
    }));
    return {
      success: true,
      data: {
        templateId,
        templateName: tpl.name,
        versionNumber: version.version_number,
        subtypeName: (sub?.name as string) ?? "",
        signOff: signOffOf(sub?.sign_off),
        fields: out,
        blockedSensitive,
        rendererReady: rendererConfigured(),
      },
    };
  } catch (e) {
    return fail(e);
  }
}

/** Fill → PDF → file as a new member document. `values` carries the
 *  ask.* answers and any one-off overrides keyed by tag. */
export async function generateDocumentFromTemplate(
  templateId: string,
  memberId: string,
  values: Record<string, string>,
): Promise<{ success: true; documentId: string } | Fail> {
  try {
    const caller = await buildDocumentsCallerFromCookies();
    if (!caller) return NOT_AUTH;
    const g = await generationGuard(caller, memberId);
    if (!g.ok) return { success: false, error: g.error };
    const member = g.member;
    const tpl = await loadTemplate(caller, templateId);
    if (!tpl || tpl.archived_at) return { success: false, error: "Template not found" };
    const subtype = await loadSubtype(caller, tpl.subtype_id);
    if (!subtype) return { success: false, error: "This template's document kind is no longer available." };
    const self = memberId === caller.memberId;
    if (self && (subtype.visible_to_member === false || caller.rights.crossUserAccess === "self")) {
      return { success: false, error: "You can't create this document against your own record. Ask HR." };
    }
    const version = await latestVersion(caller, templateId);
    if (!version) return { success: false, error: "This template has no file." };
    if (!rendererConfigured()) return { success: false, error: RENDERER_NOT_CONFIGURED_ERROR };

    const built = await buildPdf(caller, version, member, values ?? {});
    if (!built.ok) return { success: false, error: built.error };

    const memberName = `${member.first_name ?? ""} ${member.last_name ?? ""}`.trim() || "Member";
    const fileName = `${safeFilePart(tpl.name)} - ${safeFilePart(memberName)}.pdf`.substring(0, 255);
    const storagePath = `${caller.organisationId}/${crypto.randomUUID()}.pdf`;
    const { error: upErr } = await caller.admin.storage
      .from(MEMBER_DOCUMENTS_BUCKET)
      .upload(storagePath, built.pdf, { contentType: "application/pdf", upsert: false });
    if (upErr) return { success: false, error: upErr.message };

    const { data: inserted, error: insErr } = await caller.admin
      .from("document")
      .insert({
        organisation_id: caller.organisationId,
        owner_scope: "member",
        owner_id: memberId,
        storage_path: storagePath,
        file_name: fileName,
        file_size: built.pdf.byteLength,
        content_type: "application/pdf",
        type: subtype.type,
        subtype_id: subtype.id,
        expires_on: null,
        retention_class: subtype.retention_class,
        next_review_on: seedNextReviewOnUpload(subtype),
        uploaded_by: caller.memberId,
        generated_from_template_version_id: version.id,
        generation_values: built.generationValues,
      })
      .select("id")
      .single();
    if (insErr || !inserted) {
      await caller.admin.storage.from(MEMBER_DOCUMENTS_BUCKET).remove([storagePath]);
      return { success: false, error: insErr?.message ?? "Failed to file the document" };
    }

    await logAudit({
      organisationId: caller.organisationId,
      actorId: caller.memberId,
      actorName: await callerName(caller),
      action: "document.generated_from_template",
      targetType: "member_document",
      targetId: inserted.id as string,
      targetLabel: fileName,
      metadata: {
        member: memberName,
        template_name: tpl.name,
        template_version: version.version_number,
        subtype_name: subtype.name,
        file_name: fileName,
        file_size: built.pdf.byteLength,
        // ask.* answers + one-off overrides, readable on the audit page.
        values_entered: Object.keys(built.generationValues).length
          ? Object.entries(built.generationValues)
              .map(([tag, v]) => `${built.fields.find((f) => f.tag === tag)?.label ?? tag}: ${v}`)
              .join("; ")
          : undefined,
      },
    });
    revalidatePath(`/members/${memberId}/docs`);
    return { success: true, documentId: inserted.id as string };
  } catch (e) {
    return fail(e);
  }
}
