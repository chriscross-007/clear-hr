import { capitalize } from "@/lib/label-utils";
import type { Member, Team } from "@/app/(dashboard)/employees/employee-columns";

interface FieldDefLike {
  field_key: string;
  field_type: string;
  max_decimal_places?: number | null;
}

export function formatMemberForPdf(
  m: Member,
  opts: {
    teams: Team[];
    customFieldDefs: FieldDefLike[];
    currencySymbol: string;
    memberLabel: string;
  }
): Record<string, string> {
  const { teams, customFieldDefs, currencySymbol, memberLabel } = opts;
  const teamMap = Object.fromEntries(teams.map((t) => [t.id, t.name]));

  return {
    first_name: m.first_name,
    last_name: m.last_name,
    email: m.email,
    role: m.role === "admin" ? "Admin" : m.role === "owner" ? "Owner" : capitalize(memberLabel),
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
      customFieldDefs.map((def) => {
        const val = (m.custom_fields as Record<string, unknown> | null)?.[def.field_key];
        if (def.field_type === "checkbox")
          return [`cf_${def.field_key}`, val === true ? "Yes" : val === false ? "No" : "—"];
        if (def.field_type === "date" && val) {
          try {
            return [`cf_${def.field_key}`, new Date(String(val)).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })];
          } catch {
            return [`cf_${def.field_key}`, String(val)];
          }
        }
        if (val === undefined || val === null || val === "")
          return [`cf_${def.field_key}`, "—"];
        if (def.field_type === "currency") {
          const num = Number(val);
          return [`cf_${def.field_key}`, isNaN(num) ? String(val) : `${currencySymbol}${num.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`];
        }
        if (def.field_type === "number") {
          const num = Number(val);
          if (isNaN(num)) return [`cf_${def.field_key}`, String(val)];
          if (def.max_decimal_places === 0) return [`cf_${def.field_key}`, String(Math.round(num))];
          if (def.max_decimal_places != null) return [`cf_${def.field_key}`, num.toFixed(def.max_decimal_places)];
          return [`cf_${def.field_key}`, String(val)];
        }
        return [`cf_${def.field_key}`, String(val)];
      })
    ),
  };
}
