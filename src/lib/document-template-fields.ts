// CLE-237 — Document templates: merge-field catalogue, tag extraction,
// value formatting and .docx filling.
//
// Spec: Spec Vault → specs/Documents/09 Document Templates.md
//
// Templates are Word .docx files with `{{...}}` merge fields. ClearHR
// fills them itself (docxtemplater); the renderer
// (`document-renderer.ts`) only converts the filled .docx to PDF, so a
// renderer swap never changes templates or behaviour.
//
// Plain module (not "use server") — imported by the template actions.

import Docxtemplater from "docxtemplater";
import PizZip from "pizzip";
import { SENSITIVE_MEMBER_FIELDS } from "@/lib/sensitive-fields";
import { formatNotice, probationNotice, type EmploymentNoticeProfile } from "@/lib/employment-notice";

export const TEMPLATE_DELIMITERS = { start: "{{", end: "}}" } as const;

export const DOCX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** Built-in fields. `custom.<key>`, `ask.<name>` are open-ended. */
export const BUILT_IN_FIELDS: { tag: string; label: string }[] = [
  { tag: "member.first_name", label: "First name" },
  { tag: "member.last_name", label: "Last name" },
  { tag: "member.full_name", label: "Full name" },
  { tag: "member.known_as", label: "Known as" },
  { tag: "member.email", label: "Email" },
  { tag: "member.team", label: "Team" },
  { tag: "member.start_date", label: "Start date" },
  { tag: "organisation.name", label: "Organisation name" },
  // CLE-239 — from the member's Employment Notice profile.
  { tag: "notice.profile", label: "Employment notice profile" },
  { tag: "notice.member", label: "Notice they must give" },
  { tag: "notice.employer", label: "Notice the organisation must give" },
  { tag: "notice.member_probation", label: "Notice they must give (probation)" },
  { tag: "notice.employer_probation", label: "Notice the organisation must give (probation)" },
  { tag: "notice.employer_statutory", label: "Legal minimum notice from the organisation" },
  { tag: "today", label: "Today's date" },
];
const BUILT_IN_LABEL = new Map(BUILT_IN_FIELDS.map((f) => [f.tag, f.label]));

export type TemplateFieldKind = "member" | "organisation" | "notice" | "today" | "custom" | "ask" | "unknown";

/** One merge field found in a template (stored on the template version). */
export interface TemplateField {
  tag: string;
  kind: TemplateFieldKind;
  label: string;
  /** True when merging it needs `can_view_sensitive_fields`. */
  sensitive: boolean;
}

/** Minimal custom-field definition shape the catalogue needs. */
export interface TemplateCustomFieldDef {
  field_key: string;
  label: string;
  field_type: string;
  input_mode: string;
  is_sensitive: boolean;
}

const ASK_RE = /^ask\.[A-Za-z][A-Za-z0-9_]*$/;

/** "probation_months" → "Probation months". */
export function humaniseKey(key: string): string {
  const s = key.replace(/[_-]+/g, " ").trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : key;
}

export function classifyTag(tag: string, defs: TemplateCustomFieldDef[]): TemplateField {
  const builtIn = BUILT_IN_LABEL.get(tag);
  if (builtIn) {
    const kind: TemplateFieldKind =
      tag === "today" ? "today" : tag.startsWith("member.") ? "member" : tag.startsWith("notice.") ? "notice" : "organisation";
    const col = tag.startsWith("member.") ? tag.slice(7) : "";
    return { tag, kind, label: builtIn, sensitive: SENSITIVE_MEMBER_FIELDS.has(col) };
  }
  if (tag.startsWith("custom.")) {
    const key = tag.slice(7);
    const def = defs.find((d) => d.field_key === key);
    if (def) return { tag, kind: "custom", label: def.label, sensitive: def.is_sensitive === true };
  }
  if (ASK_RE.test(tag)) return { tag, kind: "ask", label: humaniseKey(tag.slice(4)), sensitive: false };
  return { tag, kind: "unknown", label: tag, sensitive: false };
}

function newDoc(bytes: Uint8Array, parser: (tag: string) => { get: () => unknown }): Docxtemplater {
  const zip = new PizZip(bytes);
  return new Docxtemplater(zip, {
    delimiters: TEMPLATE_DELIMITERS,
    paragraphLoop: true,
    linebreaks: true,
    parser,
    nullGetter: () => "",
    errorLogging: false,
  });
}

/** Turns docxtemplater's (Multi)Error into one readable sentence. */
function templateErrorMessage(e: unknown): string {
  const err = e as { properties?: { errors?: { properties?: { explanation?: string } }[]; explanation?: string }; message?: string };
  const list = err?.properties?.errors;
  if (Array.isArray(list) && list.length > 0) {
    const first = list[0]?.properties?.explanation ?? "The template has a formatting problem.";
    return list.length > 1 ? `${first} (and ${list.length - 1} more)` : first;
  }
  if (err?.properties?.explanation) return err.properties.explanation;
  return err?.message ? `This file can't be read as a template: ${err.message}` : "This file can't be read as a template.";
}

/** Every distinct `{{tag}}` in the template, in first-seen order. */
export function extractTemplateTags(bytes: Uint8Array): { ok: true; tags: string[] } | { ok: false; error: string } {
  try {
    const seen: string[] = [];
    const doc = newDoc(bytes, (raw) => {
      const tag = raw.trim();
      return {
        get: () => {
          if (tag && !seen.includes(tag)) seen.push(tag);
          return "";
        },
      };
    });
    doc.render({});
    return { ok: true, tags: seen };
  } catch (e) {
    return { ok: false, error: templateErrorMessage(e) };
  }
}

/** Fills the template. `values` is keyed by tag; missing tags render empty. */
export function fillTemplate(bytes: Uint8Array, values: Record<string, string>): Uint8Array {
  let doc: Docxtemplater;
  try {
    doc = newDoc(bytes, (raw) => {
      const tag = raw.trim();
      return { get: () => values[tag] ?? "" };
    });
    doc.render({});
  } catch (e) {
    throw new Error(templateErrorMessage(e));
  }
  return doc.getZip().generate({ type: "uint8array", compression: "DEFLATE" }) as Uint8Array;
}

// ---------------------------------------------------------------------------
// Value formatting (UK)
// ---------------------------------------------------------------------------

/** "2026-11-05" → "05 November 2026". */
export function formatTemplateDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric", timeZone: "UTC" });
}

function formatScalar(raw: unknown, fieldType: string, currencySymbol: string): string {
  if (raw === null || raw === undefined || raw === "") return "";
  switch (fieldType) {
    case "date":
      return formatTemplateDate(String(raw));
    case "currency": {
      const n = Number(raw);
      return Number.isFinite(n)
        ? `${currencySymbol}${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        : String(raw);
    }
    case "number": {
      const n = Number(raw);
      return Number.isFinite(n) ? n.toLocaleString("en-GB", { maximumFractionDigits: 10 }) : String(raw);
    }
    case "checkbox":
      return raw === true || raw === "true" ? "Yes" : "No";
    default:
      return String(raw);
  }
}

/** Formats a stored custom-field value for a document. */
export function formatCustomFieldForTemplate(raw: unknown, def: TemplateCustomFieldDef, currencySymbol: string): string {
  if (Array.isArray(raw)) {
    return raw.map((v) => formatScalar(v, def.field_type, currencySymbol)).filter(Boolean).join(", ");
  }
  return formatScalar(raw, def.field_type, currencySymbol);
}

/** Today's date in UK time as ISO (yyyy-mm-dd). */
export function todayIsoUk(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });
}

/** Everything needed to resolve a template's fields for one member. */
export interface TemplateMergeSource {
  member: {
    first_name: string | null;
    last_name: string | null;
    known_as: string | null;
    email: string | null;
    start_date: string | null;
    custom_fields: Record<string, unknown> | null;
  };
  teamName: string | null;
  organisationName: string;
  currencySymbol: string;
  customDefs: TemplateCustomFieldDef[];
  /** CLE-239 — the member's Employment Notice profile + statutory
   *  minimum (weeks) at generation time. Omitted/null → empty values. */
  notice?: { profile: EmploymentNoticeProfile | null; statutoryWeeks: number | null } | null;
}

/** Value each non-`ask` field resolves to (empty string = no value). */
export function resolveTemplateValues(fields: TemplateField[], src: TemplateMergeSource): Record<string, string> {
  const m = src.member;
  const out: Record<string, string> = {};
  for (const f of fields) {
    let v = "";
    switch (f.tag) {
      case "member.first_name": v = m.first_name ?? ""; break;
      case "member.last_name": v = m.last_name ?? ""; break;
      case "member.full_name": v = `${m.first_name ?? ""} ${m.last_name ?? ""}`.trim(); break;
      case "member.known_as": v = m.known_as || m.first_name || ""; break;
      case "member.email": v = m.email ?? ""; break;
      case "member.team": v = src.teamName ?? ""; break;
      case "member.start_date": v = formatTemplateDate(m.start_date); break;
      case "organisation.name": v = src.organisationName; break;
      case "today": v = formatTemplateDate(todayIsoUk()); break;
      case "notice.profile": v = src.notice?.profile?.name ?? ""; break;
      case "notice.member": v = src.notice?.profile ? formatNotice(src.notice.profile.memberAmount, src.notice.profile.memberUnit) : ""; break;
      case "notice.employer": v = src.notice?.profile ? formatNotice(src.notice.profile.employerAmount, src.notice.profile.employerUnit) : ""; break;
      case "notice.member_probation": {
        const p = src.notice?.profile;
        v = p ? probationNotice(p.probationMemberAmount, p.probationMemberUnit, p.memberAmount, p.memberUnit) : "";
        break;
      }
      case "notice.employer_probation": {
        const p = src.notice?.profile;
        v = p ? probationNotice(p.probationEmployerAmount, p.probationEmployerUnit, p.employerAmount, p.employerUnit) : "";
        break;
      }
      case "notice.employer_statutory": {
        const w = src.notice?.statutoryWeeks;
        v = w === null || w === undefined ? "" : formatNotice(w, "week");
        break;
      }
      default:
        if (f.kind === "custom") {
          const key = f.tag.slice(7);
          const def = src.customDefs.find((d) => d.field_key === key);
          if (def) v = formatCustomFieldForTemplate(m.custom_fields?.[key], def, src.currencySymbol);
        }
    }
    if (f.kind !== "ask" && f.kind !== "unknown") out[f.tag] = v;
  }
  return out;
}
