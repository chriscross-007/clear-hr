# Clear-HR: Holiday Management — Software Design Document

## Overview

Holiday management for ClearHR allows organisations to configure and manage employee time off. The system is designed to be flexible: organisations choose how holidays are measured, how they're allocated, and whether employees request approval, book directly or an Admin can book directly. Bank Holidays can be added to the Personal Allowance or booked automatically.

This document is a living spec. Sections are filled in as features are designed and built. Status markers: [ ] planned, [~] in progress, [x] done.


---

## Glossary

| Term | Definition |
|------|-----------|
| **Absence Reason** | The reason for taking an absence. E.g. ‘Running a temperature’ |
| **Absence Type** | A grouping for Absence Reasons (e.g. Annual Leave, Sick, Compassionate, TOIL). Each may have its own entitlement and rules. |
| **Allowance** | Synonym for entitlement — used interchangeably. |
| **Entitlement** | The total amount of holiday an employee is allocated for a given period (e.g. 25 days per year). |
| **Accrual** | Entitlement that accumulates gradually over time (e.g. monthly) rather than being available upfront. |
| **Carry-over** | Unused holiday from one period that transfers into the next. May be capped or time-limited. |
| **Borrow-Ahead**| Amount of holiday that can be taken from next period’s allowance |
| **Fixed** | A set allowance for the whole period|
| **Flexible** | Allowance varies depending on working pattern|
| **Holiday year** | The period over which entitlement is measured. Typically a year Jan–Dec or Apr–Mar, configurable per org. |
| **Request** | An employee asks for time off; an approver must accept or reject it before it's confirmed. |
| **Booking** | An employee books time off directly without approval (self-service). |
| **Approver** | A member (typically admin or team lead) with `can_approve_holidays` permission who can accept/reject requests. |
| **TOIL** | Time Off In Lieu — compensatory time off earned by working extra hours. |
| **Bank holiday** | A public/national holiday. May or may not be deducted from entitlement depending on org config. |
| **Working pattern** | Which days of the week an employee works (e.g. Mon–Fri, or Mon/Wed/Fri). Affects how "days" are counted. |
| **Half day** | A partial-day absence (AM or PM). |
| **Overlap** | Two approved absences for the same employee on the same date — typically blocked. |

---

## Holiday Profiles

These are org-level settings that shape how an employee’s holiday rules are enforced. Different Holiday Profiles can be applied for the same employee in different Periods. Each dimension is independent. Employees can move from one profile to another. For the Minimum Viable Product this change will be handled manually. Subsequently, tools will be developed to make the change automatic (with oversight).


### Measurement: Days vs Hours

| Setting | Days mode | Hours mode |
|---------|-----------|------------|
| Entitlement expressed as | 25 days | 200 hours |
| Booking granularity | Full day / half day (AM/PM) | Hours and minutes (e.g. 2h 30m) |
| Deduction from balance | 1 day or 0.5 day | Actual hours booked |
| Working pattern relevance | Determines which days count | Determines daily hour capacity |
| Display in calendar | Day blocks | Time ranges |


### Allocation: Fixed vs Flexible (Accrual)

| Setting | Fixed | Fixed Accrual |
|---------|-------|---------------------|
| Entitlement available | Full amount from day one of the holiday year | Builds up over time (e.g. 1/12th per month) |
| New starter mid-year | Pro-rated based on start date | Accrues naturally from start date |
| Visibility to employee | "You have 25 days this year" | "You have accrued 12.5 of 25 days so far" |
| Overbooking risk | Low — balance known upfront | Employee could request more than accrued |

### Workflow: Request vs Book

| Setting | Request (approval required) | Book (self-service) |
|---------|----------------------------|---------------------|
| Employee action | Submits a request | Confirms a booking directly |
| Approval step | Approver accepts or rejects | None — booking is immediate |
| Status flow | Pending > Approved / Rejected | Confirmed |
| Notifications | Approver notified on submit; employee notified on decision | Approver/team notified after booking |
| Cancellation | Employee can cancel pending; approved may need re-approval | Employee can cancel freely (within policy) |

Workflow can be set per leave type (e.g. Annual Leave requires approval, TOIL is self-service)?

### Carry-over

| Setting | Options |
|---------|---------|
| Allowed | Yes / No |
| Cap | Unlimited / Fixed max (e.g. 5 days) |
| Expiry | None / Use-by date (e.g. "carried days expire 31 March") |
| Applies to | Holiday Profile |

### Borrow-ahead

| Setting | Options |
|---------|---------|
| Allowed | Yes / No |
| Cap | Fixed max (e.g. 5 days) default = 0 |
| Applies to | Holiday Profile |


### Bank Holidays

| Setting | Options |
|---------|---------|
| Handling | Deducted from entitlement / Additional (on top of entitlement) / Not tracked |
| Calendar | Org selects which country's bank holidays apply |
| Override | Org can add/remove specific dates from the bank holiday list |

---

## Features

### Org Settings & Configuration

- [ ] Holiday year start month (default: January)
- [ ] Measurement mode: days or hours
- [ ] Allocation mode: fixed or accrual
- [ ] Default workflow: request or book
- [ ] Carry-over rules (allowed, cap, expiry)
- [ ] Bank holiday country selection
- [ ] Custom bank holiday overrides

### Leave Types

- [ ] Default leave types created on org setup (Annual Leave, Sick, Compassionate)
- [ ] Custom leave types (org can add/edit/delete)
- [ ] Per-type settings: paid/unpaid, deducts from entitlement, requires approval, colour
- [ ] Per-type entitlement (e.g. 25 days Annual, 10 days Sick)

### Entitlements

- [ ] Org-wide default entitlement per leave type
- [ ] Per-employee entitlement override
- [ ] Pro-rating for mid-year starters/leavers
- [ ] Accrual calculation (monthly/weekly)
- [ ] Carry-over calculation at year-end
- [ ] Entitlement adjustments (manual add/subtract with reason)

### Working Patterns

- [ ] Org-wide default working pattern (e.g. Mon–Fri)
- [ ] Per-employee working pattern override
- [ ] Part-time patterns (e.g. Mon/Wed/Fri)
- [ ] Hours per day (for hours-mode orgs)
- [ ] Working pattern history (changed mid-year — affects pro-rating)

### Requesting / Booking

- [ ] Employee submits holiday request (date range, leave type, optional note)
- [ ] Half-day selection (AM/PM) in days mode
- [ ] Hours/time selection in hours mode
- [ ] Balance check before submission (warn or block if insufficient)
- [ ] Overlap detection (block or warn if employee already has leave on those dates)
- [ ] Team overlap warning (show who else is off — not blocking, informational)
- [ ] Self-service booking (when workflow = book)

### Approval

- [ ] Approver sees pending requests (filtered to their scope — team or all)
- [ ] Approve / Reject with optional note
- [ ] Bulk approve
- [ ] Approval delegation (cover for absent approver)
- [ ] Escalation (auto-remind or escalate if not actioned within N days)

### Cancellation

- [ ] Employee cancels pending request
- [ ] Employee cancels approved holiday (may need re-approval depending on policy)
- [ ] Admin/owner cancels on behalf of employee
- [ ] Cancelled days returned to balance

### Calendar & Visibility

- [ ] Employee sees their own holiday calendar
- [ ] Team calendar (who's off when — based on permissions)
- [ ] Org-wide calendar (owners/admins)
- [ ] Bank holidays shown on calendar
- [ ] Colour-coded by leave type

### Balances & Reporting

- [ ] Employee dashboard: entitlement, used, remaining, pending
- [ ] Admin dashboard: team balances at a glance
- [ ] Holiday report (filterable by team, date range, leave type)
- [ ] Export to CSV
- [ ] Integration with existing ClearHR reports system

### Notifications

- [ ] Employee notified: request approved/rejected, upcoming holiday reminder
- [ ] Approver notified: new request pending
- [ ] Team notified: colleague's holiday confirmed (optional)
- [ ] Push notifications (mobile app)
- [ ] Email notifications

### Mobile App

- [ ] View own balances and upcoming holidays
- [ ] Submit holiday request
- [ ] Cancel holiday
- [ ] Approver: view and action pending requests (if admin)
- [ ] Push notification support

---

## Database Schema

_To be populated as tables are created. Below is an initial sketch._

### Tables (planned)

**`leave_types`** — Configurable absence categories per org.
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| organisation_id | uuid | FK to organisations |
| name | text | e.g. "Annual Leave" |
| colour | text | Hex colour for calendar |
| is_paid | boolean | |
| deducts_from_entitlement | boolean | Sick leave may not deduct |
| requires_approval | boolean | Per-type workflow override |
| is_default | boolean | System-created, non-deletable |
| sort_order | int | Display ordering |
| timestamps | | |

**`holiday_settings`** — Org-wide holiday configuration (one row per org).
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| organisation_id | uuid | FK, unique |
| year_start_month | int | 1–12 (default 1 = January) |
| measurement_mode | text | 'days' or 'hours' |
| allocation_mode | text | 'fixed' or 'accrual' |
| default_workflow | text | 'request' or 'book' |
| carry_over_allowed | boolean | |
| carry_over_cap | numeric | null = unlimited |
| carry_over_expiry_months | int | Months into new year before carried days expire |
| bank_holiday_country | text | ISO country code |
| bank_holiday_handling | text | 'deducted', 'additional', 'not_tracked' |
| timestamps | | |

**`entitlements`** — Per-employee, per-leave-type, per-year allocation.
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| organisation_id | uuid | FK |
| member_id | uuid | FK to members |
| leave_type_id | uuid | FK to leave_types |
| year_start | date | Start of the holiday year this covers |
| base_amount | numeric | Org default or employee override (days or hours) |
| adjustment | numeric | Manual add/subtract (default 0) |
| carried_over | numeric | From previous year |
| pro_rata_amount | numeric | Calculated effective entitlement after pro-rating |
| timestamps | | |

**`working_patterns`** — Employee working schedules.
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| organisation_id | uuid | FK |
| member_id | uuid | FK to members (null = org default) |
| effective_from | date | When this pattern starts |
| mon–sun | boolean x7 | Which days are worked |
| hours_per_day | numeric | For hours-mode orgs |
| timestamps | | |

**`holiday_bookings`** — Individual absence records.
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| organisation_id | uuid | FK |
| member_id | uuid | FK to members |
| leave_type_id | uuid | FK to leave_types |
| start_date | date | |
| end_date | date | |
| start_half | text | null, 'am', 'pm' (days mode) |
| end_half | text | null, 'am', 'pm' (days mode) |
| hours | numeric | Total hours (hours mode) |
| days_deducted | numeric | Calculated days/hours deducted from balance |
| status | text | 'pending', 'approved', 'rejected', 'cancelled' |
| note | text | Employee's note |
| approver_id | uuid | FK to members (who approved/rejected) |
| approver_note | text | |
| actioned_at | timestamptz | When approved/rejected |
| timestamps | | |

**`bank_holidays`** — Country-specific public holidays + org overrides.
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| country_code | text | ISO code |
| organisation_id | uuid | Null = system-wide, non-null = org override |
| date | date | |
| name | text | e.g. "Christmas Day" |
| is_excluded | boolean | Org removed this date from their list |

### RLS Notes

- Employees: read own bookings and entitlements only. Create bookings (subject to balance/overlap checks in server action). Cannot approve.
- Admins: read bookings for their team (or all, per `can_view_all_teams`). Approve/reject if `can_approve_holidays`.
- Owners: full read/write across org.
- All write operations through server actions with permission checks.

---

## Business Rules

_To be documented as logic is implemented._

### Balance Calculation
```
effective_entitlement = pro_rata_amount + adjustment + carried_over
used = sum(days_deducted) WHERE status IN ('approved', 'pending')
remaining = effective_entitlement - used
```
**Note:** Pending requests count against balance to prevent overbooking.

### Pro-rating (mid-year starters)
```
months_remaining = months from start_date to year_end
pro_rata = base_amount * (months_remaining / 12)
```
Rounding: round to nearest 0.5 (configurable?).

### Overlap Detection
- Same employee, overlapping dates, status not 'cancelled' or 'rejected' → block.
- Same team, overlapping dates → warn (informational, not blocking).

### Day Counting (days mode)
- Only count days in the employee's working pattern.
- Half days count as 0.5.
- Bank holidays within the range: skip if `bank_holiday_handling = 'additional'`, count if `'deducted'`.

### Accrual Calculation
```
monthly_accrual = base_amount / 12
accrued_to_date = monthly_accrual * months_elapsed
```
Accrual date: 1st of each month, or pro-rated for mid-month starters.

---

## UI Notes

_To be documented as screens are built._

### Planned Screens

- **Employee holiday dashboard** — balance summary, upcoming bookings, "Request holiday" button
- **Request/book form** — date picker, leave type selector, half-day toggles, balance indicator
- **Approval queue** — list of pending requests for approver, approve/reject actions
- **Team calendar** — visual calendar showing who's off (colour-coded by leave type)
- **Admin: holiday settings** — org-wide config (measurement, allocation, workflow, carry-over, bank holidays)
- **Admin: entitlements** — table of employees with their entitlements, adjustments, balances
- **Mobile: holiday tab** — balance, upcoming, request

---

## Open Questions

1. Can an org switch between days/hours mode after initial setup, or is it locked? If switchable, how do we migrate existing bookings?
2. Allow booking against future accrual (borrow ahead)?
3. Should the approval workflow be configurable per leave type, or is it org-wide only?
4. How granular should hours-mode bookings be? 15-min increments? Free-form?
5. Should TOIL be a leave type with special accrual rules, or a separate system?
6. Notification channels: email only to start, or push from day one?
7. Should bank holiday data be bundled in the app or fetched from an external API?
8. Minimum/maximum booking length rules (e.g. "must book at least 1 day", "max 10 consecutive days without director approval")?
9. Who can see balances? Just the employee and their approver, or all admins?
10. Should cancelled approved holidays require re-approval, or just return the days immediately?
