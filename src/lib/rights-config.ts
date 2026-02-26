export type RightType = "boolean" | "access";

export interface RightDef {
  key: string;
  label: string;
  type: RightType;
  description?: string;
}

export const ADMIN_RIGHTS: RightDef[] = [
  {
    key: "can_add_members",
    label: "Add Members",
    type: "boolean",
    description: "Add & delete members",
  },
  {
    key: "can_edit_organisation",
    label: "Edit Organisation",
    type: "boolean",
    description: "Change org name, label, MFA settings",
  },
  {
    key: "can_view_all_teams",
    label: "View All Teams",
    type: "boolean",
    description: "See members across all teams",
  },
  {
    key: "can_approve_holidays",
    label: "Approve Holidays",
    type: "boolean",
    description: "Approve/reject holiday requests",
  },
  {
    key: "can_manage_members",
    label: "Manage Members",
    type: "access",
    description: "None, read-only, or full read/write access to member records",
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

/** Build a default rights object with all values set to false / null. */
export function buildDefaultRights(
  defs: RightDef[]
): Record<string, unknown> {
  const rights: Record<string, unknown> = {};
  for (const d of defs) {
    rights[d.key] = d.type === "boolean" ? false : "none";
  }
  return rights;
}
