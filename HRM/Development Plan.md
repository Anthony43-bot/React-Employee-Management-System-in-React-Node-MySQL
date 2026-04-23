Belize HRM SaaS — Development Plan
Version: 1.0 · Last Updated: June 2025
Codename: CayeHR · Currency: BZD · Jurisdiction: Belize

1. Project Overview & Goals
CayeHR is a multi-tenant, cloud-native Human Resources Management SaaS built exclusively for Belizean businesses. It targets SMEs across tourism, agriculture, and retail — sectors that form the backbone of the Belizean economy yet remain critically underserved by modern HR technology.

Primary Goals
#	Goal	Success Metric
1	100% Belize labour-law compliance	Passes audit against Labour Act Cap. 297, SSB Act, Income Tax Act
2	Accurate gross-to-net payroll	Zero-error payroll for 50+ test scenarios (SSB, PAYE, overtime, severance)
3	Multi-tenant data isolation	No cross-tenant data leakage under penetration testing
4	Fast time-to-value for SMEs	Onboard a new company in < 10 minutes
5	Low operational cost	Run on AWS Free Tier + Neon Free Tier for first 100 tenants
6	Tiered SaaS monetization	Starter (1–10 employees), Professional (11–50), Enterprise (51+)
Target Users & Roles
Super Admin — Platform operator (us); manages tenants, global settings, billing
Company Admin — Business owner / HR manager; full company-level control
Manager — Department head; approves leave, views team reports
Employee — Self-service; clock in/out, view payslips, request leave
2. High-Level Architecture
text

┌─────────────────────────────────────────────────────────────────┐
│                        CLIENTS                                  │
│   Browser (Next.js 15 SSR/RSC)  ·  Mobile Browser (PWA-ready)  │
└──────────────────────────┬──────────────────────────────────────┘
                           │ HTTPS
┌──────────────────────────▼──────────────────────────────────────┐
│                     AWS AMPLIFY (Hosting)                        │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  Next.js 15 App Router                                    │  │
│  │  ├─ React Server Components (data fetching)               │  │
│  │  ├─ Server Actions (mutations)                            │  │
│  │  ├─ API Routes (webhooks, bank export)                    │  │
│  │  └─ Middleware (auth guard, tenant resolution)            │  │
│  └────────────────────────────────────────────────────────────┘  │
└──────┬──────────┬──────────┬──────────┬─────────────────────────┘
       │          │          │          │
┌──────▼───┐ ┌───▼────┐ ┌──▼───┐ ┌───▼─────────┐
│  Neon    │ │  AWS   │ │ AWS  │ │ AWS Cognito  │
│ Postgres │ │  S3    │ │ SES  │ │ User Pools   │
│ (Drizzle)│ │ (docs, │ │(email│ │ (auth, MFA,  │
│          │ │  PDFs) │ │  )   │ │  groups)     │
└──────────┘ └────────┘ └──────┘ └──────────────┘

Data Flow:
  1. User authenticates via Cognito → JWT with custom:org_id
  2. Middleware extracts org_id, attaches to request context
  3. Every DB query is scoped: WHERE organization_id = ctx.orgId
  4. Server Actions run mutations; RSCs stream UI
  5. PDFs generated server-side (pdf-lib) → stored in S3
  6. SES sends payslip emails, leave notifications, compliance reminders
3. Tech Stack & Decisions
Layer	Technology	Rationale
Framework	Next.js 15 (App Router)	RSC + Server Actions eliminate need for separate API; streaming SSR for fast TTFB
Language	TypeScript (strict)	End-to-end type safety; shared types between client/server
UI	Tailwind CSS + shadcn/ui	Rapid, consistent, accessible component library; fully customizable
Validation	Zod	Runtime + compile-time schema validation; shared between forms and Server Actions
Auth	AWS Cognito	Managed auth with MFA, custom attributes (custom:org_id, custom:role), user groups for RBAC; free tier covers 50K MAU
Database	Neon Postgres (serverless)	Auto-scales to zero (cost-efficient); branching for dev/staging; Postgres-native (JSONB, triggers, RLS-ready); free tier = 0.5 GB
ORM	Drizzle ORM	Type-safe, SQL-like, lightweight; excellent Neon/serverless support; no cold-start overhead vs. Prisma
Hosting	AWS Amplify	Native Next.js 15 support; CI/CD from Git; free tier = 1000 build mins + 15 GB bandwidth
Email	AWS SES	Transactional email at $0.10/1000; payslip delivery, leave notifications, compliance alerts
File Storage	AWS S3	Documents, generated PDFs, employee photos; presigned URLs for secure access
PDF Generation	pdf-lib	Pure JS, no native deps; works in serverless; full control over payslip/TD4 layout
Why Neon + AWS Hybrid?
Cost: Both offer generous free tiers — critical for a bootstrapped Belize-market SaaS where ARPU may be $25–75 BZD/month
Serverless alignment: Neon auto-suspends on idle (no charges when no queries); Amplify scales to zero between requests
Separation of concerns: AWS handles auth, email, storage, hosting (managed infra); Neon handles data (Postgres expertise, branching, point-in-time recovery)
No vendor lock-in on data: Neon is standard Postgres — can migrate to RDS, Supabase, or self-hosted PG with zero schema changes
Regional latency: Neon us-east-1 + Amplify us-east-1 = ~40ms roundtrip from Belize
4. Database Schema
All tables include organization_id as a mandatory foreign key for tenant isolation. Below are the key tables expressed as Drizzle ORM schema definitions.

Core Tables
organizations — Tenant table

Column	Type	Notes
id	uuid PK	
name	varchar(255)	Company name
trade_name	varchar(255)	
tin	varchar(20)	Belize Tax Identification Number
ssb_employer_number	varchar(20)	
district	varchar(50)	Enum: 6 Belize districts
address	text	
phone	varchar(15)	+501 format
subscription_tier	enum	starter, professional, enterprise
subscription_status	enum	active, trial, suspended, cancelled
settings	jsonb	Payroll frequency, fiscal year start, custom overtime rules
created_at / updated_at	timestamp	
users — Linked to Cognito

Column	Type	Notes
id	uuid PK	Matches Cognito sub
organization_id	uuid FK	
email	varchar(255)	
role	enum	super_admin, company_admin, manager, employee
employee_id	uuid FK nullable	Links to employee profile
is_active	boolean	
last_login_at	timestamp	
employees — Core HR record

Column	Type	Notes
id	uuid PK	
organization_id	uuid FK	
employee_number	varchar(20)	Auto-generated per org
first_name, middle_name, last_name	varchar	
date_of_birth	date	
gender	enum	
nationality	varchar(50)	
tax_id	varchar(20)	Belize TIN
ssb_number	varchar(20)	Social Security Number
work_permit_number	varchar(30) nullable	
work_permit_expiry	date nullable	
marital_status	enum	
phone	varchar(15)	
email	varchar(255)	
address_line_1, address_line_2	varchar	
district	varchar(50)	
town_or_city	varchar(100)	
emergency_contact_name, emergency_contact_phone	varchar	
hire_date	date	
termination_date	date nullable	
employment_status	enum	active, on_leave, terminated, suspended
employment_type	enum	full_time, part_time, contract, probation
department_id	uuid FK	
position_id	uuid FK	
manager_id	uuid FK nullable	Self-referencing
base_salary	decimal(12,2)	BZD
pay_frequency	enum	bimonthly, monthly, weekly
bank_name	varchar(100)	
bank_account_number	varchar(30)	
bank_branch	varchar(50)	
photo_url	text nullable	S3 key
created_at / updated_at	timestamp	
departments

Column	Type	Notes
id	uuid PK	
organization_id	uuid FK	
name	varchar(100)	
manager_id	uuid FK nullable	
positions

Column	Type	Notes
id	uuid PK	
organization_id	uuid FK	
title	varchar(100)	
department_id	uuid FK	
min_salary, max_salary	decimal nullable	
time_entries — Clock in/out

Column	Type	Notes
id	uuid PK	
organization_id	uuid FK	
employee_id	uuid FK	
clock_in	timestamptz	
clock_out	timestamptz nullable	
clock_in_lat, clock_in_lng	decimal nullable	Geolocation
clock_out_lat, clock_out_lng	decimal nullable	
total_hours	decimal(5,2) computed	
is_overtime	boolean	
overtime_rate	decimal(3,2)	1.0, 1.5, or 2.0
notes	text nullable	
status	enum	pending, approved, rejected
approved_by	uuid FK nullable	
leave_requests

Column	Type	Notes
id	uuid PK	
organization_id	uuid FK	
employee_id	uuid FK	
leave_type	enum	annual, sick, maternity, paternity, bereavement, unpaid, public_holiday
start_date	date	
end_date	date	
total_days	decimal(4,1)	
reason	text	
status	enum	pending, approved, rejected, cancelled
reviewed_by	uuid FK nullable	
reviewed_at	timestamp nullable	
attachment_url	text nullable	Medical cert S3 key
leave_balances

Column	Type	Notes
id	uuid PK	
organization_id	uuid FK	
employee_id	uuid FK	
leave_type	enum	
year	integer	
entitled_days	decimal(5,1)	
used_days	decimal(5,1)	
carried_over	decimal(5,1)	
balance	decimal(5,1) computed	
payroll_runs

Column	Type	Notes
id	uuid PK	
organization_id	uuid FK	
pay_period_start	date	
pay_period_end	date	
run_date	timestamp	
status	enum	draft, processing, completed, voided
total_gross	decimal(14,2)	
total_net	decimal(14,2)	
total_ssb_employee	decimal(14,2)	
total_ssb_employer	decimal(14,2)	
total_paye	decimal(14,2)	
created_by	uuid FK	
approved_by	uuid FK nullable	
payslips

Column	Type	Notes
id	uuid PK	
organization_id	uuid FK	
payroll_run_id	uuid FK	
employee_id	uuid FK	
gross_salary	decimal(12,2)	
basic_pay	decimal(12,2)	
overtime_pay	decimal(12,2)	
holiday_pay	decimal(12,2)	
other_allowances	decimal(12,2)	
ssb_employee	decimal(12,2)	
ssb_employer	decimal(12,2)	
paye_tax	decimal(12,2)	
other_deductions	decimal(12,2)	
net_pay	decimal(12,2)	
ytd_gross	decimal(14,2)	
ytd_paye	decimal(14,2)	
ytd_ssb	decimal(14,2)	
pdf_url	text nullable	S3 key
breakdown	jsonb	Detailed line items
public_holidays

Column	Type	Notes
id	uuid PK	
name	varchar(100)	
date	date	
year	integer	
district	varchar(50) nullable	NULL = national
is_observed	boolean	For Monday substitution rule
compliance_settings — Configurable rates

Column	Type	Notes
id	uuid PK	
key	varchar(100) unique	e.g., ssb_employee_rate, paye_bracket_1_max
value	jsonb	
effective_date	date	
description	text	
updated_by	uuid FK	
documents

Column	Type	Notes
id	uuid PK	
organization_id	uuid FK	
employee_id	uuid FK nullable	
type	enum	contract, policy, certificate, id_copy, work_permit, other
name	varchar(255)	
s3_key	text	
uploaded_by	uuid FK	
created_at	timestamp	
Additional tables (structure follows same pattern): job_history, performance_reviews, training_records, recruitment_jobs, recruitment_applications, audit_logs, notifications, subscription_billing

Key Indexes
All tables: composite index on (organization_id, id)
employees: index on (organization_id, employment_status)
time_entries: index on (organization_id, employee_id, clock_in)
payslips: index on (organization_id, employee_id, payroll_run_id)
leave_requests: index on (organization_id, employee_id, status)
5. Multi-Tenancy & Authentication Strategy
Authentication Flow
text

1. User signs up → Cognito User Pool creates user
2. Admin assigns custom attributes:
   - custom:org_id  → uuid of their organization
   - custom:role    → company_admin | manager | employee
3. User signs in → Cognito returns JWT with claims:
   {
     sub: "user-uuid",
     custom:org_id: "org-uuid",
     custom:role: "company_admin",
     cognito:groups: ["org-{uuid}-admins"]
   }
4. Next.js Middleware validates JWT on every request
5. Server-side context extracts org_id → injected into all queries
Tenant Isolation Strategy
Layer	Mechanism
Application	Every Drizzle query includes .where(eq(table.organizationId, ctx.orgId)) via a helper wrapper
Middleware	middleware.ts extracts and validates custom:org_id from Cognito JWT; rejects if missing
Database	Row-Level Security (RLS) as defense-in-depth: CREATE POLICY tenant_isolation ON employees USING (organization_id = current_setting('app.current_org')::uuid)
API	Server Actions receive orgId from authenticated context only — never from client input
Storage	S3 keys prefixed: orgs/{org_id}/employees/{emp_id}/...; bucket policy enforces prefix
Cognito Groups for RBAC
super-admins — Platform operators
org-{uuid}-admins — Company admins for a specific tenant
org-{uuid}-managers — Managers
org-{uuid}-employees — Employees
Super Admin Isolation
Super admins exist in a separate Cognito group and have a dedicated /admin route group with its own middleware check. They can impersonate tenants for support purposes (logged in audit trail).

6. Feature Backlog
MVP — Phase 1 (Launch-Ready)
#	Feature	Priority
1	Multi-tenant auth (Cognito + org setup)	P0
2	Organization onboarding wizard	P0
3	Employee CRUD with Belize fields	P0
4	Department & position management	P0
5	Clock In / Clock Out with timestamps	P0
6	Leave requests & approvals (all Belize leave types)	P0
7	Leave balance tracking & accrual	P0
8	Payroll engine (SSB, PAYE, overtime, gross-to-net)	P0
9	Payslip PDF generation & email delivery	P0
10	Public holidays (pre-seeded, admin-editable)	P0
11	Employee self-service dashboard	P0
12	Configurable compliance settings	P0
13	Basic role-based access (Admin, Manager, Employee)	P0
Phase 2 — Compliance & Reporting
#	Feature	Priority
14	TD4 form generation (PDF)	P1
15	SSB Form SSB1 report	P1
16	IT1 Income Tax Return export	P1
17	Compliance calendar with automated SES reminders	P1
18	Bank export file (BCB format)	P1
19	Overtime detailed reports	P1
20	Severance calculator	P1
21	Minimum wage validation warnings	P1
22	Work permit expiry alerts	P1
23	Document management (upload, categorize, S3)	P1
24	Geolocation on clock in/out	P1
25	Audit log (all data changes)	P1
Phase 3 — Growth & Advanced
#	Feature	Priority
26	Recruitment module (job postings, applications, pipeline)	P2
27	Performance reviews & goals	P2
28	Training & development tracking	P2
29	Job history timeline	P2
30	Subscription billing & Stripe integration	P2
31	Super admin dashboard (all tenants, analytics)	P2
32	Employee self-onboarding (invite flow)	P2
33	Mobile-optimized PWA	P2
34	API for third-party integrations	P2
35	Multi-currency support (USD display)	P2
7. Key Business Logic & Calculations
7.1 SSB (Social Security Board) Contributions
text

Constants (configurable in compliance_settings):
  SSB_EMPLOYEE_RATE = 0.0821  (8.21%)
  SSB_EMPLOYER_RATE = 0.0821  (8.21%)
  SSB_MAX_INSURABLE_WEEKLY = 480.00 BZD (weekly)
  SSB_MAX_INSURABLE_ANNUAL = 24,960.00 BZD

Calculation (per pay period):
  1. Determine insurable earnings = min(gross_pay, max_insurable_for_period)
  2. employee_ssb = insurable_earnings × SSB_EMPLOYEE_RATE
  3. employer_ssb = insurable_earnings × SSB_EMPLOYER_RATE
  4. Round to 2 decimal places (half-up)
7.2 PAYE (Pay As You Earn) Income Tax
text

Annual Tax Brackets (configurable):
  Bracket 1: 0 – 26,000 BZD          → 0%
  Bracket 2: 26,001 – 50,000 BZD     → 15%
  Bracket 3: 50,001 – 100,000 BZD    → 25%
  Bracket 4: 100,001+ BZD            → 40%

Calculation (annualized method):
  1. Annualize gross pay: annual_gross = period_gross × periods_per_year
  2. Deduct personal allowance (built into bracket 1 zero-rate)
  3. Deduct employee SSB (annual) as allowable deduction
  4. Apply brackets to get annual_tax
  5. Period tax = annual_tax / periods_per_year
  6. Compare with YTD tax paid → adjust for over/under payment
7.3 Overtime Calculation
text

Rules (Belize Labour Act):
  Standard work week: 45 hours (or 9 hours/day for 5-day week)
  Overtime rate 1: 1.5× after 45 hours (weekdays)
  Overtime rate 2: 2.0× on Sundays and public holidays

Calculation:
  1. Sum weekly hours from time_entries
  2. Hours 0–45: regular rate
  3. Hours 46+: check if Sunday/holiday → 2.0×, else → 1.5×
  4. hourly_rate = base_salary / (pay_period_hours)
  5. overtime_pay = overtime_hours × hourly_rate × overtime_multiplier
7.4 Severance Pay
text

Eligibility: Continuous employment ≥ 5 years, terminated without cause
Calculation:
  - 5–10 years: 1 week's pay per year of service
  - 10+ years: 2 weeks' pay per year of service
  - week_pay = base_salary / (52 / 12) for monthly employees
  - Capped considerations per Labour Act amendments
7.5 Leave Accrual
text

Annual Leave:
  - Minimum: 2 weeks (10 working days) per year
  - Accrual: 10 / 12 = 0.833 days per month
  - Eligible after 1 year continuous service (pro-rata for first year at employer's discretion)

Maternity Leave:
  - 14 weeks (eligible after 150 days of insurable employment)
  - First 14 weeks: employer pays full salary for first 2 weeks, SSB covers remaining

Sick Leave:
  - Up to 16 days per year (paid)
  - Medical certificate required after 2 consecutive days

Bereavement:
  - 3–5 days (configurable per company policy)

Paternity:
  - 5 days (company policy; not yet legislated but common practice)
7.6 Clock In / Clock Out Logic
text

1. Employee hits "Clock In" → create time_entry with clock_in = NOW()
2. Validate: no open (unclosed) time_entry exists for today
3. Optional: capture geolocation (lat/lng)
4. Employee hits "Clock Out" → update time_entry with clock_out = NOW()
5. Calculate total_hours = (clock_out - clock_in) in decimal hours
6. Determine if day is Sunday or public_holiday → set overtime_rate
7. At week's end: aggregate hours → flag entries exceeding 45-hr threshold
8. Manager approves/rejects flagged entries
7.7 Payroll Run Process
text

1. Admin initiates payroll run for pay period (e.g., 1st–15th)
2. System aggregates per employee:
   a. Basic pay (base_salary / periods_per_year)
   b. Approved overtime from time_entries
   c. Holiday pay (if worked on public holiday)
   d. Allowances / deductions
3. Calculate SSB (employee + employer)
4. Calculate PAYE (annualized method, YTD-adjusted)
5. Net pay = gross - SSB_employee - PAYE - other_deductions
6. Generate payslip record + PDF  
7. Admin reviews draft → approves → status = completed
8. System emails payslips via SES
9. Generate bank export file
8. Project Folder Structure
text

belize-hrm/
├── drizzle/
│   ├── migrations/
│   └── seed/
│       ├── public-holidays.ts
│       ├── districts.ts
│       └── compliance-settings.ts
├── public/
│   └── images/
├── src/
│   ├── app/
│   │   ├── (auth)/
│   │   │   ├── login/page.tsx
│   │   │   ├── signup/page.tsx
│   │   │   └── forgot-password/page.tsx
│   │   ├── (dashboard)/
│   │   │   ├── layout.tsx
│   │   │   ├── page.tsx                    # Dashboard home
│   │   │   ├── employees/
│   │   │   │   ├── page.tsx                # Employee list
│   │   │   │   ├── [id]/page.tsx           # Employee detail
│   │   │   │   └── new/page.tsx
│   │   │   ├── attendance/
│   │   │   │   ├── page.tsx                # Clock in/out
│   │   │   │   └── reports/page.tsx
│   │   │   ├── leave/
│   │   │   │   ├── page.tsx                # My leave
│   │   │   │   ├── requests/page.tsx       # Approval queue
│   │   │   │   └── balances/page.tsx
│   │   │   ├── payroll/
│   │   │   │   ├── page.tsx                # Payroll runs
│   │   │   │   ├── [runId]/page.tsx        # Run detail
│   │   │   │   └── settings/page.tsx
│   │   │   ├── reports/
│   │   │   │   ├── td4/page.tsx
│   │   │   │   ├── ssb/page.tsx
│   │   │   │   └── compliance/page.tsx
│   │   │   ├── documents/page.tsx
│   │   │   ├── settings/
│   │   │   │   ├── organization/page.tsx
│   │   │   │   ├── users/page.tsx
│   │   │   │   ├── compliance/page.tsx
│   │   │   │   └── holidays/page.tsx
│   │   │   └── profile/page.tsx
│   │   ├── admin/                          # Super admin routes
│   │   │   ├── layout.tsx
│   │   │   ├── tenants/page.tsx
│   │   │   └── settings/page.tsx
│   │   ├── layout.tsx                      # Root layout
│   │   └── page.tsx                        # Landing page
│   ├── actions/                            # Server Actions
│   │   ├── auth.ts
│   │   ├── employees.ts
│   │   ├── attendance.ts
│   │   ├── leave.ts
│   │   ├── payroll.ts
│   │   ├── reports.ts
│   │   └── settings.ts
│   ├── components/
│   │   ├── ui/                             # shadcn/ui components
│   │   ├── layout/
│   │   │   ├── sidebar.tsx
│   │   │   ├── header.tsx
│   │   │   └── breadcrumbs.tsx
│   │   ├── employees/
│   │   ├── attendance/
│   │   ├── leave/
│   │   ├── payroll/
│   │   └── forms/
│   ├── lib/
│   │   ├── db/
│   │   │   ├── index.ts                    # Neon connection + Drizzle client
│   │   │   ├── schema.ts                   # All Drizzle table definitions
│   │   │   └── queries/                    # Reusable query builders
│   │   ├── auth/
│   │   │   ├── cognito.ts                  # Cognito SDK helpers
│   │   │   ├── context.ts                  # Auth context (orgId, role, userId)
│   │   │   └── guards.ts                   # Role-based access helpers
│   │   ├── payroll/
│   │   │   ├── engine.ts                   # Main payroll calculator
│   │   │   ├── ssb.ts                      # SSB contribution calc
│   │   │   ├── paye.ts                     # PAYE tax calc
│   │   │   ├── overtime.ts                 # Overtime calc
│   │   │   ├── severance.ts                # Severance calc
│   │   │   └── leave-accrual.ts            # Leave balance calc
│   │   ├── pdf/
│   │   │   ├── payslip.ts                  # Payslip PDF template
│   │   │   ├── td4.ts                      # TD4 form PDF
│   │   │   └── ssb-report.ts              # SSB1 form PDF
│   │   ├── belize/
│   │   │   ├── districts.ts                # Districts & towns data
│   │   │   ├── holidays.ts                 # Public holiday helpers
│   │   │   ├── validation.ts               # Phone, TIN, SSB# validators
│   │   │   └── constants.ts                # Min wage, rates, etc.
│   │   ├── email/
│   │   │   └── ses.ts                      # AWS SES helpers
│   │   ├── storage/
│   │   │   └── s3.ts                       # S3 upload/presigned URL helpers
│   │   └── utils.ts                        # General utilities
│   ├── hooks/                              # Client-side React hooks
│   ├── types/                              # Shared TypeScript types & enums
│   │   ├── employee.ts
│   │   ├── payroll.ts
│   │   ├── leave.ts
│   │   └── belize.ts
│   ├── validations/                        # Zod schemas
│   │   ├── employee.schema.ts
│   │   ├── payroll.schema.ts
│   │   ├── leave.schema.ts
│   │   └── attendance.schema.ts
│   └── middleware.ts                       # Auth + tenant resolution
├── .env.local
├── .env.example
├── drizzle.config.ts
├── next.config.ts
├── tailwind.config.ts
├── tsconfig.json
├── package.json
└── README.md
9. Security, Compliance & Data Isolation
Data Security
Concern	Mitigation
Tenant isolation	Application-level org_id filtering + Postgres RLS policies as defense-in-depth
Authentication	AWS Cognito with MFA support; JWT validation on every request in middleware
Authorization	Role-based guards on every Server Action and RSC data fetch
Data in transit	HTTPS enforced (Amplify default); TLS 1.2+ for Neon connection
Data at rest	Neon encrypts at rest (AES-256); S3 server-side encryption (SSE-S3)
Secrets	Environment variables via Amplify; never committed to git
Input validation	Zod schemas on all form inputs and Server Action parameters
SQL injection	Drizzle ORM parameterized queries; no raw SQL without explicit parameterization
XSS	React's default escaping + CSP headers in next.config.ts
CSRF	Server Actions include built-in CSRF protection (Next.js 15)
Compliance Controls
Requirement	Implementation
SSB accuracy	Configurable rates in compliance_settings; unit tests against SSB calculation examples
PAYE accuracy	Tax bracket configuration; annualized method with YTD reconciliation
Data retention	Payroll records retained 7 years (Belize Income Tax Act); soft-delete for employees
Audit trail	audit_logs table records all CREATE/UPDATE/DELETE with before/after JSONB snapshots
TD4 deadline	Compliance calendar auto-creates reminders; SES alert 30/14/7 days before March 2
Work permits	Automated alert 90/60/30 days before expiry via SES
Minimum wage	Validation on employee salary save; warning if below current minimum ($5.00 BZD/hr as of 2024)
Audit Log Schema
Column	Type
id	uuid PK
organization_id	uuid FK
user_id	uuid FK
action	enum (create, update, delete)
entity_type	varchar (employee, payroll_run, leave_request, etc.)
entity_id	uuid
changes	jsonb ({field, old, new})
ip_address	varchar
created_at	timestamptz
10. Implementation Roadmap
Phase 1 — MVP Foundation (Weeks 1–8)
Week	Focus	Deliverables
1–2	Project Setup & Auth	Next.js 15 scaffold, Tailwind + shadcn/ui setup, Neon DB provisioned, Drizzle schema (core tables), Cognito User Pool configured, middleware auth guard, login/signup pages
3–4	Organization & Employees	Org onboarding flow, employee CRUD with Belize fields (district, SSB#, TIN, work permit), department/position management, form validation with Zod, Belize data seed (districts, holidays)
5–6	Attendance & Leave	Clock in/out UI + Server Actions, weekly hours aggregation, overtime flagging, leave request/approval workflow, leave balance tracking, public holiday auto-detection
7–8	Payroll Engine MVP	Gross-to-net calculator (SSB + PAYE + overtime), payroll run workflow (draft → approve), payslip PDF generation with pdf-lib, employee dashboard (view payslips, leave balance)
Phase 2 — Compliance & Reports (Weeks 9–14)
Week	Focus	Deliverables
9–10	Reports & Compliance	TD4 PDF generation, SSB1 report, compliance calendar with SES reminders, work permit expiry alerts
11–12	Financial Features	Bank export (BCB format), severance calculator, YTD reconciliation, minimum wage validation
13–14	Documents & Audit	S3 document upload/management, audit log implementation, configurable compliance settings admin UI, geolocation on clock in/out
Phase 3 — Growth Features (Weeks 15–22)
Week	Focus	Deliverables
15–17	Recruitment & Development	Job posting creation, application tracking, hiring workflow, performance review module, training records
18–19	Super Admin & Billing	Super admin dashboard, tenant management, subscription tier enforcement, usage analytics
20–22	Polish & Launch	PWA optimization, comprehensive testing (unit, integration, E2E), Belize-specific QA with accountant review, documentation, production deployment
Total Estimated Effort: 22 weeks (1 full-stack developer) / 12 weeks (2 developers)
11. Next Immediate Steps
Step 1: Project Bootstrap (Day 1–2)
Initialize Next.js 15 with TypeScript, Tailwind, shadcn/ui
Configure Drizzle ORM with Neon Postgres connection
Set up environment variables structure (.env.local, .env.example)
Deploy skeleton to AWS Amplify to confirm build pipeline works
Step 2: Database Schema & Seed (Day 3–4)
Implement core Drizzle schema (organizations, users, employees, departments, positions, compliance_settings, public_holidays)
Run initial migration against Neon
Create seed scripts: Belize 6 districts + towns, 12 national public holidays for 2024–2026, default compliance settings (SSB rates, PAYE brackets, minimum wage)
Step 3: Authentication Flow (Day 5–7)
Create Cognito User Pool with custom attributes (custom:org_id, custom:role)
Build middleware.ts for JWT validation and tenant context extraction
Implement login, signup, and forgot-password pages
Create lib/auth/context.ts to provide { userId, orgId, role } to Server Actions and RSCs
Test: user can sign up, sign in, and see their org_id in the dashboard
Step 4: Organization Onboarding (Day 8–10)
Build onboarding wizard: company name, TIN, SSB employer number, district, contact info
On completion: create organization record, update Cognito user with custom:org_id
Redirect to dashboard with tenant context active
Build sidebar navigation and dashboard layout shell
Step 5: Employee CRUD (Day 11–14)
Employee list page (server component, filtered by orgId)
Employee create/edit form with Zod validation (Belize phone format +501-XXX-XXXX, district dropdown, SSB# format)
Employee detail page with tabbed sections (profile, employment, documents)
Test: full CRUD cycle, confirm tenant isolation (user from org A cannot see org B employees)
