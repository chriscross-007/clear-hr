export const PLAN_FEATURES = {
  lite:       { reports: true,  custom_reports: false, scheduled_reports: false },
  pro:        { reports: true,  custom_reports: true,  scheduled_reports: false },
  enterprise: { reports: true,  custom_reports: true,  scheduled_reports: true  },
} as const;

export type PlanFeatureKey = keyof typeof PLAN_FEATURES["lite"];

export function hasPlanFeature(plan: string, feature: PlanFeatureKey): boolean {
  return PLAN_FEATURES[plan.toLowerCase() as keyof typeof PLAN_FEATURES]?.[feature] ?? false;
}
