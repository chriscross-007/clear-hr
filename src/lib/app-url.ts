// The public address of the ClearHR web app, for links in emails.
//
// Emails must link to the live app even when the action runs somewhere
// else (e.g. a local dev server), so this never uses the request host.
// Order: NEXT_PUBLIC_APP_URL (if set) → Vercel's production domain →
// the known production address.

const PRODUCTION_URL = "https://clear-hr.vercel.app";

export function appBaseUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercel) return `https://${vercel.replace(/\/+$/, "")}`;
  return PRODUCTION_URL;
}
