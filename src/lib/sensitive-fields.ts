// CLE-198 — Sensitive-field enumeration + display helpers.
//
// Two sources feed "is this field sensitive?":
//   1. `SENSITIVE_MEMBER_FIELDS` — a hardcoded set of built-in
//      `members` column names that are always sensitive by GDPR
//      convention (NI numbers, bank details, DOB, home address, etc.).
//      These are enumerated forward — when Chris adds any of these
//      columns to the members table, redaction kicks in automatically.
//   2. `custom_field_definitions.is_sensitive` — a per-field opt-in
//      admins can toggle in the Custom Fields manager.
//
// `isFieldSensitive` unions both. `redactValueForDisplay` produces the
// `•••` placeholder every read site should render when the viewer
// lacks `can_view_sensitive_fields`.

/**
 * Built-in `members` column names classed as sensitive. Comparison is
 * exact-match on column name — no fuzzy matching. Add fields to this
 * list as they land in the schema.
 */
export const SENSITIVE_MEMBER_FIELDS = new Set<string>([
  "date_of_birth",
  "ni_number",
  "bank_account_number",
  "bank_sort_code",
  "home_address_line1",
  "home_address_line2",
  "home_address_city",
  "home_address_postcode",
  "home_address_country",
  "home_phone",
  "mobile_phone",
  "next_of_kin",
  "next_of_kin_phone",
  "pay_rate",
  "salary",
  "passport_number",
  "driving_licence_number",
]);

interface CustomFieldDefLike {
  field_key: string;
  is_sensitive?: boolean;
}

/**
 * Returns true when the given field key belongs to the built-in
 * sensitive set OR is a custom field flagged `is_sensitive`.
 *
 * Custom-field keys can arrive with or without a `cf_` prefix
 * depending on the caller (grid column ids include the prefix; raw
 * `custom_fields` JSONB keys do not). Both shapes match.
 */
export function isFieldSensitive(
  fieldKey: string,
  customFieldDefs: CustomFieldDefLike[] | null | undefined,
): boolean {
  if (SENSITIVE_MEMBER_FIELDS.has(fieldKey)) return true;

  const raw = fieldKey.startsWith("cf_") ? fieldKey.slice(3) : fieldKey;
  const def = customFieldDefs?.find((d) => d.field_key === raw);
  return def?.is_sensitive === true;
}

/** The dot-placeholder shown wherever a viewer lacks view rights. */
export const SENSITIVE_REDACTION = "•••";

/**
 * Redact a value for display. Returns `•••` regardless of the input.
 * Callers should branch on `viewerCanSee` themselves — this helper
 * exists so every render site uses the same placeholder string.
 */
export function redactValueForDisplay(): string {
  return SENSITIVE_REDACTION;
}
