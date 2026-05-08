# ClearHR — Copilot Instructions

The canonical project guide is [`../CLAUDE.md`](../CLAUDE.md) at the repo root. Read it before suggesting non-trivial changes. This file surfaces the rules that most affect inline code completion.

## Stack snapshot
- Next.js 16 (App Router, Turbopack), React 19, TypeScript strict
- Supabase (`@supabase/ssr` v0.8, `supabase-js` v2)
- Tailwind v4, shadcn/ui (new-york style), Lucide icons
- Path alias: `@/*` → `./src/*`

## Server actions — completion rules
- Action files start with `"use server";`.
- Page-specific actions: `(dashboard)/<page>/actions.ts`. Cross-cutting actions: `(dashboard)/<domain>-actions.ts` (e.g. `conversation-actions.ts`, `team-actions.ts`, `holiday-booking-actions.ts`). Import via `@/app/(dashboard)/<file>` — never `@/lib/actions/...` (no such directory).
- Always return a `{ success: boolean; error?: string; ...payload }` object. Wrap the body in `try/catch` and convert thrown errors to `{ success: false, error: e instanceof Error ? e.message : "An error occurred" }`. Never let an action throw to the client.
- Use the standard helpers from `conversation-actions.ts`:
  - `await getCallerMember()` → `{ supabase, member }` (caller's session client + their `{ id, organisation_id, role }`)
  - `getAdminClient()` → service-role client; only after a permission check
- DB columns are snake_case; DTOs are camelCase. Standard renames: `mime_type` → `contentType`, `file_name` → `fileName`, `file_size` → `fileSize`, `created_at` → `createdAt`, `document_label` → `documentLabel`. Pre-flatten relations into scalars (uploader name → `uploadedBy: string`, not a nested object).

## Pages
- Every `page.tsx` that reads from Supabase MUST start with `export const dynamic = "force-dynamic";` — security-critical, see `CLAUDE.md`.
- `params` is a `Promise` in Next.js 16 — `await params` before destructuring.
- Per-member pages live at `src/app/(dashboard)/members/[memberId]/...`.

## UI rules
- **Member-label awareness:** never hardcode "employee" / "employees" (or "Employee" / "Employees") in user-facing strings. Use `useMemberLabel()` from `@/contexts/member-label-context` plus `capitalize()` / `pluralize()` from `@/lib/label-utils`. DB columns and TS identifiers are exempt.
- **Booleans in tables:** Lucide `<Check className="h-5 w-5 text-green-500" />` / `<X className="h-5 w-5 text-red-500" />`. Never "Yes" / "No" text.
- **Row click on lists:** opens edit (`cursor-pointer hover:bg-muted/50 onClick={...}`). Destructive icons inside the row need `e.stopPropagation()`.
- **Date/time:** `toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })`. Don't import `date-fns` just for formatting.
- **Signed-URL images:** plain `<img>` with `// eslint-disable-next-line @next/next/no-img-element`. Never `next/image` — it can't proxy signed URLs.
- **`DataGrid` bulk selection:** parent owns `selectedIds: Set<string>` and supplies a leading `select` column (`leadingColumnIds={["select"]}`) plus, when `groupBy` is in use, `renderGroupHeaderPrefix={({ rowsInGroup }) => <Checkbox ... />}` for tri-state group-level select-all. The renderer gets the **full filtered group**, not just the page. Use additive/subtractive selection updates so toggling one group doesn't wipe selections in others.
- **Sticky page header on every list page:** wrap the title AND every persistent control (tabs, filters, action buttons, week-nav, etc.) in `<StickyPageHeader>` from `@/components/ui/sticky-page-header`. The principle: only data rows scroll. For `<Tabs>` pages, wrap `<Tabs>` around both `<StickyPageHeader>` and `<TabsContent>`, with `<TabsList>` inside the sticky band. Don't add to dashboards, forms, or detail pages.
- **`DataGrid stickyHeader` offset:** pair with `<StickyPageHeader>`. Default `stickyHeaderTop={120}` matches a one-line title; pass a bigger number when the sticky band is taller (multi-line title + Row 2 + filters ≈ 240). The toolbar pins at `stickyHeaderTop`, column header at `+56`, filter row at `+96`.
- **Dialogs / Sheets with forms:** `<DialogHeader>` outside scroll area, fields wrapped in `<div className="overflow-y-auto max-h-[60vh] px-1">`, `<DialogFooter>` outside scroll area.
- **Date-range filters:** preset dropdown ordered Last/This/Next per period (Week, Month, Year), then Custom range; not raw date pickers. Filter shape `{ preset?: string; from?: string; to?: string }`.

## Supabase gotchas
- `holiday_bookings` has two FKs to `members` (`member_id` and `approver1_id`). Always disambiguate: `employee:members!holiday_bookings_member_id_fkey(first_name, last_name, ...)`. Never the bare `members(...)` — Supabase silently returns empty.
- Cross-user reads (other members' rows) need `getAdminClient()`. The caller's session client returns 0 rows due to RLS without erroring — bugs ship silently.
- Normalise emails to lowercase (`email.trim().toLowerCase()`) before any insert/lookup. Supabase auth normalises; mismatches break the `link_user_to_org_member` trigger.

## Storage
- Bucket: `member-documents` (with hyphen). Private — never embed direct URLs. Mint signed URLs server-side via the action layer (see `getDocumentDownloadUrl` in `conversation-actions.ts`). Inline view: 120s. Download: 120s with `{ download: fileName }`.
- 10 MB cap and the allowed MIME list are constants in `conversation-actions.ts` (`MAX_DOCUMENT_SIZE`, `ALLOWED_CONTENT_TYPES`).

## Don't
- Don't invent a `@/lib/actions/` directory — actions live under `@/app/(dashboard)`.
- Don't add `token_hash` / `type` handling to the auth callback. Don't modify Supabase email templates.
- Don't render auth- or org-scoped data from a `page.tsx` without `force-dynamic`.
- Don't add unauthenticated API routes or server actions without explicit discussion.
- Don't trust client-supplied `organisation_id`. Always derive from the caller's `members` row.
- Don't use `getUser()` for proxy session refresh — it's `getClaims()`.
- Don't try to fix build/runtime weirdness by editing auth code. First run `rm -rf .next node_modules/.cache && npm run dev`.
