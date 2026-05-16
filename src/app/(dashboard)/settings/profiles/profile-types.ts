// Single source of truth for the Profiles section's tab labels + routes.
//
// Both the inner tab nav (`profile-type-nav.tsx`) AND each list's Card
// title pull from here, so renaming a tab automatically renames the
// matching list heading. Add a new profile type by adding an entry here.
//
// Keys are stable internal identifiers — don't rename them. Labels are
// the user-facing strings — edit freely.

export type ProfileTypeKey =
  | "rights"
  | "workingPattern"
  | "noticePeriod"
  | "approver"
  | "holiday";

export interface ProfileTypeMeta {
  /** Stable internal identifier — used as a discriminator. */
  key: ProfileTypeKey;
  /** URL path for the sub-route. */
  href: string;
  /** User-facing label. Appears as both the tab text and the list heading. */
  label: string;
}

export const PROFILE_TYPES: Record<ProfileTypeKey, ProfileTypeMeta> = {
  rights: {
    key: "rights",
    href: "/settings/profiles/rights",
    label: "Rights",
  },
  workingPattern: {
    key: "workingPattern",
    href: "/settings/profiles/working-pattern",
    label: "Working Patterns",
  },
  noticePeriod: {
    key: "noticePeriod",
    href: "/settings/profiles/notice-period",
    label: "Holiday Notice",
  },
  approver: {
    key: "approver",
    href: "/settings/profiles/approver",
    label: "Holiday Approval",
  },
  holiday: {
    key: "holiday",
    href: "/settings/profiles/holiday",
    label: "Holiday Periods",
  },
};

/** Ordered list for the tab nav. Order = display order. */
export const PROFILE_TYPE_ORDER: ProfileTypeKey[] = [
  "rights",
  "workingPattern",
  "noticePeriod",
  "approver",
  "holiday",
];
