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
      customFieldDefs.flatMap((def) => {
        const val = (m.custom_fields as Record<string, unknown> | null)?.[def.field_key];
        let display: string;
        if (def.field_type === "checkbox")
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
