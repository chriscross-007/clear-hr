import { Zap, Snowflake } from "lucide-react";

// CLE-191 — Live / Seed-only explainer banner for each profile type.
//
// * "Live" profiles (Rights, Working Pattern, Notice Period, Approver):
//    the member's behaviour updates as soon as the profile changes.
// * "Seed-only" profiles (Holiday): values are baked into derived
//    records at creation; later profile edits don't retroactively
//    rewrite existing rows.

interface ProfileExplainerProps {
  kind: "live" | "seed";
  note?: string;
}

export function ProfileExplainer({ kind, note }: ProfileExplainerProps) {
  const isLive = kind === "live";
  const Icon = isLive ? Zap : Snowflake;
  return (
    <div className={`flex items-start gap-2 rounded-md border px-3 py-2 text-sm ${
      isLive
        ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200"
        : "border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-200"
    }`}>
      <Icon className="h-4 w-4 shrink-0 mt-0.5" />
      <div>
        <span className="font-semibold">
          {isLive ? "Live profile" : "Seed-only profile"}
        </span>
        <span className="ml-1">
          {isLive
            ? "— changes apply to assigned members immediately."
            : "— values are stamped onto derived records at creation; later changes don't rewrite existing data."}
        </span>
        {note && <p className="mt-1 text-xs opacity-90">{note}</p>}
      </div>
    </div>
  );
}
