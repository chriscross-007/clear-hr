import type { Member, Team } from "@/app/(dashboard)/employees/employee-columns";
import { formatOptionForDisplay } from "@/components/custom-field-multiselect";
import type { InputMode } from "@/app/(dashboard)/employees/custom-field-actions";
import { SENSITIVE_MEMBER_FIELDS, SENSITIVE_REDACTION } from "@/lib/sensitive-fields";

interface FieldDefLike {
  field_key: string;
  field_type: string;
  input_mode?: InputMode;
  max_decimal_places?: number | null;
  // CLE-198 — Custom-field-level sensitivity flag. Union with the
  // hardcoded SENSITIVE_MEMBER_FIELDS set decides whether values
  // should be redacted to `•••` for viewers without `can_view_sensitive_fields`.
  is_sensitive?: boolean;
}

export function formatMemberForPdf(
  m: Member,
  opts: {
    teams: Team[];
    customFieldDefs: FieldDefLike[];
    currencySymbol: string;
    memberLabel: string;
    /** CLE-198 — When false, sensitive-field values render as `•••`.
     *  Defaults to true (i.e. no redaction) so callers who haven't yet
     *  wired the resolver don't accidentally under-redact. */
    canViewSensitiveFields?: boolean;
  }
): Record<string, string> {
  const { teams, customFieldDefs, currencySymbol } = opts;
  const canViewSensitiveFields = opts.canViewSensitiveFields ?? true;
  const teamMap = Object.fromEntries(teams.map((t) => [t.id, t.name]));

  return {
    first_name: m.first_name,
    last_name: m.last_name,
    email: m.email,
    // CLE-201c-10 — legacy `role` field removed from the export;
    // `profile` (User Rights profile name) is the canonical field.
    profile: m.profile_name ?? "—",
    team: m.team_id ? (teamMap[m.team_id] ?? "—") : "—",
    payroll_number: m.payroll_number ?? "—",
    status: m.accepted_at ? "Active" : m.invited_at ? "Invited" : "Not invited",
    last_log_in: m.last_log_in
      ? new Date(m.last_log_in).toLocaleString("en-GB", {
          day: "numeric",
          month: "short",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        })
      : "—",
    ...Object.fromEntries(
      customFieldDefs.flatMap((def) => {
        const val = (m.custom_fields as Record<string, unknown> | null)?.[def.field_key];

        // CLE-198 — Sensitive-field short-circuit. When the caller
        // lacks `can_view_sensitive_fields`, emit `•••` for the
        // display cell and blank the raw pair (so aggregates don't
        // leak the underlying number).
        const isSensitive =
          def.is_sensitive === true ||
          SENSITIVE_MEMBER_FIELDS.has(def.field_key);
        if (isSensitive && !canViewSensitiveFields) {
          const pairs: [string, string][] = [
            [`cf_${def.field_key}`, SENSITIVE_REDACTION],
          ];
          if (def.field_type === "currency" || def.field_type === "number") {
            pairs.push([`_raw_cf_${def.field_key}`, ""]);
          }
          return pairs;
        }

        let display: string;
        if (def.input_mode === "multi_choice") {
          const arr = Array.isArray(val) ? val.filter((v): v is string => typeof v === "string") : [];
          display = arr.length === 0
            ? "—"
            : arr
                .map((v) => formatOptionForDisplay(v, def.field_type, { currencySymbol, maxDecimalPlaces: def.max_decimal_places }))
                .join(", ");
        }
        else if (def.input_mode === "single_choice") {
          display = val === undefined || val === null || val === ""
            ? "—"
            : formatOptionForDisplay(String(val), def.field_type, { currencySymbol, maxDecimalPlaces: def.max_decimal_places });
        }
        else if (def.field_type === "checkbox")
          display = val === true ? "Yes" : val === false ? "No" : "—";
        else if (def.field_type === "date" && val) {
          try {
            display = new Date(String(val)).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
          } catch {
            display = String(val);
          }
        } else if (val === undefined || val === null || val === "") {
          display = "—";
        } else if (def.field_type === "currency") {
          const num = Number(val);
          display = isNaN(num) ? String(val) : `${currencySymbol}${num.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        } else if (def.field_type === "number") {
          const num = Number(val);
          if (isNaN(num)) display = String(val);
          else if (def.max_decimal_places === 0) display = String(Math.round(num));
          else if (def.max_decimal_places != null) display = num.toFixed(def.max_decimal_places);
          else display = String(val);
        } else {
          display = String(val);
        }
        const pairs: [string, string][] = [[`cf_${def.field_key}`, display]];
        if (def.field_type === "currency" || def.field_type === "number") {
          const num = Number(val);
          pairs.push([`_raw_cf_${def.field_key}`, val !== null && val !== undefined && val !== "" && !isNaN(num) ? String(num) : ""]);
        }
        return pairs;
      })
    ),
  };
}
