/**
 * Per-user "recent employees" list, persisted in localStorage so the primary
 * sidebar can quick-link to whoever the admin has been working on. Browser-only;
 * every call is a no-op on the server (and inside try/catch so a disabled
 * localStorage degrades silently).
 */

export type RecentEmployee = {
  memberId: string;
  name: string;
  avatarUrl: string | null;
  /** Date.now() at time of visit — used for ordering. */
  timestamp: number;
};

// Keep one extra so that after the sidebar excludes the currently-viewed
// employee there are still up to 3 prior visits to display.
export const RECENT_EMPLOYEES_LIMIT = 4;
export const RECENT_EMPLOYEES_EVENT = "clearhr-recent-employees";

function storageKey(userId: string): string {
  return `recent-employees-${userId}`;
}

export function loadRecentEmployees(userId: string): RecentEmployee[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is RecentEmployee =>
        typeof e === "object"
        && e !== null
        && typeof (e as RecentEmployee).memberId === "string"
        && typeof (e as RecentEmployee).name === "string"
        && typeof (e as RecentEmployee).timestamp === "number",
    );
  } catch {
    return [];
  }
}

export function recordRecentEmployee(
  userId: string,
  visit: Omit<RecentEmployee, "timestamp">,
): void {
  if (typeof window === "undefined") return;
  try {
    const existing = loadRecentEmployees(userId)
      .filter((e) => e.memberId !== visit.memberId);
    const next: RecentEmployee[] = [
      { ...visit, timestamp: Date.now() },
      ...existing,
    ].slice(0, RECENT_EMPLOYEES_LIMIT);
    window.localStorage.setItem(storageKey(userId), JSON.stringify(next));
    // Notify other components in this tab (the "storage" event only fires
    // in OTHER tabs, so we need our own signal for same-tab updates).
    window.dispatchEvent(new CustomEvent(RECENT_EMPLOYEES_EVENT));
  } catch {
    // localStorage unavailable — skip silently.
  }
}
