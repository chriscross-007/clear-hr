export type RightType = "boolean" | "access";
export type AccessValue = "none" | "read" | "write";

export interface RightDef {
  key: string;
  label: string;
  type: RightType;
  description?: string;
}

export const ADMIN_RIGHTS: RightDef[] = [
  {
    key: "can_edit_organisation",
    label: "Edit Organisation",
    type: "boolean",
    description: "Change org name, label, MFA settings",
  },
  {
    key: "can_add_members",
    label: "Add Members",
    type: "boolean",
    description: "Add & delete members",
  },
  {
    key: "can_manage_members",
    label: "Manage Members",
    type: "access",
    description: "None, read-only, or full read/write access to member records",
  },
  {
    key: "can_approve_holidays",
    label: "Approve Holidays",
    type: "boolean",
    description: "Approve/reject holiday requests",
  },
  {
    key: "can_define_custom_fields",
    label: "Custom Field Definitions",
    type: "access",
    description: "None, read-only, or full read/write access to custom field definitions",
  },
  {
    key: "can_see_currency",
    label: "See Currency Values",
    type: "boolean",
    description: "View currency-type field values",
  },
];

export const EMPLOYEE_RIGHTS: RightDef[] = [
  {
    key: "can_request_holidays",
    label: "Request Holidays",
    type: "boolean",
    description: "Submit holiday requests",
  },
  {
    key: "can_view_team_members",
    label: "View Team Members",
    type: "boolean",
    description: "See other members in own team",
  },
];

/** Build a default rights object with all values set to false / "none". */
export function buildDefaultRights(
  defs: RightDef[]
): Record<string, unknown> {
  const rights: Record<string, unknown> = {};
  for (const d of defs) {
    rights[d.key] = d.type === "boolean" ? false : "none";
  }
  return rights;
}

/**
 * Coerce a stored rights value into an `AccessValue` for a right that has
 * type === "access". Handles the legacy boolean shape (existed when a right
 * was a boolean and was later promoted to tri-state — e.g.
 * `can_define_custom_fields`). Legacy `true` is treated as `"write"`,
 * legacy `false`/missing/unknown as `"none"`.
 */
export function coerceAccess(value: unknown): AccessValue {
  if (value === "write" || value === "read" || value === "none") return value;
  if (value === true) return "write";
  return "none";
}

/**
 * Convenience: read the access level for `can_define_custom_fields` from a
 * member's permissions blob, handling the legacy boolean shape. Owners are
 * always full-write; pass `role` so the caller doesn't have to special-case.
 */
export function getCustomFieldDefAccess(
  role: string | null | undefined,
  permissions: Record<string, unknown> | null | undefined,
): AccessValue {
  if (role === "owner") return "write";
  return coerceAccess(permissions?.can_define_custom_fields);
}
