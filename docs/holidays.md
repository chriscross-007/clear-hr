

Clear-HR: Holiday Management — Software Design Document
Overview
Holiday management for ClearHR allows organisations to configure and manage employee time off. The system is designed to be flexible: organisations choose how holidays are measured, how they're allocated, and whether employees request approval, book directly or an Admin can book directly. Bank Holidays can be added to the Personal Allowance or booked automatically.
This document is a living spec. Sections are filled in as features are designed and built. Status markers: [ ] planned, [~] in progress, [x] done.

Glossary
Term
Definition
Absence Reason
The reason for taking an absence. E.g. ‘Running a temperature’
Absence Type
A grouping for Absence Reasons e.g. ‘Sick Unpaid’
Allowance
Synonym for entitlement — used interchangeably.
Accrual
Entitlement that accumulates gradually over time (e.g. monthly) rather than being available upfront.
Borrow-Ahead
Amount of holiday that can be taken from next period’s allowance 
Carry-over
Unused holiday from one period that transfers into the next. May be capped or time-limited.
Entitlement
The total amount of holiday an employee is allocated for a given period (e.g. 25 days per year).
Flexible
Holidays are accrued depending on an employee’s previous work pattern
Holiday year
The period over which entitlement is measured. Typically Jan–Dec or Apr–Mar, configurable per org.
Request
An employee asks for time off; an approver must accept or reject it before it's confirmed.
Booking
Certain employees can book time off directly without approval (self-service).
Approver
A member (typically admin or team lead) with can_approve_holidays permission who can accept/reject requests.
TOIL
Time Off In Lieu — compensatory time off earned by working extra hours.
Bank holiday
A public/national holiday. Handled outside of Absence Booking
Black List
Dates when Holidays cannot be taken by default
White List
Dates when Holidays must be taken by default
Working pattern
Which days of the week an employee works (e.g. Mon–Fri, or Mon/Wed/Fri). Affects how "days" are counted.
Half day
A partial-day absence (AM or PM).
Overlap
Two approved absences for the same employee on the same date — typically blocked.
Profile
An Org can create an unlimited number of Holiday Profiles. Each Employee will be allocated to a Profile. Each Profile will determine such parameters as whether the Holidays are calculated in Days or Hours, Fixed or Flexible and Carry Over Rules.
Tracked
A property of an Absence Type that determines if absence reasons of this type have an Absence Profile with allowance, accrual and carry forward.


Holiday Profiles
These are org-level settings that shape how an employee’s holiday rules are enforced. Different Holiday Profiles can be applied for the same employee in different Periods. Each dimension is independent. Employees can move from one profile to another. For the Minimum Viable Product this change will be handled manually. Subsequently, tools will be developed to make the change automatic (with oversight).
Measurement: Days vs Hours
Setting
Days mode
Hours mode
Entitlement expressed as
25 days
200 hours
Booking granularity
Full day / half day (AM/PM)
Hours and minutes (e.g. 2h 30m)
Deduction from balance
1 day or 0.5 day
Actual hours booked
Working pattern relevance
Determines which days count
Determines daily hour capacity
Display in calendar
Day blocks
Time ranges

Allocation: Fixed vs Zero Hours
Setting
Fixed
Zero Hours
Entitlement available
Full amount from day one of the holiday year or accrued over time
Employees are allowed e.g. 5.6 weeks holiday a year. Hours per week depends on average hours worked
New starter mid-year
Pro-rated based on start date or Holiday Year starts at employee start date.
Accrues naturally from start date
Visibility to employee
"You have 25 days this year" or "You have accrued 12.5 of 25 days so far"
“You have accrued 47 hours (9 days) which are available to use”
Overbooking risk
Low — balance known upfront
Employee could request more than accrued

The Holiday Profile will determine whether to allow booking against future accrual (i.e. borrow ahead), or limit to accrued balance only. Default is to Limit.
Carry-over
Setting
Options
Allowed
Yes / No
Cap
Unlimited / Fixed max (e.g. 5 days)
Expiry
None / Use-by date (e.g. "carried days expire 31 March")
Applies to
All leave types / Specific types only


Borrow ahead
Setting
Options
Allowed
Yes / No
Cap
Fixed max (e.g. 5 days) default 0
Applies to
All leave types / Specific types only


Workflow: Request vs Book
Setting
Request (approval required)
Book (self-service)
Employee action
Submits a request
Confirms a booking directly
Approval step
Approver accepts or rejects
None — booking is immediate
Status flow
Pending > Approved / Rejected
Confirmed
Notifications
Approver notified on submit; employee notified on decision
Approver/team notified after booking
Cancellation
Employee can cancel pending; approved may need re-approval
Employee can cancel freely (within policy)


Features
Org Settings & Configuration
[ ] Default Holiday year start date. Fixed day of month (default: 1st January) or Employee Start Date.
[ ] bank_holiday_handling = 'additional' or 'deducted'
Holiday Profiles
[ ] Measurement mode: days or hours (default Days)
[ ] Allocation mode: fixed or Zero hours (default Fixed)
[ ] Default workflow: request or book
[ ] Max Carry-over rules (allowed, cap, expiry)
[ ] Min Carry-over rules (allowed, cap)
[ ] Adjust: Added to Allowance
[ ] Borrow-ahead amount
AbsenceTypes
[ ] Default absence types created on org setup (Annual Leave, Sick, Compassionate)
[ ] Custom leave types (org can add/edit/delete)
[ ] Per-type settings: paid/unpaid, tracked, requires approval, colour
Absence Reasons
[ ] Belong to an Absence Type
[ ] The entity that is requested or booked
Entitlements
[ ] Applies per employee per absence type
[ ] Pro-rating for mid-year starters/leavers
[ ] Accrual calculation (monthly/weekly)
[ ] Carry-over calculation at year-end
[ ] Entitlement adjustments (manual add/subtract with reason)
Working Patterns
[ ] Org-wide default working pattern (e.g. Mon–Fri)
[ ] Per-employee working pattern override
[ ] Part-time patterns (e.g. Mon/Wed/Fri)
[ ] Hours per day (for hours-mode orgs)
[ ] Working pattern history (changed mid-year — affects pro-rating)
Requesting / Booking
[ ] Employee submits holiday request (date range, leave type, optional note)
[ ] Half-day selection (AM/PM) in days mode
[ ] Hours/time selection in hours mode
[ ] Balance check before submission (warn or block if insufficient)
[ ] Overlap detection (block or warn if employee already has leave on those dates)
[ ] Team overlap warning (show who else is off — warn or block)
[ ] Self-service booking (when workflow = book)
Approval
[ ] Approval required
[ ] Approval required: none, 1 or 2 approvers who are named admins
[ ] Approval delegation (cover for absent approver)
[ ] Approver sees pending requests (filtered to their scope — team or all)
[ ] Approve / Reject with optional note
[ ] Bulk approve
[ ] Escalation (auto-remind or escalate if not actioned within N days)
Cancellation
[ ] Employee cancels pending request
[ ] Employee cancels approved holiday (will need re-approval)
[ ] Admin/owner cancels on behalf of employee
[ ] Cancelled days returned to balance
Calendar & Visibility
[ ] Employee sees their own holiday calendar
[ ] Team calendar (who's off when — based on permissions)
[ ] Org-wide calendar (owners/admins)
[ ] Bank holidays shown on calendar
[ ] Colour-coded by leave type
Balances & Reporting
[ ] Employee dashboard: entitlement, used, remaining, pending
[ ] Admin dashboard: team balances at a glance
[ ] Pending approvals
[ ] Holiday report (filterable by team, date range, leave type)
[ ] Export to CSV
[ ] Integration with existing ClearHR reports system
Notifications
[ ] Employee notified: request approved/rejected, upcoming holiday reminder
[ ] Approver notified: new request pending
[ ] Push notifications (mobile app)
[ ] Email notifications
Mobile App
[ ] View own balances and upcoming holidays
[ ] Submit holiday request
[ ] Cancel request/booking
[ ] Push notification support
[  ] view own calendar

Database Schema
To be populated as tables are created. Below is an initial sketch.
Tables (planned)
Absence_types — Configurable absence categories per org.
Column
Type
Notes
id
uuid
PK
organisation_id
uuid
FK to organisations
name
text
e.g. "Annual Leave"
requires_tracking
boolean
Has an allowance
colour
text
Hex colour for calendar
is_paid
boolean


deducts_from_entitlement
boolean
Sick leave may not deduct
requires_approval
boolean
Per-type workflow override
is_default
boolean
System-created, non-deletable
sort_order
int
Display ordering
timestamps







absence_reasons — Configurable absence reasons per org.
Column
Type
Notes
id
uuid
PK
organisation_id
uuid
FK to organisations
leave_type_id
uuid
FK to leave type
name
text
e.g. "PM Annual Leave"
colour
text
Hex colour for calendar
is_default
boolean
System-created, non-deletable
sort_order
int
Display ordering
timestamps






holiday_settings — Org-wide holiday configuration (one row per org).
Column
Type
Notes
id
uuid
PK
organisation_id
uuid
FK, unique
year_start_type
boolean
fixed/employee Start Date (default fixed)
year_start_date
date
Day & month (default 1st January)
measurement_mode
text
'days' or 'hours'
allocation_mode
text
'fixed' or ‘zero hours’
default_workflow
text
'request' or 'book'
carry_over_allowed
boolean


carry_over_cap
numeric
null = unlimited
carry_over_expiry_months
int
Months into new year before carried days expire
timestamps






Holiday_year-record - Per-employee, per-leave-type, per-year allocation.
Column
Type
Notes
id
uuid
PK
organisation_id
uuid
FK
member_id
uuid
FK to members
absence_type_id
uuid
FK to absence_types
year_start
date
Start of the holiday year this covers
year_end
dare
End of the holiday year this covers
base_amount
numeric
Org default or employee override (days or hours)
adjustment
numeric
Manual add/subtract (default 0)
carried_over
numeric
From previous year
pro_rata_amount
numeric
Calculated effective entitlement after pro-rating
Timestamps







work_profiles — working schedules.
Column
Type
Notes
id
uuid
PK
organisation_id
uuid
FK
name
text
E.g. ‘Weekly 37 hour’
member_id
uuid
FK to members (null = org default)
effective_from
date
When this pattern starts
hours_per_day
Numeric x7
For hours-mode orgs. 0 or null = not working
Timestamps







employee_work_profiles — employee working schedules.
Column
Type
Notes
id
uuid
PK
work_profile__id
uuid
FK
member_id
uuid
FK to members
effective_from
date
When this pattern starts
Timestamps








holiday_bookings — Individual absence records.
Column
Type
Notes
id
uuid
PK
organisation_id
uuid
FK
member_id
uuid
FK to members
leave_reason_id
uuid
FK to leave_reasons
start_date
date


end_date
date


start_half
text
null, 'am', 'pm' (days mode)
end_half
text
null, 'am', 'pm' (days mode)
hours
numeric
Total hours (hours mode)
days_deducted
numeric
Calculated days/hours deducted from balance
status
text
'pending', 'approved', 'rejected', 'cancelled'
approver_id
uuid
FK to members (who approved/rejected)
approver_note
text


actioned_at
timestamptz
When approved/rejected
timestamps






absence_comments - comments relating to a holiday booking

Column
Type
Notes
id
uuid
PK
holiday_booking_id
uuid
FK to holiday_booking
note
text
e.g. "Holiday in Spain"
timestamps






bank_holidays — Country-specific public holidays + org overrides.
Column
Type
Notes
id
uuid
PK
country_code
text
ISO code
organisation_id
uuid
Null = system-wide, non-null = org override
date
date


name
text
e.g. "Christmas Day"
is_excluded
boolean
Org removed this date from their list

RLS Notes
Employees: read own bookings, requests and entitlements only. Create requests (subject to balance/overlap checks in server action). Cannot approve.
Admins: read bookings for their team (or all, per can_view_all_teams). Approve/reject if can_approve_holidays.
Owners: full read/write across org.
All write operations through server actions with permission checks.

Business Rules
To be documented as logic is implemented.
Balance Calculation
effective_entitlement = pro_rata_amount + adjustment + carried_over
used = sum(days_deducted) WHERE status IN ('approved', 'pending')
remaining = effective_entitlement - used
Note: Pending requests count against balance to prevent overbooking.
Pro-rating (mid-year starters)
months_remaining = months from start_date to year_end
pro_rata = base_amount * (months_remaining / 12)
Rounding: round down to nearest 0.5.
Overlap Detection
Same employee, overlapping dates, status not 'cancelled' or 'rejected' → block.
Same team, overlapping dates → warn (informational, not blocking).
Day Counting (days mode)
Only count days in the employee's working pattern.
Half days count as 0.5.
Bank holidays within the range: skip if bank_holiday_handling = 'additional', count if 'deducted'.
Accrual Calculation
monthly_accrual = base_amount / 12
accrued_to_date = monthly_accrual * months_elapsed
Accrual date: 1st of each month, or pro-rated for mid-month starters.

UI Notes
To be documented as screens are built.
Planned Screens
Employee holiday dashboard — balance summary, upcoming bookings, outstanding requests, "Request holiday" button
Request/book form — date picker, absence reason selector, half-day toggles, balance indicator
Approval queue — list of pending requests for approver, approve/reject actions
Team calendar — visual calendar showing who's off (colour-coded by leave type)
Admin: holiday settings — org-wide config (measurement, allocation, workflow, carry-over, bank holidays)
Admin: entitlements — table of employees with their entitlements, adjustments, balances
Mobile: holiday tab — balance, upcoming, request

Open Questions
Can an org switch between days/hours mode after initial setup, or is it locked? If switchable, how do we migrate existing bookings? Answer: this will be handled by the Holiday Profile which determines what rules are applied for a holiday period.
Allow booking against future accrual (borrow ahead)? Answer: No
Should the approval workflow be configurable per absence type, or is it org-wide only? Answer: Per absence type
How granular should hours-mode bookings be? 15-min increments? Free-form? Answer: 15 min increments
Should TOIL be a leave type with special accrual rules, or a separate system? Answer: Separate system
Notification channels: email only to start, or push from day one? Answer: Both from day one. Employee defaults to both but can modify in Self Service and mobile
Should bank holiday data be bundled in the app or fetched from an external API? Answer: Initially, bundle in the app.
Minimum/maximum booking length rules (e.g. "must book at least 1 day", "max 10 consecutive days without director approval")? Answer: Org wide rules for length of booking and notice given.
Who can see balances? Just the employee and their approver, or all admins? Answer: NAll admins with rights to view the employee’s team.
Should cancelled approved holidays require re-approval, or just return the days immediately? Answer: requires re-approval.
