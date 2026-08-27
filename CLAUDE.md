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

## User access model

ClearHR's access model is **Rights Profiles v2** — every access decision resolves through `members.rights_profile_id` → `rights_profiles` → the `EffectiveRights` object returned by `getEffectiveRightsForUser(userId)` in `src/lib/rights-resolver.ts`. See the full section below (**Rights Profiles v2**) for shape, seed defaults, redaction rules, and the guard triggers.

**One-line rule for any new session:** if you're gating a page, an action, or a UI affordance, read the flag from the resolver — never from `members.role` or `members.permissions`. Those columns still exist as vestigial legacy (see the Residual legacy subsection under Rights Profiles v2) but are ignored by the resolver.

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
- Cross-cutting actions used by multiple pages live at the dashboard root: `(dashboard)/<domain>-actions.ts` (e.g. `conversation-actions.ts`, `team-actions.ts`, `holiday-booking-actions.ts`, `holiday-period-actions.ts`, `approval-profile-actions.ts`).
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
- **Team membership and Team Access** — Every member belongs to **exactly one** team via `members.team_id`. Cross-team visibility is governed by the rights_profile's `cross_user_access`: `self` sees only own record, `team` sees only the caller's own team, `all` sees every team. The Availability page + Employees Directory both use this scoping. The legacy `permissions.object_access.teams` pattern with `scope: 'own'|'all'|'selected'` was replaced by cross_user_access in CLE-196b; see the Rights Profiles v2 section for the resolver call sites.
- **Open-ended bookings and team cover (CLE-187)** — A booking with `end_date IS NULL` (typically a sick booking with no return logged) is treated as "still on leave indefinitely" by the team-cover check in `getMyTeamCoverContext` / `validateBookingRules`. The Availability `<TeamCalendar>` matches this: open-ended bookings render through to the end of the visible window, with cells past **today** drawn as a diagonal stripe (`repeating-linear-gradient`) on a muted background to flag "ongoing — return date not set". The "Off" summary row counts these post-today cells too, so the calendar and the booking-sheet cover warning always agree about who's off. Stale open-ended bookings (e.g. left behind after a member's Holiday Periods are deleted) are surfaced via the Member Bookings utility (see below).
- **Member Bookings utility (CLE-188)** — `holiday_bookings` rows are independent of `holiday_periods`, so deleting a member's Holiday Periods does **not** delete their bookings. To find and clean up orphaned bookings, the Employment page renders a `<BookingsCard>` (`members/[memberId]/employment/bookings-card.tsx`) listing every booking on the member with start/end/reason/status/created and a Delete action. Visible to admins with `canEdit` (owner or admin with `can_manage_members='write'`). Delete reuses `adminDeleteBooking` from `holiday-booking-actions.ts` — no separate hard-delete action; that function already removes the row and logs a `booking.deleted` audit entry. New action: `getMemberBookings(memberId)` returns `MemberBookingRow[]`.
- **Submit-time warning snapshot (CLE-189)** — when an employee submits a holiday request, `validateBookingRules` now computes notice + cover violations *universally* (regardless of `notice_rules_block_requests`) and returns `{ error?, noticeWarning?: boolean, coverWarning?: boolean }`. The `error` is only set when the org's block flag is on AND a violation exists. The submit path writes the warning flags to two new columns on `holiday_bookings` — `notice_violation_at_submit` and `cover_violation_at_submit` (both `boolean NOT NULL DEFAULT false`). Snapshot semantics: the flags freeze the state at submit time and never recompute. The Approvals page reads them to render "Notice" / "Cover" badges next to the Approve/Reject controls and to show a warning panel inside the Approve dialog (Approve button label flips to "Approve anyway"). The badges render outside the `canActOnRow` branch so the warning context is visible to all viewers, not only those who can act — but the decision itself still belongs to the booking's routed approver (no routing override). Rule-overriding requests follow the same approval routing as any other booking; what changes is the surfaced context, not the chain of authority. The per-pending-row inline calendar receives `requiredCover` (the team's `min_cover`), `offendingDates` (working days within the request's range where approving would drop the team below Min Cover — computed server-side against latest team state by `buildCoverContexts` in `approvals-actions.ts`), and `coverMode` so the bottom summary row reads as "members present" (team size minus off) rather than "off". The `TeamCalendar` component renders offending dates in red on both the day-of-month header and the bottom Cover row. **The Availability page uses the same `<TeamCalendar>` in cover mode**: it passes `coverMode` plus the selected team's `requiredCover` and lets the calendar auto-compute offending dates from its own off-counts (any working day where present falls below `requiredCover`). When "All Teams" is selected on Availability, `requiredCover` is omitted and there are no red highlights — there's no single team threshold to compare against.
- **`members`** — Core member record. Fields: `id`, `organisation_id` (FK), `user_id` (FK, **nullable** — NULL until employee accepts invite), `email`, `first_name`, `last_name`, `known_as`, `avatar_url`, `team_id` (FK, nullable), `invite_token` (UUID, unique), `invited_at`, `accepted_at`, `start_date` (date, nullable), timestamps. **Rights** — `rights_profile_id` (FK to `rights_profiles`, drives every access decision via the resolver) + `is_billing_contact` (boolean, unique partial index one-per-org). **Profile FKs** (auto-assigned to the org's Default on insert via triggers): `notice_period_profile_id`, `holiday_profile_id`. **Legacy vestigial** — `role`, `permissions`, `admin_profile_id`, `employee_profile_id` still exist because the SECURITY DEFINER RLS helpers read them; the resolver ignores them. See Rights Profiles v2 → Residual legacy. Unique on (organisation_id, email). Partial unique on (organisation_id, user_id) WHERE user_id IS NOT NULL.
- **Holiday Profiles (CLE-194 Phase 2)** — Each org has a `holiday_profiles` row per profile (one `is_default`, undeleteable; others freely created and removed). Each member points at exactly one profile via `members.holiday_profile_id`, auto-seeded on insert by `trigger_assign_holiday_profile`. The 7 holiday values (`holiday_type`, `holiday_units`, `holiday_earned_factor`, `holiday_allowance`, `holiday_toil_hours_per_day`, `holiday_max_carry_forward`, `holiday_min_carry_forward`) live on the profile; `members.holiday_*` columns and `organisations.default_holiday_*` columns were dropped in this phase. **`getNewPeriodDefaults`** (in `holiday-period-actions.ts`) resolves the 7 values via `members.holiday_profile_id` → `holiday_profiles.holiday_*`. **Snapshot semantics** — values copy onto each `holiday_periods` row at creation; editing a profile only affects new periods, never existing ones. **Default starting values** (used by the org-create + member-insert triggers): Fixed / Days / allowance=20 / earned_factor=0 / toil=0 / max_carry=0 / min_carry=0. **Auto-create-first-period (CLE-194 Phase 2)** — `tryAutoCreateFirstPeriod(memberId)` in `holiday-profile-actions.ts` is called from `addEmployee`, `setMemberHolidayProfile`, and `updateMemberStartDate`. Idempotent; fires when the member has a `holiday_profile_id` AND (org is Fixed Day OR member has `start_date`) AND no period rows exist yet. The cog UI on `/members/[memberId]/holiday` was removed in this phase — the picker on Employment is the only assignment surface.
- **`superusers`** — Platform-level access. Fields: `id`, `user_id` (FK, unique), timestamp.
- **Earned-period allowance from timesheet (CLE-175)** — Earned-type Holiday Periods derive `allowance` from actual worked hours pulled from the timesheet via `getMemberWorkedHoursInRange` (in `@/lib/timesheet-totals`). Formula: `worked × earnedFactor / 100`. For `units = "hours"` the worked value is hours; for `units = "days"` the helper divides by the Work Profile's average hours-per-working-day (resolved at `period.startDate`, fallback 8). The compute helper looks up worked hours via `ComputeContext.workedHoursByPeriodId`. Page (`members/[memberId]/holiday/page.tsx`) and `setHolidayPeriodLock` populate the map for Earned periods only — Fixed periods skip the timesheet round-trip. The Holiday Periods table renders **Worked** + **Factor %** columns (between Brought Fwd and Allowance) only when at least one period is Earned; Fixed rows show "—" in those cells.
- **Shared planner calendar components (CLE-176)** — `<CalendarLegend>` (left rail key) and `<CalendarFilterPanel>` (right rail filters: absence-type checkboxes + Schedule + Bank Holidays) live in `@/components/calendar/`. Used by both the admin's employee planner (`members/[memberId]/calendar/admin-calendar-client.tsx`) and the employee's own My Holiday Calendar tab (`holiday/my-holiday-client.tsx`) so both views render an identical key + filter. The period nav header (prev/next arrows + Current button + Days/Hours pill) is currently inlined in each consumer rather than extracted because the URL/state coupling differs slightly (admin uses `?periodId`; employee uses local state path-relative).
- **Compute helper bucketing (CLE-177)** — `ComputedPeriodValues` exposes three mutually exclusive buckets: `taken` (status='approved' && date ≤ today), `booked` (status='approved' && date > today), `pending` (status='pending', past or future). `balance = bf + allowance + adjust + toil − taken − booked − pending`. The Holiday Periods table renders **Pending** as its own column between Booked and Balance. Every page (admin Holiday page table, admin planner widget, My Holiday Overview + Calendar widget) reads these three from the compute output directly — no per-page pending walks. Locked-snapshot shape gained `pending`; legacy snapshots that lack it fall back to 0 (and may carry pending amounts inside `taken`/`booked` until re-locked). Bookings whose absence type does not deduct from entitlement (sick / compassionate / etc.) must be filtered out by callers before they're handed to the compute helper.
- **`holiday_bookings` × `holiday_periods` attribution (CLE-173)** — `computeAllHolidayPeriodValues` walks each booking day-by-day, attributes each working day to whichever period covers that date, and converts to the period's units (days-mode = +1 day per working day; hours-mode = + the Work Profile's hours-for-that-DOW). Straddling bookings are split correctly across periods, including across mismatched units (one days, one hours) and mismatched types (one fixed, one earned). Bank holidays follow the org's `bank_holiday_handling` (`additional` = skipped as free days; `deducted` = counted as normal). Half-day flags (`start_half`, `end_half`) apply at the booking ends. The booking's stored `days_deducted` / `hours_deducted` columns are display-only for the booking lists/reports — the compute helper ignores them and re-derives from the Work Profile. **Work Profile is resolved per-date, not as-of-today** — `getMemberWorkPatternHistory` returns every employee_work_profiles assignment plus the org default as a pre-history fallback, and `patternForDate(history, iso)` picks the entry that applies on each calendar day. Future-dated assignments (e.g. effective_from = 2027-01-01) are honoured for any date on or after their effective_from. The same history is also used by the planner calendar's schedule overlay so cells tint correctly across assignment boundaries. The compute helper requires a `ComputeContext` (work pattern history + bank holiday set + handling); fetch via the helpers in `@/lib/work-pattern-data`.
- **`holiday_periods`** — Per-employee holiday period record (CLE-167). Replaces the old `absence_profiles` + `holiday_year_records` model. Stored fields: `id`, `organisation_id` (FK), `member_id` (FK), `name`, `start_date`, `end_date`, `type` (`'fixed' | 'earned'`), `units` (`'days' | 'hours'`), `allowance` (numeric, **null for `earned` type, NOT NULL for `fixed`** — enforced by `chk_holiday_periods_allowance_per_type`), `earned_factor`, `adjust`, `max_carry_forward`, `min_carry_forward` (≤ 0 by check), `locked` (boolean), `locked_snapshot` (jsonb, NULL when unlocked), timestamps. Computed at query time, never stored: Brought Forward, Worked, Toil, Taken, Booked, Balance, Carry Forward — derived from chained periods + `holiday_bookings` + timesheet data. **Lock semantics (CLE-172):** when a period is locked, `setHolidayPeriodLock` snapshots the period's `ComputedPeriodValues` into `locked_snapshot`. `computeAllHolidayPeriodValues` emits the snapshot directly for locked rows and uses `snapshot.carryForward` as the next period's broughtForward — so earlier manual edits do not propagate through a locked period. Legacy locked rows (NULL `locked_snapshot`) fall back to live compute; admin re-locks to opt them in. Constraints: unique `(member_id, name)` (Name uniqueness per employee), GiST exclusion `(member_id, daterange(start_date, end_date, '[]'))` blocks overlapping periods at the database level. RLS: employees see their own periods; admins/owners see all org periods and can INSERT/UPDATE/DELETE.
- **`member_documents`** — Files uploaded for or by a member, including absence-booking attachments. Fields: `id`, `organisation_id` (FK), `member_id` (FK — the member the doc relates to), `uploaded_by` (FK `members.id`, nullable), `conversation_message_id` (FK, nullable — set when uploaded via chat), `storage_path`, `file_name`, `file_size`, `mime_type` (returned to clients as `contentType`), `entity_type` (e.g. `'absence_booking'`), `entity_id` (uuid of the linked entity), `document_category` (auto-set, e.g. `'absence_document'`), `document_label` (admin-set vocabulary: `self_certification` | `medical_certificate` | `fit_note` | `prescription` | `other`), `created_at`. RLS: employees see only rows where `member_id = self`; admins/owners see all org rows. UPDATE policy permits admin/owner to set `document_label`.
- **Holiday Approval Profiles (CLE-181)** — Three new tables drive named-routing of absence requests:
  - **`approval_profiles`** — Fields: `id`, `organisation_id` (FK), `name`, `absence_type_id` (FK), `is_default` (boolean), timestamps. Unique `(organisation_id, absence_type_id, name)`. Partial unique `(organisation_id, absence_type_id) WHERE is_default = true` (one default per absence type per org). One profile applies to one absence type; orgs may have multiple profiles per type.
  - **`approval_profile_levels`** — Fields: `id`, `profile_id` (FK), `level INT 1..3`, `length_threshold_days INT NULL`, `length_threshold_hours NUMERIC NULL`, `main_approver_ids uuid[]` (NOT NULL, ≥ 1), `delegate_approver_ids uuid[]` (NOT NULL DEFAULT `'{}'`), timestamps. NULL thresholds = always required for that booking unit. `≥` semantics only.
  - **`booking_approvals`** — Per-booking, per-level decision row. Fields: `id`, `booking_id` (FK), `level`, `main_approver_ids uuid[]` (snapshotted at submit), `delegate_approver_ids uuid[]`, `routed_to ('main' | 'delegate')`, `status ('pending' | 'approved' | 'rejected' | 'withdrawn')`, `decided_by_member_id`, `decided_at`, `comment`, `created_at`. Unique `(booking_id, level)`. Approver lists are snapshotted at submit time so subsequent profile edits never ripple into in-flight bookings.
- **`members.approval_profile_assignments`** — JSONB column. Shape `{ <absence_type_id>: <profile_id> }`. NULL/missing key = falls back to legacy "any admin can approve" model for that absence type. Seeded automatically by `trigger_seed_approval_profile_assignments` on member INSERT (mirrors every is_default profile in the org); admin can override per-employee via `setMemberApprovalProfile`.
- **`holiday_bookings.current_approval_level`** — INT NULL pointer to the active level. NULL = terminal (approved, rejected, cancelled, or auto-approved) OR legacy "any admin" (booking submitted before Phase A rollout, or for an absence type with no profile assigned). Drives the approvals-page filter.
- **Holiday Approvals routing (CLE-181, extended by CLE-183)** — At submit time `submitHolidayBooking` calls `resolveProfileForBooking(memberId, absenceTypeId)`. If a profile exists it walks the levels in order (1 → 3), picks the **lowest applicable level** (mains non-empty AND the booking length meets the level's threshold), checks each main approver's "unavailable today" status (= an approved Holiday or Sick booking covering today), routes to mains when at least one is available else to delegates, writes a `booking_approvals` row, and sets `current_approval_level` to that level. A level **applies** when its threshold is met for the booking's unit — `length_threshold_days` for days-mode, `length_threshold_hours` for hours-mode, NULL = always applies; the two thresholds are independent. **Routing notification vs decision rights (CLE-192):** `routed_to` on `booking_approvals` controls who gets the "request pending" email — mains when at least one main is available at submit, delegates when all mains are unavailable. But for *visibility and decision rights*, both `getPendingApprovalBookingIds` (sidebar count + Approvals page) and `checkApprovalAccess` (server-side approve/reject) check the **union** of `main_approver_ids` + `delegate_approver_ids`. Without this a main approver who was "unavailable" at submit (e.g. covering a Holiday booking that day) would never see the resulting request even after they return — the routing fallback is about who's notified, not who's locked out. **Cascade-on-approve (CLE-183):** `approveBooking` (and the bulk variant) checks the profile for a higher applicable level via `getCascadeAfterApproval`; when one exists, it writes a new `booking_approvals` row at that level, advances `current_approval_level`, and notifies the routed approvers (request-pending email). Otherwise the booking is marked fully approved and the employee gets a request-approved email. Reject at any level is terminal — `current_approval_level` is cleared and higher levels never see the request. Withdrawal (`cancelMyBooking`) marks every pending `booking_approvals` row for the booking as `withdrawn` and clears `current_approval_level`. List of approvers at a level: notify all, first-to-decide wins. **Approvals page UI:** the row's status cell shows a small ladder ("L1 ✓ → L2 ● → L3 ○") indicating which earlier levels have approved, the currently-active level, and any subsequent rung that hasn't yet been activated. Phase B (CLE-183) wires L2/L3 in the editor + cascade. A planned Phase C for "group approvers" (e.g. an HR group) was dropped — the list-of-named-approvers semantics on each level already give the same "any of these people can approve" behaviour. Spec: https://linear.app/clearhr/document/holiday-approvals-settled-spec-5a4138404dbb

**Note: `absence_profiles` and `holiday_year_records` were dropped in CLE-167.** Holiday Profiles are gone — the model is now profileless. Each employee has zero or more `holiday_periods` directly, with parameters seeded from the cog columns on `members`. The settled spec lives at https://linear.app/clearhr/document/profileless-holiday-management-settled-spec-bae7e878e485.

### Access decisions

Access is resolved through Rights Profiles v2 (see the **Rights Profiles v2** section below). Every page gate, server action, and UI affordance reads flags via `getEffectiveRightsForUser(userId)`. There is no per-member `permissions` blob to check; the profile itself carries the flags and the assignment on `members.rights_profile_id` drives the resolution.

Common decision → flag mappings:
- "Can this user see the Employees Directory?" → `rights.crossUserAccess !== "self"`
- "Can this user edit organisation settings?" → `rights.canEditOrgSettings`
- "Can this user approve holidays?" → `rights.canApproveHolidays`
- "Can this user see sensitive fields?" → `rights.canViewSensitiveFields`
- "Can this user edit User Rights?" → `rights.canEditRightsProfiles`
- "Can this user manage billing?" → `rights.canManageBilling`
- "Which tabs can this user view/update on member records?" → `rights.tabs[tabKey].view` / `rights.tabs[tabKey].update`

`crossUserAccess` scopes cross-user visibility to `self | team | all`. Rank is stored on `rights_profiles.rank` but has **no user-visible meaning** in the flat-list model (CLE-197) — it's vestigial metadata retained for the seed defaults and the RLS helpers until CLE-201 rewrites them.

### Helper Functions
- `is_superuser()` — Returns boolean.
- `get_user_role(org_id)` / `get_user_permission(org_id, key)` / `get_user_team_id(org_id)` — **Legacy RLS helpers.** Still read from `members.role` / `members.permissions` for backwards compat with the pre-CLE-196 RLS policies. Do not add new callers. The app resolves access through `getEffectiveRightsForUser` in `src/lib/rights-resolver.ts`. These helpers get rewritten to source from `rights_profiles` in CLE-201.
- `create_organisation(org_name, org_slug, org_member_label)` — SECURITY DEFINER RPC, creates org + owner membership (populates email/name from auth.users).
- `get_org_members()` — SECURITY DEFINER RPC. Currently reads `members.role` + `members.permissions` + joins `admin_profiles` / `employee_profiles` for the `profile_name` output. To be rewritten in CLE-201 to source rank + profile name from `rights_profiles`.
- `ensure_at_least_two_rights_editors_on_member` / `ensure_at_least_two_rights_editors_on_profile` — CLE-197 guard triggers. See the **Rights Profiles v2 → Guard triggers** section for full behaviour.
- `trigger_seed_approval_profile_assignments()` — fires AFTER INSERT on `members`. For every member insert, populates `approval_profile_assignments` JSONB with pointers to every is_default profile in the org. Idempotent.

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

## Settings page (CLE-191)

A full-page Settings shell at `/settings` replaces the old `OrganisationEditDialog`. The shell follows the per-employee shell pattern: a secondary sidebar (`src/app/(dashboard)/settings/settings-sidebar.tsx`) with seven sub-routes, each individually permission-gated:

- `/settings/organisation` — name, member label, currency, country, MFA, holiday year start, bank-holiday handling + colour. Partial-update via `updateOrganisation` (name + memberLabel made optional on that action so each sub-route only sends what it edits).
- `/settings/rates` — wraps `RatesManager` (pay multipliers used by Timesheet).
- `/settings/timesheet` — shift / break / variance / time-rounding rules.
- `/settings/custom-fields` — wraps `CustomFieldsManager`. Triggers `router.refresh()` on defs change so downstream pages pick up schema shifts. **Two-column shape (post the 20260824 migration):** `custom_field_definitions.field_type` is one of nine base data types (`text | multiline | email | url | phone | number | currency | date | checkbox`) and `input_mode` is one of three entry mechanisms (`freeform | single_choice | multi_choice`). Options apply for the two choice modes. This split replaces the legacy `dropdown` / `multiselect` field types, which conflated data type + entry mode. Value storage on `members.custom_fields`: single scalar for freeform / single_choice, `string[]` for multi_choice — always stored as the raw option string regardless of base type, and rendered through `formatOptionForDisplay()` (in `components/custom-field-multiselect.tsx`) so a currency picklist reads `"£500.00"` not `"500"`. All value-editor sites (Employment page, add/edit/bulk-edit dialogs) preflight on `input_mode` before falling into the free-form type chain, via the shared `CustomFieldMultiSelect` + `CustomFieldSingleSelect` components. Options list on the definition is stored as `text[]`; the manager's OptionsEditor is type-aware (number input for number options, date picker for date options, etc.).
- `/settings/profiles/{rights,working-pattern,notice-period,approver,holiday}` — five profile types under one umbrella. List + popup CRUD pattern. Each sub-route has a Live/Seed-only explainer banner at the top (`profile-explainer.tsx`). Owner only.
- `/settings/groups` — `TeamsManager` with per-row auto-save (rename on Enter/blur, approver + min cover on change). Optimistic with revert-on-failure.
- `/settings/backups` — wraps `BackupsManager` (owner only).

**Parallel period.** The legacy `OrganisationEditDialog` is still wired up via the sidebar "Organisation" button alongside the new Settings link. The dialog stays the source of truth until each section has been verified, then dialog + trigger + the six `organisation-edit-dialog-*` files get deleted in a follow-up commit.

**Profiles mental model.** The five profile types share a UI pattern + mental model — "profiles are sets of rules that determine how the software treats a member" — not a schema. Each type CRUDs its own underlying tables; the Phase 3 cascade (Org → Team → Member) is the separate piece that gives them a uniform resolution layer.

**Profile list ordering.** Each profile table (`work_profiles`, `notice_period_profiles`, `approval_profiles`, `rights_profiles`, and the vestigial `admin_profiles` / `employee_profiles`) carries a `sort_order int NOT NULL DEFAULT 0` that admins control by drag-reordering the row. Read queries order by `(is_default desc,)? sort_order asc, name asc` — Default profiles where present are pinned at sort_order 0 by convention and non-default rows occupy 1+. Each `create…` action assigns `sort_order = max + 1` so new profiles append. Each profile list has a matching `reorder…(orderedIds)` action that the list client calls after a drag; the shared `useListReorder` hook (`settings/profiles/use-list-reorder.ts`) holds the optimistic state + revert-on-failure logic. Reorder skips Default profiles (`canDrag: (p) => !p.isDefault`).

**Profile copy.** Every Profile list row has a Copy icon that opens the New-profile editor in template mode: existing values pre-populated, name suffixed with " (Copy)", save creates a fresh row. Implementation: each list client carries a `copyFrom` state alongside `editing`; the editor accepts an optional `template` prop and its seed `useEffect` prefers `editing → template → defaults`. The Copy never marks the new profile as Default (the source's `is_default` is ignored).

**Holiday Profiles (CLE-194 Phase 2) is live.** `holiday_profiles` is a real entity with one Default per org (undeleteable, auto-seeded on org insert), `members.holiday_profile_id` (auto-assigned on member insert), and the cog UI on `/members/[memberId]/holiday` is gone. See the schema section above for full details.

**Notice Period (CLE-194) is multi-profile.** Each org has a `notice_period_profiles` row per profile (one `is_default`, undeleteable; others freely created and removed). Each member points at exactly one profile via `members.notice_period_profile_id`, auto-seeded on insert by `trigger_assign_notice_profile`. `notice_period_rules` are scoped by `profile_id` not org. The notice block-or-warn flag lives on the profile (`notice_period_profiles.block_requests`); `organisations.notice_rules_block_requests` is kept as a deprecated mirror of the Default profile's flag during the parallel period with the legacy `OrganisationEditDialog` Notice Periods tab. The Notice booking-time reads (`validateBookingRules`, both mobile API routes, `getMyOrgNoticeContext`) resolve the booking author's profile and read rules + flag from there, falling back to the org's Default if the column is NULL.

**Cover (CLE-194) has its own per-team block flag.** Cover and Notice were previously governed by the same org-level `notice_rules_block_requests` flag; the split puts Notice on the profile and Cover on the team. `teams.block_cover_violations` is the source of truth — `validateBookingRules` reads it for the per-day cover check, `getMyTeamCoverContext` returns it as `blockCover` (NOT `blockRequests`), and the mobile `team-cover-context` route mirrors that shape. The Teams manager in `/settings/groups` exposes a per-row Block-on-Cover Switch with optimistic update + revert-on-failure. The two flags are independent — admins can block on Notice + warn on Cover, warn on Notice + block on Cover, both, or neither.

## UI Conventions
- **Row editing:** Never use a pencil/edit icon button on list rows. Make the entire row clickable to open edit mode (`cursor-pointer hover:bg-muted/50 onClick={() => startEdit(...)}`). Only action buttons that are destructive (delete) or independent (drag handle) should remain as separate icons with `e.stopPropagation()`. The choice of modal vs page for the edit target is decided per screen based on complexity — do not default to inline editing.
- **Inline-cell editing in tables:** When a table is essentially a spreadsheet of editable scalars (e.g. the Holiday Periods table on the employee Holiday page), edit the cells inline rather than via a slide-out form — the slide-out duplicates the column layout and gets confused with adjacent settings forms (cog, defaults). Pattern (see `members/[memberId]/holiday/employee-holiday-client.tsx`): track a single `editing: { rowId, field } | null` plus a string `draft`; click a cell → `startEdit(row, field)`; render `<input>`/`<select>` only for the matching cell; **Enter** blurs and commits, **blur** commits, **Escape** cancels; commit calls the row's full update server action with the current row + the changed field. Critical implementation detail — define the cell components (`TextCell`, `DateCell`, `SelectCell`) at module top-level and pass the inline-edit state bundle as a prop. Defining them inside the parent function recreates their identity each render, which makes React unmount the input on every keystroke and drop focus. Native `<select>` cells should commit immediately on `onChange` (with the new value passed as a `valueOverride`) since picking an option closes the dropdown. Locked rows render the cells as static text (no edit affordance). **Cell-width stability:** wrap the input/select in a `relative` container alongside an `aria-hidden invisible` ghost span carrying the at-rest display text — the ghost dictates the cell's natural width and the editor sits on top via `absolute inset-0`, so clicking a cell does not widen the column. Use `size={1}` and `min-w-0` on the input to neutralise its default ~20-char intrinsic width; padding/font-size on the ghost must match the editor for the widths to line up exactly.
- **Boolean values in tables:** Never display "Yes" or "No" text for boolean columns. Use Lucide icons instead: `<Check className="h-5 w-5 text-green-500" />` for true, `<X className="h-5 w-5 text-red-500" />` for false. Icons should be sized to fill approximately 50% of the row height.
- **Date filters:** Date and datetime columns use a preset dropdown ordered Last/This/Next per period (Last Week, This Week, Next Week, Last Month, This Month, Next Month, Last Year, This Year, Next Year, Custom range...) rather than raw date pickers. "Custom range..." reveals From/To date inputs. Filter value shape: `{ preset?: string; from?: string; to?: string }`. The `getDateRange(preset)` helper in `employees-client.tsx` resolves presets to `{ from, to }` ISO date strings. Applies to `last_log_in` and all `date`-type custom field columns.
- **Dialogs and Sheets — Scrollable body:** Any Dialog or Sheet that contains a form must use a scrollable body layout to ensure the header and footer buttons remain visible at all screen heights. The header (title) sits outside the scrollable area. Form fields are wrapped in `overflow-y-auto max-h-[60vh]`. The footer (Save/Cancel buttons) sits outside the scrollable area. Structure: `<DialogHeader>...</DialogHeader>` then `<div className="overflow-y-auto max-h-[60vh] px-1">` containing all form fields, then `<DialogFooter>...</DialogFooter>`. This applies to ALL dialogs and sheets with forms, regardless of how few fields they currently have — forms grow over time.
- **Date/time formatting:** Use `toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })` for human-facing date+time. UK locale, 24-hour clock. Do not pull in `date-fns` just for formatting.
- **Signed-URL images:** Document/photo viewers that load a signed URL must use a plain `<img>` (with an `// eslint-disable-next-line @next/next/no-img-element` comment), not `next/image`. `next/image` cannot proxy signed URLs that change per request and will fail on configured-domain checks.
- **`DataGrid` renderMode — table vs cards (CLE-194):** `<DataGrid renderMode="cards" renderCard={...} />` swaps the table body for a responsive grid of cards while sharing the *same* TanStack Table instance as the list view — so sort, filter, column customise, pagination, PDF/CSV export and selection state carry across without divergence. In cards mode the per-column table header + filter row are hidden and the DataGrid toolbar sprouts two extra controls: a **Sort** popover (Select of sortable columns + Ascending/Descending toggle) and a **Filters** popover (each column's `meta.filterElement` stacked vertically). The caller supplies `renderCard(row, visibleColumnIds)` — `visibleColumnIds` mirrors the Customise selection so the card body shows the same fields the user has picked. Grouping is preserved: when `groupBy` is set, cards mode emits a section header per group above its card grid. `leadingColumnIds` (the checkbox column) is table-only — in cards mode the selection checkbox lives inside the card renderer itself. Employees Directory (`employees-client.tsx`) is the reference consumer: view toggle flips `renderMode` between `"cards"` and `"table"`, `renderEmployeeCard` uses `formatMemberForPdf` for label/value pairs so cards stay in lockstep with list cell display.
- **Bulk-selection in `DataGrid` (`@/components/data-grid/data-grid`):** the parent owns the selection state (typically `selectedIds: Set<string>`) and supplies a `select` column via `leadingColumnIds={["select"]}` plus a column-def with header + per-row checkboxes. For group-level select-all (when `groupBy` is set), pass `renderGroupHeaderPrefix={({ rowsInGroup, groupValue }) => ...}` to render a tri-state checkbox at the leading edge of each group header. The renderer receives the **full filtered set** of rows in the group (not just the visible page) so the checkbox toggles every member of the group at once. Use additive/subtractive helpers (e.g. `handleSetSelected(ids, selected: boolean)`) so toggling one group doesn't discard selections in others.
- **Sticky page header on every list page:** wrap the title in `<StickyPageHeader>` from `@/components/ui/sticky-page-header`, and put **every persistent control the user might want while the data scrolls** inside it — title, tabs, filter inputs, action buttons, secondary action rows, week-navigation, etc. The principle is that all controls stay fixed and only the rows of data scroll. If a control belongs with the page (not a row), it goes in the sticky band. The component is server-component safe and assumes the parent uses the standard `px-4 sm:px-6 lg:px-8` outer padding so its negative margins extend the band full-bleed.
- **Tabs in the sticky header:** when a page uses `<Tabs>`, place the `<Tabs>` wrapper around both `<StickyPageHeader>` and the `<TabsContent>`s, then put the `<TabsList>` inside `<StickyPageHeader>`. The Tabs context spans both so triggers stay sticky while content scrolls.
- **Sticky table-header on `DataGrid` pages:** when a page uses `<DataGrid>` AND has `<StickyPageHeader>`, also pass `stickyHeader` to `DataGrid` so its toolbar, column-header row and filter row stack into the same sticky group. `<StickyPageHeader>` measures itself via `ResizeObserver` and publishes its height on the root as the `--page-header-height` CSS variable; `<DataGrid stickyHeader />` reads that var to auto-pin its toolbar directly beneath — no gap, no overlap, regardless of what the caller puts inside the band. Downstream offsets: toolbar height is 56 (`pt-2` + `h-8` button + `pb-4`), column header pins at `toolbarTop + 56`, filter row at `toolbarTop + 95` (column header `h-10 = 40` more, minus 1 to overlap the tr border-b hairline). Pages that don't use `<StickyPageHeader>` (or need to override) can pass a numeric `stickyHeaderTop` prop — that pins the toolbar at that exact px distance from the viewport top, with the same +56/+95 offsets for the two rows below. The two reports pages that currently pass explicit `stickyHeaderTop={160|240}` predate the auto-measure path; they can safely be migrated to bare `stickyHeader` once verified.

## Rights Profiles v2 (CLE-195 → CLE-199)

Every access decision reads through `src/lib/rights-resolver.ts`, which resolves the caller's `members.rights_profile_id` into an `EffectiveRights` object. Types + runtime constants live separately in `src/lib/rights-types.ts` so client bundles can import them without pulling in the server-only resolver dependencies (the `next/headers` / service-role client chain).

### Model shape

- **`rights_profiles`** — one row per named profile per org. Carries:
  - `name`, `sort_order`, `is_default` (seeded rows only)
  - `cross_user_access` — `self | team | all`
  - Fourteen non-tab action booleans (`can_create_users`, `can_invite_users`, `can_delete_users`, `can_approve_holidays`, `can_override_holiday_rules`, `can_run_reports`, `can_run_admin_reports`, `can_manage_teams`, `can_edit_org_settings`, `can_edit_rights_profiles`, `can_manage_billing`, `can_view_audit_logs`, `can_view_sensitive_fields`, `can_edit_sensitive_fields`)
  - `tab_matrix jsonb` — per-tab `{ view, update }` for the ten tabs enumerated in `TAB_KEYS` (planner, timesheet, dashboard, holiday, employment, personal, contacts, documents, expenses, history)
  - `rank` — vestigial metadata (CLE-197 flattened the UI; users never see rank). Retained because the seed defaults + guard triggers + a few `rank !== "employee"` display checks still key on it. CLE-201 will remove it.
- **`members.rights_profile_id`** — the pointer. Every member has exactly one profile. `NULL` is an error state (the app treats it as read-only-only-self as a defensive fallback).
- **`members.is_billing_contact`** — one member per org holds this flag (partial unique index enforces exactly-one). Freely transferable via Settings → Organisation → Billing contact card.

### Resolver API

- `getEffectiveRightsForUser(userId): Promise<{ rights, ctx } | null>` — the primary read. Used by every server component and server action for gating.
- `getEffectiveRights(memberId): Promise<EffectiveRights | null>` — for cross-user checks (e.g. resolving another member's profile to render their rights summary).
- `getRightsEditorCount(orgId): Promise<number>` — drives the warning banner (CLE-199). Counts members whose profile has `can_edit_rights_profiles = true`.
- `canActOn(actor, actorCtx, target)` — rank + scope check for cross-user actions; returns `{ view, update, delete, assignProfile }`.
- `resolveTab(rights, tabKey)` — safe accessor for the tab matrix with `{ view: false, update: false }` fallback for missing keys.

### Seed defaults

Each new org gets four profiles seeded by the CLE-196a migration:
- **Admin** — everything on, scope=all
- **HR** — everything except billing/rights-profile-editing/admin-only reports, scope=all
- **Manager** — approve holidays + run reports + team view+update on Holiday/Employment/Personal, scope=team
- **Employee** — self-scope; can view+update their own Personal/Contacts/Holiday/Documents

These aren't hierarchical any more (post-CLE-197). All four are peer-level profiles from the user's perspective; the `is_default = true` flag prevents deletion of any of the four but doesn't grant them special semantics.

### Guard triggers

Two DB triggers enforce bus-factor invariants at the row level:
- **`ensure_at_least_two_rights_editors_on_member`** (BEFORE UPDATE/DELETE on `members`) — blocks any operation that would drop the count of `can_edit_rights_profiles = true` members from ≥2 to <2. Deliberately doesn't block operations when the count is already below 2 (so Chris on his 1-editor tenant isn't frozen). The invariant activates once he promotes a second.
- **`ensure_at_least_two_rights_editors_on_profile`** (BEFORE UPDATE on `rights_profiles`) — mirrors the above for the case where an admin turns off `can_edit_rights_profiles` on a profile that has assigned members.

Both raise `check_violation` with a friendly message the app surfaces via the `<UserRightsPicker>` inline error.

### Warning banner (CLE-199)

`(dashboard)/layout.tsx` computes `getRightsEditorCount(orgId)` on every render for viewers whose profile grants `can_edit_rights_profiles`. Red banner when count ≤ 1, amber when > 5. Uses the same `--top-chrome-extra` CSS variable pattern as the trial banner so downstream sticky elements shift correctly.

### Sensitive fields

See the **Sensitive fields (CLE-198)** section below.

### UI surfaces

- **Settings → User Rights** (`/settings/rights-profiles`) — profile list + editor. Rank is hidden from the UI; drag-reorder via the `useListReorder` hook; Copy duplicates a profile with " (Copy)" suffix.
- **Settings → User Rights → Compare** (`/settings/rights-profiles/compare`) — all profiles as columns, all rights as rows, sticky first column, "Only show rows where Profiles differ" toggle.
- **Settings → User Rights → Per-member lookup** (`/settings/rights-profiles/lookup`) — member picker + plain-English rights summary generated in-browser, copyable for support tickets.
- **Employment page → User Rights card** — per-member profile picker at the bottom of `/members/[memberId]/employment`. Read-only for viewers without `canEditRightsProfiles`; select-with-live-update for those with it.
- **Header** — the `HeaderUserMenu` shows the profile name (falling back to the memberLabel-based rank name for unassigned members).
- **Employees Directory** — the `user_rights` column shows each member's profile name.

### Residual legacy (CLE-201 will remove)

The CLE-196 cutover intentionally stopped short of dropping the old plumbing so we didn't need to rewrite every RLS helper in one go. Known residual pieces:

- `members.role`, `members.permissions`, `members.admin_profile_id`, `members.employee_profile_id` — columns kept because the SECURITY DEFINER RLS helpers (`get_user_role`, `get_user_permission`, `get_org_members`) still read them.
- `admin_profiles` / `employee_profiles` tables — kept because the Edit Employee / Employment form / Bulk Edit sheet still surface Admin/Employee Profile pickers backed by them. Picks have **no security effect** (the resolver ignores them) but the UI still lets users set them.
- `src/lib/rights-config.ts` and `src/app/(dashboard)/employees/profile-actions.ts` — kept because the pickers above still import them.
- `src/app/(dashboard)/settings/profiles/rights/rights-profiles-client.tsx` — stubbed to `export {}` and unreachable. Chris to delete from Windows Explorer when convenient.
- A handful of `rank !== "employee"` display checks in the proxy, sidebar and dashboard shell — see the follow-up work list in CLE-201.

Under path B (chosen in CLE-196c), the resolver is authoritative for every security decision; the legacy columns exist but are ignored. Removing them requires rewriting the RLS helpers to source from `rights_profiles`, which is CLE-201's scope.

### File map

- `src/lib/rights-types.ts` — types + TAB_KEYS + rank helpers (client-safe)
- `src/lib/rights-resolver.ts` — resolver + guard + count helpers (server-only)
- `src/lib/sensitive-fields.ts` — sensitive-field enumeration + redaction helpers
- `src/app/(dashboard)/settings/rights-profiles/actions.ts` — profile CRUD + assignment actions
- `src/app/(dashboard)/settings/rights-profiles/rights-profiles-client.tsx` — profile list + editor UI
- `src/app/(dashboard)/settings/rights-profiles/compare/` — Compare view
- `src/app/(dashboard)/settings/rights-profiles/lookup/` — Per-member lookup
- `src/app/(dashboard)/settings/organisation/billing-contact-actions.ts` — billing contact transfer
- `src/app/(dashboard)/settings/organisation/billing-contact-card.tsx` — billing contact UI
- `src/app/(dashboard)/members/[memberId]/employment/user-rights-picker.tsx` — per-member profile picker
- `supabase/migrations/20260826000001_rights_profiles_v2_foundation.sql` — schema + seed
- `supabase/migrations/20260826000002_rights_editors_guard.sql` — bus-factor triggers

### Recovery process (out-of-band)

If an org is locked out (no rights-editor available), ClearHR support intervenes manually:
1. Verified inbound request from the org's official domain
2. Support verifies identity through the emergency-successor contact if set, or via existing billing records
3. Support uses service-role to reassign a member to the Admin default profile
4. Recovery is logged in the audit trail with `action = "support.rights_recovery"`

The "Emergency successor" Settings field (name + email) is a proposed but not-yet-built follow-up — see CLE-200 out-of-scope notes.

## Sensitive fields (CLE-198)

Two sources feed "is this field sensitive?":

1. **`SENSITIVE_MEMBER_FIELDS`** in `src/lib/sensitive-fields.ts` — a hardcoded set of built-in `members` column names classed as GDPR-sensitive (`date_of_birth`, `ni_number`, `bank_account_number`, `bank_sort_code`, `home_address_*`, `home_phone`, `mobile_phone`, `next_of_kin*`, `pay_rate`, `salary`, `passport_number`, `driving_licence_number`). None of these columns exist on `members` yet — the enumeration is forward-looking, so redaction kicks in automatically when they land.
2. **`custom_field_definitions.is_sensitive`** — per-field opt-in admins toggle in Settings → Custom Fields via the "Sensitive" switch. Sensitive custom-field rows display a shield icon in the Custom Fields manager.

**Two profile switches** on `rights_profiles` (already added in CLE-196a):
- `can_view_sensitive_fields` — when false, sensitive-field values render as `•••`.
- `can_edit_sensitive_fields` — when false, sensitive-field inputs are read-only (or hidden entirely when `can_view_sensitive_fields` is also false).

**Redaction is applied at every render site:**
- Employees Directory grid — `employee-columns.tsx` `buildEmployeeColumns` takes `canViewSensitiveFields`; sensitive cells render `•••` while sort/filter continue to work on the underlying values.
- Card view — `renderEmployeeCard` in `employees-client.tsx` uses `formatMemberForPdf`, which redacts when `canViewSensitiveFields = false`.
- PDF/CSV export — same `formatMemberForPdf` path; sensitive columns emit `•••` in the row and blank the `_raw_cf_*` scalar so aggregate footers don't leak underlying numbers.
- Employment form — `employment-form.tsx` renders sensitive inputs disabled when `canEditSensitiveFields = false`, hidden with a `•••` placeholder when `canViewSensitiveFields = false`. Labels show a `(sensitive)` badge.

**Audit is always-on for sensitive writes.** `saveCustomFieldValues` diffs the incoming values against the existing JSONB and writes an audit_log row with `action = "member.sensitive_fields.updated"`, `metadata.is_sensitive = true`, and `changes` populated with the sensitive-only diff. This happens regardless of `can_edit_sensitive_fields` — the profile flag gates *whether* the write is permitted; when it happens, it's always recorded.

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

## Schema change discipline

Silent bugs from missed schema updates are a security concern in their own right — a page returning stale or incomplete data can leak or misrepresent org state. **When adding, renaming, or dropping a column on any table, follow this checklist:**

1. **Grep every `.from("<table>")` fetch site** and read its SELECT list. Update every one to include the new column. Missing this is exactly how a schema change that "worked in the manager" ends up silently broken on downstream pages — the SELECT returns rows without the new column, TypeScript widens `undefined` through inline casts, and the UI falls through to a wrong-but-not-erroring render.
2. **Grep for anonymous inline type casts** referring to that table's columns (`as { … field_type … }` and similar). Update each cast to include the new column, or — better — replace it with the canonical exported type from the actions file.
3. **Update the canonical exported type** in the actions/types file (`FieldDef`, `HolidayBookingRow`, etc.) so downstream consumers get compile-time coverage.
4. **Write the migration.** Prefer `add column if not exists` + a NOT NULL DEFAULT so applying twice is safe, and include any backfill of existing rows so the new column is meaningful on legacy data. Never mutate the schema of a live table in a way that requires application code to already be deployed — write the migration to be forward-compatible with the old code, deploy the code, then apply the migration.
5. **Re-grep `.from("<table>")` one final time** as a post-check. If any hit doesn't select the new column, either update it or add a comment explaining why (usually there isn't a good reason).

**Anti-pattern to flag on sight — anonymous type casts on Supabase fetches.** Inline `as { … }` casts on a `.from(...).select(...)` result silently swallow schema changes: the cast type doesn't include the new column, TypeScript treats it as `undefined`, and any consumer checking `x === 'something'` fails without a compiler warning. When you touch code that does this, convert it to import and cast to the canonical exported type instead. New fetch sites should always use canonical types.

**Ordering of the migration file matters.** In a single migration, `ALTER TABLE … ADD COLUMN` runs before `UPDATE` backfills. Chain the CHECK constraint after the ADD COLUMN so the default value satisfies it. If you're adding a column with a CHECK constraint and no default, add the default first, backfill, then re-add the constraint without the default. Verify the migration applies cleanly to a database that already has real data — not just a fresh one.

## Commands
- `npm run dev` — Start dev server
- `npm run build` — Production build
- `npm run lint` — ESLint
