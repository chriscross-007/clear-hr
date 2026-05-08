# ClearHR - Project Guide

## Working agreement with Chris
- Chris directs at the strategic level. He does not read or edit the code, `CLAUDE.md`, or `.github/copilot-instructions.md`. Don't put discipline, follow-through, or maintenance work on him.
- Claude owns the codebase and the design docs. When a session introduces a new convention, table, or pattern, update these docs as part of the work — not as a separate ask. Mirror rules that affect inline completion into `.github/copilot-instructions.md`.
- Verification is Claude's job. Read the existing file before drafting changes — never speculate about file locations, action names, or DB column names. Catch mismatches with shipped code before reporting "done."
- Don't write postambles that hand work back to Chris ("you may want to…", "if X happens, do Y…"). If something needs doing and Claude can do it, just do it.
- **Linear "Done" is Chris's call.** Issues stay in **In Progress** through the whole life of the work — including after Claude has finished implementation and is waiting for Chris to test. Do not move to "In Review", "Ready for Review", or any intermediate state. The only state transitions Claude makes are: Backlog/Todo → In Progress when starting work, and In Progress → Done **only after Chris has tested the change and explicitly told Claude to mark it Done**. No exceptions. (Most issues are short-lived; minimising state changes keeps the Linear board calm.)

## Where to start a new session
- Active work and design intent live in Linear (team: **ClearHR**, https://linear.app/clearhr). Issue descriptions are dense and self-contained — read the relevant issue in full before touching code.
- The repo at `C:\Lifeboat\VsCode\clear-hr` is the source of truth.
- This `CLAUDE.md` captures conventions that aren't obvious from the code. If you catch yourself drifting from the codebase's actual patterns, fix this file so the next session benefits.

## Product Overview
B2B HR management platform for web and mobile. Organisations sign up, add their employees, and manage day-to-day HR operations.

## User Roles

| Role | Scope | Permissions |
|------|-------|-------------|
| **SuperUser** | Platform-wide | Read-only access to metrics across all organisations. Cannot modify any organisation's data. Appointed by the platform owner. |
| **Owner** | Their organisation | Full control. Created the organisation. Can manage admins, members, billing, and settings. |
| **Admin** | Their organisation | Managers who control day-to-day operations — approve leave, manage members, configure the app for their org. |
| **Employee** | Their own data | Employees who can view their own data and request holidays. |

### Role Rules
- Every user belongs to exactly one organisation (except SuperUsers who operate across all)
- Owner is assigned automatically to whoever creates the organisation
- Admins and Employees are scoped to a single organisation
- RLS policies must enforce role-based access at the database level

## Tech Stack
- **Framework:** Next.js 16 (App Router, Turbopack)
- **React:** 19
- **Language:** TypeScript (strict mode)
- **Database & Auth:** Supabase (supabase-js v2, @supabase/ssr v0.8)
- **Data Grid:** @tanstack/react-table (headless sorting/filtering)
- **Styling:** Tailwind CSS v4 (OKLch color space)
- **UI Components:** shadcn/ui (new-york style, Radix UI primitives, Lucide icons)
- **Deployment:** Vercel (auto-deploy from GitHub)

## Project Structure
```
src/
├── app/
│   ├── (dashboard)/            # Authenticated app shell (layout + MemberLabelProvider)
│   │   ├── layout.tsx          # Dashboard layout (auth check, org fetch, header)
│   │   └── employees/          # Employee listing page
│   │       ├── page.tsx        # Server component (data fetch)
│   │       ├── employees-client.tsx  # Client component (TanStack Table grid)
│   │       ├── edit-employee-dialog.tsx
│   │       ├── add-employee-dialog.tsx
│   │       └── actions.ts      # Server actions (addEmployee, sendInvite, updateEmployee, getInviteDetails)
│   ├── accept-invite/          # Branded signup page for invited employees
│   ├── auth/callback/          # OAuth/email code exchange
│   ├── login/                  # Login page (client component)
│   ├── signup/                 # Signup page (client component)
│   ├── forgot-password/        # Request password reset
│   ├── reset-password/         # Set new password
│   ├── logout/                 # Sign out (server component)
│   ├── organisation-setup/     # Org onboarding (forced for new users)
│   └── page.tsx                # Landing page (public)
├── components/
│   ├── landing/                # Landing page sections
│   └── ui/                     # shadcn components
├── contexts/
│   └── member-label-context.tsx # MemberLabel React context
├── lib/
│   ├── supabase/
│   │   ├── client.ts           # Browser client (createBrowserClient)
│   │   ├── server.ts           # Server client (createServerClient + cookies)
│   │   └── proxy.ts            # Session refresh + auth redirects
│   ├── label-utils.ts          # capitalize(), pluralize()
│   └── utils.ts                # cn() utility
└── proxy.ts                    # Root proxy (Next.js 16 convention)
```

## Key Conventions

### Path Alias
`@/*` maps to `./src/*` — always use `@/` imports.

### Authentication Rules
- Use `getClaims()` in the proxy for session refresh — NOT `getUser()`
- Logout MUST be a server component (not client with useEffect)
- Auth callback only needs the `code` param via `exchangeCodeForSession(code)`
- Do NOT modify Supabase email templates — the default PKCE flow works
- Do NOT add `token_hash` or `type` handling to auth callback

### Proxy Redirects
- Authenticated users without an organisation → `/organisation-setup`
- Authenticated users with an organisation on `/` → `/employees`
- `member_label` stores how the org refers to employees (e.g. "colleague", "employee", "member")
- Skip list (no org-check redirect): `/login`, `/signup`, `/forgot-password`, `/reset-password`, `/logout`, `/auth/callback`, `/organisation-setup`, `/accept-invite`

### Dynamic Member Label
- The org's `member_label` (e.g. "colleague") replaces "employee" throughout the UI
- `MemberLabelProvider` in `(dashboard)/layout.tsx` provides the label via React context
- Client components use `useMemberLabel()` hook from `@/contexts/member-label-context`
- Use `capitalize()` and `pluralize()` from `@/lib/label-utils` for display
- **Standing rule:** never hardcode the words "employee" / "employees" (or "Employee" / "Employees") in any UI-facing string. Always resolve via `useMemberLabel()` and format with `capitalize()` / `pluralize()`. This applies to labels, placeholders, button text, dialog copy, tooltips, table headers, and any other user-visible strings. DB column names (e.g. `employee_note`) and TypeScript identifiers are exempt.

### Server Actions
- Server actions that modify other users' data use a service role client (bypasses RLS)
- The service role client is created with `SUPABASE_SERVICE_ROLE_KEY` (server-only, never `NEXT_PUBLIC_`)
- Always verify caller permissions in the action before using the admin client
- `addEmployee()` — creates a `members` record only (no auth user). Employee has `user_id = NULL` until they accept the invite.
- `sendInvite(memberId)` — sends invite email via Resend with a branded link to `/accept-invite?token=xxx`. Sets `invited_at`.
- `updateEmployee()` — updates names on `members`.
- `getInviteDetails(token)` — public (no auth required), returns email/name/orgName for the accept-invite page.

#### File location and import path
- Page-specific actions are co-located with the page in `actions.ts` (e.g. `(dashboard)/employees/actions.ts`).
- Cross-cutting actions used by multiple pages live at the dashboard root: `(dashboard)/<domain>-actions.ts` (e.g. `conversation-actions.ts`, `team-actions.ts`, `holiday-booking-actions.ts`, `holiday-period-actions.ts`).
- **Pure helpers next to actions:** when a domain needs synchronous, non-server-action helpers (pure functions, types, computed-value calculators), put them in a sibling file *without* the `"use server"` directive — e.g. `holiday-period-compute.ts` next to `holiday-period-actions.ts`. Required because every export of a `"use server"` file must be an async function.
- Import path is always `@/app/(dashboard)/<file>`. There is **no** `@/lib/actions/` directory — do not invent one.
- Every actions file must start with `"use server";`.

#### Return shape — result envelope, never thrown to the client
- All server actions return a `{ success: boolean; error?: string; ...payload }` object.
- Wrap the body in `try/catch`; convert any thrown error to `{ success: false, error: e instanceof Error ? e.message : "An error occurred" }`. The client should never see an unhandled rejection.
- Client components destructure `success`/`error` and render the error inline. Do not throw from the client.
- Example shapes from the codebase:
  - `{ success: true, documentId }`
  - `{ success: true, url, downloadUrl, fileName }`
  - `{ success: false, error: "Document not found" }`

#### DTO mapping (snake_case DB → camelCase TS)
- DB columns are snake_case; action return types are camelCase. Always map at the action boundary — never leak raw DB shapes to the client.
- Pre-flatten relations into scalars where possible (e.g. uploader's full name comes back as `uploadedBy: string`, not a nested `uploader: { first_name, last_name }` object).
- Some standard renames in this codebase: `mime_type` → `contentType`, `file_name` → `fileName`, `file_size` → `fileSize`, `created_at` → `createdAt`, `document_label` → `documentLabel`.
- Co-locate the exported DTO type next to the action that returns it (e.g. `export type EmployeeDocument` lives in `conversation-actions.ts` next to `getEmployeeDocuments`).

#### Standard helpers (in `conversation-actions.ts` — reuse the same shape elsewhere)
- `getCallerMember()` → `{ supabase, member }`. The `supabase` is the caller's session client; `member` is `{ id, organisation_id, role }` resolved from the caller's auth user. Throws if not authenticated or no membership found — wrap calls in the action's outer `try/catch`.
- `getAdminClient()` → service-role Supabase client for cross-user reads/writes and storage operations. Always check the caller's permissions (via `getCallerMember()` plus a role/permission check) before using it.

### Cross-user server-side queries: always use getAdminClient()
Any server action that needs to read data belonging to other members in the same org (e.g. team member lists, colleague bookings, team sizes) must use `getAdminClient()` (service role client) for those queries — NOT the caller's Supabase session client.

Using the caller's session client for cross-user queries will silently fail due to RLS. The employee can only see their own rows, so counts like `teammates.length` or `onLeaveCount` will come back as 0/1 and any validation logic will silently pass when it should be blocking.

**Rule:**
- Cross-user queries (team members, colleague bookings, org-wide data not readable by employees) → `getAdminClient()`
- User-scoped queries (own bookings, org settings readable by all, notice period rules) → caller's session client

**Example:** `validateBookingRules()` in `holiday-booking-actions.ts` — team cover queries use `getAdminClient()`, notice period queries use the caller's client.

### Supabase
- Use MCP tool `mcp__supabase__search_docs` to look up current documentation before implementing unfamiliar patterns
- Browser client: `createClient()` from `@/lib/supabase/client`
- Server client: `createClient()` from `@/lib/supabase/server` (async, uses cookies)
- Admin client: `createClient(url, SERVICE_ROLE_KEY)` from `@supabase/supabase-js` (server actions only)
- Environment variables: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`
- **Explicit FK hints on `holiday_bookings`:** This table has two FKs to `members` (`member_id` and `approver1_id`). Supabase cannot disambiguate and silently returns no data. Always use `employee:members!holiday_bookings_member_id_fkey(first_name, last_name, ...)` or fetch members separately via a lookup map. Never use the ambiguous `members(...)` form. This applies to all queries on `holiday_bookings` that join to `members`, including in `page.tsx`, server actions, and any future files. The recommended pattern is to fetch members as a separate query and join by `member_id` in application code.

### Next.js 16
- Uses `proxy.ts` (not `middleware.ts`) with `export async function proxy()`
- The `middleware` export name is deprecated in Next.js 16

### Styling
- Use shadcn/ui components from `@/components/ui/`
- Use `cn()` from `@/lib/utils` for conditional class merging
- Tailwind v4 with CSS variables for theming (defined in globals.css)

## Database Schema

### Tables
- **`organisations`** — Fields: `id`, `name`, `slug` (unique), `member_label` (default "member"), timestamps. Holiday year settings: `holiday_year_start_type` (`'fixed' | 'employee_start_date'`), `holiday_year_start_day`, `holiday_year_start_month`. **Default Cascade columns** (CLE-167) seed each new employee's cog at creation: `default_holiday_type`, `default_holiday_units`, `default_holiday_earned_factor`, `default_holiday_allowance`, `default_holiday_toil_hours_per_day`, `default_holiday_max_carry_forward`, `default_holiday_min_carry_forward` — all NOT NULL with hardcoded fallbacks (`fixed` / `days` / `0` / `0` / `0` / `0` / `-999`).
- **`teams`** — Groups within an org. Fields: `id`, `organisation_id` (FK), `name`, timestamp.
- **`members`** — Core access control and member profile data (single source of truth). Fields: `id`, `organisation_id` (FK), `user_id` (FK, **nullable** — NULL until employee accepts invite), `email`, `first_name`, `last_name`, `known_as`, `avatar_url`, `team_id` (FK, nullable), `role` (owner/admin/employee), `permissions` (JSONB), `invite_token` (UUID, unique), `invited_at`, `accepted_at`, `start_date` (date, nullable), timestamps. **Per-employee Holiday cog columns** (CLE-167) snapshotted from org defaults at employee creation, non-null thereafter: `holiday_type`, `holiday_units`, `holiday_earned_factor`, `holiday_allowance`, `holiday_toil_hours_per_day`, `holiday_max_carry_forward`, `holiday_min_carry_forward`. These seed the values of new `holiday_periods` rows; admin can edit via the cog on the employee's Holiday secondary menu (changes affect only future periods, not existing ones). Unique on (organisation_id, email). Partial unique on (organisation_id, user_id) WHERE user_id IS NOT NULL.
- **`superusers`** — Platform-level access. Fields: `id`, `user_id` (FK, unique), timestamp.
- **Earned-period allowance from timesheet (CLE-175)** — Earned-type Holiday Periods derive `allowance` from actual worked hours pulled from the timesheet via `getMemberWorkedHoursInRange` (in `@/lib/timesheet-totals`). Formula: `worked × earnedFactor / 100`. For `units = "hours"` the worked value is hours; for `units = "days"` the helper divides by the Work Profile's average hours-per-working-day (resolved at `period.startDate`, fallback 8). The compute helper looks up worked hours via `ComputeContext.workedHoursByPeriodId`. Page (`members/[memberId]/holiday/page.tsx`) and `setHolidayPeriodLock` populate the map for Earned periods only — Fixed periods skip the timesheet round-trip. The Holiday Periods table renders **Worked** + **Factor %** columns (between Brought Fwd and Allowance) only when at least one period is Earned; Fixed rows show "—" in those cells.
- **`holiday_bookings` × `holiday_periods` attribution (CLE-173)** — `computeAllHolidayPeriodValues` walks each booking day-by-day, attributes each working day to whichever period covers that date, and converts to the period's units (days-mode = +1 day per working day; hours-mode = + the Work Profile's hours-for-that-DOW). Straddling bookings are split correctly across periods, including across mismatched units (one days, one hours) and mismatched types (one fixed, one earned). Bank holidays follow the org's `bank_holiday_handling` (`additional` = skipped as free days; `deducted` = counted as normal). Half-day flags (`start_half`, `end_half`) apply at the booking ends. The booking's stored `days_deducted` / `hours_deducted` columns are display-only for the booking lists/reports — the compute helper ignores them and re-derives from the Work Profile. **Work Profile is resolved per-date, not as-of-today** — `getMemberWorkPatternHistory` returns every employee_work_profiles assignment plus the org default as a pre-history fallback, and `patternForDate(history, iso)` picks the entry that applies on each calendar day. Future-dated assignments (e.g. effective_from = 2027-01-01) are honoured for any date on or after their effective_from. The same history is also used by the planner calendar's schedule overlay so cells tint correctly across assignment boundaries. The compute helper requires a `ComputeContext` (work pattern history + bank holiday set + handling); fetch via the helpers in `@/lib/work-pattern-data`.
- **`holiday_periods`** — Per-employee holiday period record (CLE-167). Replaces the old `absence_profiles` + `holiday_year_records` model. Stored fields: `id`, `organisation_id` (FK), `member_id` (FK), `name`, `start_date`, `end_date`, `type` (`'fixed' | 'earned'`), `units` (`'days' | 'hours'`), `allowance` (numeric, **null for `earned` type, NOT NULL for `fixed`** — enforced by `chk_holiday_periods_allowance_per_type`), `earned_factor`, `adjust`, `max_carry_forward`, `min_carry_forward` (≤ 0 by check), `locked` (boolean), `locked_snapshot` (jsonb, NULL when unlocked), timestamps. Computed at query time, never stored: Brought Forward, Worked, Toil, Taken, Booked, Balance, Carry Forward — derived from chained periods + `holiday_bookings` + timesheet data. **Lock semantics (CLE-172):** when a period is locked, `setHolidayPeriodLock` snapshots the period's `ComputedPeriodValues` into `locked_snapshot`. `computeAllHolidayPeriodValues` emits the snapshot directly for locked rows and uses `snapshot.carryForward` as the next period's broughtForward — so earlier manual edits do not propagate through a locked period. Legacy locked rows (NULL `locked_snapshot`) fall back to live compute; admin re-locks to opt them in. Constraints: unique `(member_id, name)` (Name uniqueness per employee), GiST exclusion `(member_id, daterange(start_date, end_date, '[]'))` blocks overlapping periods at the database level. RLS: employees see their own periods; admins/owners see all org periods and can INSERT/UPDATE/DELETE.
- **`member_documents`** — Files uploaded for or by a member, including absence-booking attachments. Fields: `id`, `organisation_id` (FK), `member_id` (FK — the member the doc relates to), `uploaded_by` (FK `members.id`, nullable), `conversation_message_id` (FK, nullable — set when uploaded via chat), `storage_path`, `file_name`, `file_size`, `mime_type` (returned to clients as `contentType`), `entity_type` (e.g. `'absence_booking'`), `entity_id` (uuid of the linked entity), `document_category` (auto-set, e.g. `'absence_document'`), `document_label` (admin-set vocabulary: `self_certification` | `medical_certificate` | `fit_note` | `prescription` | `other`), `created_at`. RLS: employees see only rows where `member_id = self`; admins/owners see all org rows. UPDATE policy permits admin/owner to set `document_label`.

**Note: `absence_profiles` and `holiday_year_records` were dropped in CLE-167.** Holiday Profiles are gone — the model is now profileless. Each employee has zero or more `holiday_periods` directly, with parameters seeded from the cog columns on `members`. The settled spec lives at https://linear.app/clearhr/document/profileless-holiday-management-settled-spec-bae7e878e485.

### Permissions (JSONB on members)
Granular feature flags per member. No schema change needed to add new permissions.
```json
{
  "can_request_holidays": true,
  "can_approve_holidays": false,
  "can_view_team_members": false,
  "can_view_all_teams": false,
  "can_manage_members": false,
  "can_edit_organisation": false
}
```

### Visibility Rules
- **Employees**: See only their own record by default. `can_view_team_members` grants read-only access to teammates. Can never update other members.
- **Admins**: See their own team by default. `can_view_all_teams` grants visibility across all teams.
- **Owners**: See and manage all members in their org.
- **SuperUsers**: Read-only access across all orgs.

### Helper Functions
- `is_superuser()` — Returns boolean
- `get_user_role(org_id)` — Returns role text
- `get_user_team_id(org_id)` — Returns team UUID
- `get_user_permission(org_id, permission_key)` — Returns boolean
- `create_organisation(org_name, org_slug, org_member_label)` — SECURITY DEFINER RPC, creates org + owner membership (populates email/name from auth.users)
- `get_org_members()` — SECURITY DEFINER RPC, returns members with invite status fields (invited_at, accepted_at), enforces visibility rules

### Triggers
- `link_user_to_org_member` — Fires on `auth.users` INSERT. Matches new user's email to a pending `members` record (where `user_id IS NULL`) and links them by setting `user_id` and `accepted_at`.
- `set_*_updated_at` — Auto-updates `updated_at` on organisations, members

### Invite Flow
1. Admin creates employee → `addEmployee()` inserts `members` with `user_id = NULL`
2. Admin clicks Invite → `sendInvite()` sends email via Resend, sets `invited_at`
3. Employee clicks link → `/accept-invite?token=xxx` shows branded signup form
4. Employee signs up → `supabase.auth.signUp()` creates auth user
5. Database trigger `link_user_to_org_member` matches email → sets `user_id` + `accepted_at`
6. Employee is now fully linked and can log in

**Status badges in grid:** "Not invited" (grey) → "Invited" (amber) → "Active" (green)
**Edit dialog invite button:** "Invite" → "Resend Invite" → "Accepted" (disabled)

### Storage
- **Bucket: `member-documents`** (note the hyphen). Private bucket holding everything in the `member_documents` table. Storage RLS is permissive; access is mediated by the action layer (e.g. `getDocumentDownloadUrl` in `conversation-actions.ts`), which checks the caller's row-level access on `member_documents` first via the session client, then issues a short-lived signed URL via the admin client.
- **Signed-URL conventions:**
  - Inline view URL: 120-second expiry.
  - Download URL: 120-second expiry, with `{ download: fileName }` to set `Content-Disposition: attachment`.
- **Allowed MIME types** and the **10 MB size cap** are defined in `conversation-actions.ts` as `ALLOWED_CONTENT_TYPES` and `MAX_DOCUMENT_SIZE`. Validate against these in any new upload path.

## Error Troubleshooting
**First response to ANY build/runtime error** — Chris runs on Windows PowerShell, so use the PowerShell form:
```powershell
Remove-Item -Recurse -Force .next, node_modules\.cache -ErrorAction SilentlyContinue
npm run dev
```
The bash form (`rm -rf .next node_modules/.cache && npm run dev`) doesn't work on PowerShell.

Do NOT modify auth code to "fix" cache issues.

| Error | NOT the cause | Actual cause | Fix |
|-------|--------------|--------------|-----|
| HTTP 431 | Cookies, auth code | Corrupted .next cache | Clear cache |
| Turbopack panic | Your code | Cache corruption | Clear cache |
| Auth callback loops | Token handling | Missing `next` param | Add `?next=` to redirectTo |

## UI Conventions
- **Row editing:** Never use a pencil/edit icon button on list rows. Make the entire row clickable to open edit mode (`cursor-pointer hover:bg-muted/50 onClick={() => startEdit(...)}`). Only action buttons that are destructive (delete) or independent (drag handle) should remain as separate icons with `e.stopPropagation()`. The choice of modal vs page for the edit target is decided per screen based on complexity — do not default to inline editing.
- **Inline-cell editing in tables:** When a table is essentially a spreadsheet of editable scalars (e.g. the Holiday Periods table on the employee Holiday page), edit the cells inline rather than via a slide-out form — the slide-out duplicates the column layout and gets confused with adjacent settings forms (cog, defaults). Pattern (see `members/[memberId]/holiday/employee-holiday-client.tsx`): track a single `editing: { rowId, field } | null` plus a string `draft`; click a cell → `startEdit(row, field)`; render `<input>`/`<select>` only for the matching cell; **Enter** blurs and commits, **blur** commits, **Escape** cancels; commit calls the row's full update server action with the current row + the changed field. Critical implementation detail — define the cell components (`TextCell`, `DateCell`, `SelectCell`) at module top-level and pass the inline-edit state bundle as a prop. Defining them inside the parent function recreates their identity each render, which makes React unmount the input on every keystroke and drop focus. Native `<select>` cells should commit immediately on `onChange` (with the new value passed as a `valueOverride`) since picking an option closes the dropdown. Locked rows render the cells as static text (no edit affordance). **Cell-width stability:** wrap the input/select in a `relative` container alongside an `aria-hidden invisible` ghost span carrying the at-rest display text — the ghost dictates the cell's natural width and the editor sits on top via `absolute inset-0`, so clicking a cell does not widen the column. Use `size={1}` and `min-w-0` on the input to neutralise its default ~20-char intrinsic width; padding/font-size on the ghost must match the editor for the widths to line up exactly.
- **Boolean values in tables:** Never display "Yes" or "No" text for boolean columns. Use Lucide icons instead: `<Check className="h-5 w-5 text-green-500" />` for true, `<X className="h-5 w-5 text-red-500" />` for false. Icons should be sized to fill approximately 50% of the row height.
- **Date filters:** Date and datetime columns use a preset dropdown ordered Last/This/Next per period (Last Week, This Week, Next Week, Last Month, This Month, Next Month, Last Year, This Year, Next Year, Custom range...) rather than raw date pickers. "Custom range..." reveals From/To date inputs. Filter value shape: `{ preset?: string; from?: string; to?: string }`. The `getDateRange(preset)` helper in `employees-client.tsx` resolves presets to `{ from, to }` ISO date strings. Applies to `last_log_in` and all `date`-type custom field columns.
- **Dialogs and Sheets — Scrollable body:** Any Dialog or Sheet that contains a form must use a scrollable body layout to ensure the header and footer buttons remain visible at all screen heights. The header (title) sits outside the scrollable area. Form fields are wrapped in `overflow-y-auto max-h-[60vh]`. The footer (Save/Cancel buttons) sits outside the scrollable area. Structure: `<DialogHeader>...</DialogHeader>` then `<div className="overflow-y-auto max-h-[60vh] px-1">` containing all form fields, then `<DialogFooter>...</DialogFooter>`. This applies to ALL dialogs and sheets with forms, regardless of how few fields they currently have — forms grow over time.
- **Date/time formatting:** Use `toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })` for human-facing date+time. UK locale, 24-hour clock. Do not pull in `date-fns` just for formatting.
- **Signed-URL images:** Document/photo viewers that load a signed URL must use a plain `<img>` (with an `// eslint-disable-next-line @next/next/no-img-element` comment), not `next/image`. `next/image` cannot proxy signed URLs that change per request and will fail on configured-domain checks.
- **Bulk-selection in `DataGrid` (`@/components/data-grid/data-grid`):** the parent owns the selection state (typically `selectedIds: Set<string>`) and supplies a `select` column via `leadingColumnIds={["select"]}` plus a column-def with header + per-row checkboxes. For group-level select-all (when `groupBy` is set), pass `renderGroupHeaderPrefix={({ rowsInGroup, groupValue }) => ...}` to render a tri-state checkbox at the leading edge of each group header. The renderer receives the **full filtered set** of rows in the group (not just the visible page) so the checkbox toggles every member of the group at once. Use additive/subtractive helpers (e.g. `handleSetSelected(ids, selected: boolean)`) so toggling one group doesn't discard selections in others.
- **Sticky page header on every list page:** wrap the title in `<StickyPageHeader>` from `@/components/ui/sticky-page-header`, and put **every persistent control the user might want while the data scrolls** inside it — title, tabs, filter inputs, action buttons, secondary action rows, week-navigation, etc. The principle is that all controls stay fixed and only the rows of data scroll. If a control belongs with the page (not a row), it goes in the sticky band. The component is server-component safe and assumes the parent uses the standard `px-4 sm:px-6 lg:px-8` outer padding so its negative margins extend the band full-bleed.
- **Tabs in the sticky header:** when a page uses `<Tabs>`, place the `<Tabs>` wrapper around both `<StickyPageHeader>` and the `<TabsContent>`s, then put the `<TabsList>` inside `<StickyPageHeader>`. The Tabs context spans both so triggers stay sticky while content scrolls.
- **Sticky table-header on `DataGrid` pages:** when a page uses `<DataGrid>` AND has `<StickyPageHeader>`, also pass `stickyHeader` to `DataGrid` so its toolbar, column-header row and filter row stack into the same sticky group. The default `stickyHeaderTop={120}` assumes a single-line sticky title above. If the band is taller (multi-line title, extra action rows, page-level filters), pass a larger `stickyHeaderTop` value — DataGrid pins the toolbar at that offset, the column header at `stickyHeaderTop + 56`, and the filter row at `stickyHeaderTop + 96`. Approximate band heights (px) used in the codebase: single h1 ≈ 120, h1 + meta + Row 2 ≈ 240, two-line meta + h1 ≈ 160.

## Data Security — Non-Negotiable Rules

ClearHR handles sensitive personal and employment data. Security is not optional. **When in doubt about any security decision, stop and ask the user before proceeding.**

### The two-layer security model
1. **RLS (Row Level Security)** — the real security boundary. Enforced at the database level. Cannot be bypassed by application code bugs. Every table that holds org data must have RLS policies that enforce org-scoping.
2. **`export const dynamic = 'force-dynamic'`** — must be present on every `page.tsx` that queries the Supabase database. Prevents Next.js from serving a cached render from a previous session (e.g. after an account switch), which could expose one org's data to another org's user.

### Rules
- **Every page that reads data from the Supabase DB must have `export const dynamic = 'force-dynamic'` at the top.** No exceptions, regardless of where in the folder structure the page lives.
- **Never expose data across organisation boundaries.** All queries must be scoped to the caller's `organisation_id`. Use the `get_org_members()` RPC (which enforces this) rather than direct table queries where possible.
- **Never trust client-supplied org IDs.** Always derive `organisation_id` from the authenticated session (the caller's `members` row), not from form data or URL params.
- **Service role client bypasses RLS** — only use it in server actions, always verify caller permissions first before using it to modify data.
- **Normalise emails to lowercase** before storing in the database (`email.trim().toLowerCase()`). Supabase auth normalises to lowercase; mismatches break trigger matching and cause data integrity issues.
- **Avoid OWASP Top 10 vulnerabilities** — SQL injection, XSS, insecure direct object references, broken access control, etc. Prefer parameterised queries (supabase-js handles this) and validate inputs server-side.
- **Do not add new public (unauthenticated) API routes or server actions** without explicit discussion. All data-reading actions must verify the caller's session.

### When to ask
If a new feature requires any of the following, stop and ask before implementing:
- A new RPC or DB function with `SECURITY DEFINER`
- Exposing data to a role that doesn't currently have access to it
- Any cross-org data access (e.g. SuperUser features)
- Removing or relaxing an existing RLS policy
- A new unauthenticated endpoint

## Commands
- `npm run dev` — Start dev server
- `npm run build` — Production build
- `npm run lint` — ESLint
