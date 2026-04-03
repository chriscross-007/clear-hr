# ClearHR - Project Guide

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

### Server Actions
- Server actions that modify other users' data use a service role client (bypasses RLS)
- The service role client is created with `SUPABASE_SERVICE_ROLE_KEY` (server-only, never `NEXT_PUBLIC_`)
- Always verify caller permissions in the action before using the admin client
- `addEmployee()` — creates a `members` record only (no auth user). Employee has `user_id = NULL` until they accept the invite.
- `sendInvite(memberId)` — sends invite email via Resend with a branded link to `/accept-invite?token=xxx`. Sets `invited_at`.
- `updateEmployee()` — updates names on `members`.
- `getInviteDetails(token)` — public (no auth required), returns email/name/orgName for the accept-invite page.

### Supabase
- Use MCP tool `mcp__supabase__search_docs` to look up current documentation before implementing unfamiliar patterns
- Browser client: `createClient()` from `@/lib/supabase/client`
- Server client: `createClient()` from `@/lib/supabase/server` (async, uses cookies)
- Admin client: `createClient(url, SERVICE_ROLE_KEY)` from `@supabase/supabase-js` (server actions only)
- Environment variables: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`

### Next.js 16
- Uses `proxy.ts` (not `middleware.ts`) with `export async function proxy()`
- The `middleware` export name is deprecated in Next.js 16

### Styling
- Use shadcn/ui components from `@/components/ui/`
- Use `cn()` from `@/lib/utils` for conditional class merging
- Tailwind v4 with CSS variables for theming (defined in globals.css)

## Database Schema

### Tables
- **`organisations`** — Fields: `id`, `name`, `slug` (unique), `member_label` (default "member"), timestamps.
- **`teams`** — Groups within an org. Fields: `id`, `organisation_id` (FK), `name`, timestamp.
- **`members`** — Core access control and member profile data (single source of truth). Fields: `id`, `organisation_id` (FK), `user_id` (FK, **nullable** — NULL until employee accepts invite), `email`, `first_name`, `last_name`, `known_as`, `avatar_url`, `team_id` (FK, nullable), `role` (owner/admin/employee), `permissions` (JSONB), `invite_token` (UUID, unique), `invited_at`, `accepted_at`, timestamps. Unique on (organisation_id, email). Partial unique on (organisation_id, user_id) WHERE user_id IS NOT NULL.
- **`superusers`** — Platform-level access. Fields: `id`, `user_id` (FK, unique), timestamp.

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

## Error Troubleshooting
**First response to ANY build/runtime error:**
```bash
rm -rf .next node_modules/.cache && npm run dev
```
Do NOT modify auth code to "fix" cache issues.

| Error | NOT the cause | Actual cause | Fix |
|-------|--------------|--------------|-----|
| HTTP 431 | Cookies, auth code | Corrupted .next cache | Clear cache |
| Turbopack panic | Your code | Cache corruption | Clear cache |
| Auth callback loops | Token handling | Missing `next` param | Add `?next=` to redirectTo |

## UI Conventions
- **Row editing:** Never use a pencil/edit icon button on list rows. Make the entire row clickable to open edit mode (`cursor-pointer hover:bg-muted/50 onClick={() => startEdit(...)}`). Only action buttons that are destructive (delete) or independent (drag handle) should remain as separate icons with `e.stopPropagation()`. The choice of modal vs page for the edit target is decided per screen based on complexity — do not default to inline editing.
- **Boolean values in tables:** Never display "Yes" or "No" text for boolean columns. Use Lucide icons instead: `<Check className="h-5 w-5 text-green-500" />` for true, `<X className="h-5 w-5 text-red-500" />` for false. Icons should be sized to fill approximately 50% of the row height.
- **Date filters:** Date and datetime columns use a preset dropdown ordered Last/This/Next per period (Last Week, This Week, Next Week, Last Month, This Month, Next Month, Last Year, This Year, Next Year, Custom range...) rather than raw date pickers. "Custom range..." reveals From/To date inputs. Filter value shape: `{ preset?: string; from?: string; to?: string }`. The `getDateRange(preset)` helper in `employees-client.tsx` resolves presets to `{ from, to }` ISO date strings. Applies to `last_log_in` and all `date`-type custom field columns.
- **Dialogs and Sheets — Scrollable body:** Any Dialog or Sheet that contains a form must use a scrollable body layout to ensure the header and footer buttons remain visible at all screen heights. The header (title) sits outside the scrollable area. Form fields are wrapped in `overflow-y-auto max-h-[60vh]`. The footer (Save/Cancel buttons) sits outside the scrollable area. Structure: `<DialogHeader>...</DialogHeader>` then `<div className="overflow-y-auto max-h-[60vh] px-1">` containing all form fields, then `<DialogFooter>...</DialogFooter>`. This applies to ALL dialogs and sheets with forms, regardless of how few fields they currently have — forms grow over time.

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
