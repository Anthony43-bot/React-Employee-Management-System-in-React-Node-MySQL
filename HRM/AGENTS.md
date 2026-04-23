# AGENTS.md

## Project Overview

This repository is a production-oriented multi-tenant HR SaaS platform built with:

- Next.js App Router
- TypeScript
- Drizzle ORM
- PostgreSQL
- AWS Cognito for authentication
- S3 for uploads
- Server Actions + API routes
- Role-based access control
- Admin and employee portals

This codebase includes:

- multi-tenant organization management
- employees, departments, positions
- attendance and timecards
- leave management
- announcements
- documents
- compensation reviews / salary bands
- payroll workflows
- subscriptions, trials, upgrades
- admin dashboard and audit logs

You are expected to behave like a senior production engineer working inside a live SaaS codebase.

---

## Core Engineering Priorities

Always optimize for the following, in this order:

1. Security
2. Data isolation
3. Correctness
4. Stability
5. Maintainability
6. Performance
7. UX polish

Do not make changes that look nice but weaken auth, tenant isolation, or data correctness.

---

## Critical Architecture Rules

### 1. Multi-tenant safety is mandatory
This is a multi-tenant SaaS.

- Never trust `orgId` from query params, request body, client state, or cookies if server auth context is available.
- Prefer org scope from authenticated server context.
- Every organization-scoped query must be constrained to the authenticated organization unless the route is explicitly for `super_admin`.
- Never allow one tenant to access another tenant’s data.
- If a route currently accepts `organizationId`, treat that as suspicious and verify whether it should instead come from auth context.

### 2. Role enforcement is mandatory
Use the existing auth and RBAC patterns consistently.

- `super_admin` routes must remain strictly isolated.
- Owner / HR / Payroll / Department Manager / Employee scopes must be preserved.
- Never widen permissions unless explicitly requested.
- If a route performs a sensitive action, verify both authentication and authorization.

### 3. Prefer server-side trust boundaries
When fixing code:

- trust server auth context over client input
- trust validated DB lookups over JWT convenience values when needed
- avoid moving secure logic into the client

### 4. Do not break existing flows
The codebase already has working flows for:

- Cognito login / refresh
- organization onboarding
- employee CRUD
- subscription and trial management
- payroll approval / processing
- admin portal

When changing one area, consider adjacent flows that may depend on it.

---

## Coding Rules

### General
- Use TypeScript strictly.
- Preserve existing project conventions.
- Prefer small, surgical fixes over rewrites.
- Do not introduce new libraries unless absolutely necessary.
- Do not replace working architecture with a different pattern unless asked.

### Error handling
- Add robust error handling for API routes and server actions.
- Return safe, structured errors.
- Never leak secrets, tokens, stack traces, or internal infrastructure details to the client.
- Log useful server-side diagnostics without exposing sensitive data.

### Validation
- Validate all request input.
- Treat all client-provided values as untrusted.
- If a value should be a UUID, date, enum, or numeric field, validate it.
- Reject invalid input early.

### DB access
- Keep queries scoped and explicit.
- Avoid unbounded queries where pagination should exist.
- Avoid N+1 query patterns when they can be reasonably fixed.
- Preserve data integrity when multiple writes are related.
- Be careful with partial failures when transactions are not available.

### Auth / cookies / tokens
- Do not expose secure tokens to the client unless explicitly required.
- Use `httpOnly`, `secure`, and sensible `sameSite` settings for sensitive cookies.
- Be cautious with refresh-token logic, especially admin flows.
- Never weaken admin auth protections.

### UI / client code
- Keep UI fixes compatible with server state.
- Avoid moving business logic into client components.
- Prefer preserving existing design language and component patterns.
- Keep forms resilient and easy to debug.

---

## Project-Specific High-Risk Areas

Always pay extra attention to these areas:

### Auth and session handling
Files and flows involving:
- Cognito tokens
- refresh endpoints
- middleware auth gates
- context loaders
- admin token flows

Look for:
- unsafe cookie handling
- token misuse
- role spoofing
- missing auth checks
- client-readable sensitive data

### Multi-tenant routes
Any route involving:
- organizations
- employees
- departments
- documents
- payroll
- timecards
- leave
- calendar
- reports

Look for:
- tenant boundary leaks
- missing org filters
- orgId from request params when auth context should be used

### Payroll and compensation
These areas affect money and trust.

Look for:
- approval-state bugs
- invalid status transitions
- incorrect totals
- manager/owner permission gaps
- unsafe manual overrides

### Admin portal
Super-admin routes must stay isolated from regular org users.

Look for:
- missing `super_admin` enforcement
- accidental shared cookie usage
- misuse of general auth helpers in admin-only routes

### Documents and uploads
Look for:
- unsafe upload assumptions
- placeholder/demo behavior leaking into production logic
- public-read misuse
- weak file validation
- missing tenant scoping for uploaded paths

### Dashboard and reporting queries
Look for:
- heavy repeated queries
- N+1 patterns
- incorrect aggregations
- reliance on client-derived org data

---

## How to Work

When asked to fix or improve something, follow this process:

### Phase 1: Analyze first
Before editing:
- identify root cause
- identify surrounding dependencies
- identify security implications
- identify tenant-scope implications
- identify whether the bug is local or architectural

### Phase 2: Fix safely
When making changes:
- keep diffs minimal
- preserve public interfaces unless necessary
- avoid unrelated refactors
- maintain compatibility with current routes and pages

### Phase 3: Verify impact
After changes, mentally check:
- auth still works
- roles still work
- org scoping still works
- no obvious type regressions
- no broken imports
- no broken route contracts
- no client/server boundary mistakes

---

## What to Flag Explicitly

If you find any of the following, call them out clearly:

### Critical
- tenant isolation vulnerability
- missing auth on sensitive route
- admin privilege escalation risk
- token/cookie exposure risk
- production secrets mishandling
- destructive action without proper authorization

### High
- incorrect payroll/compensation logic
- broken approval workflow
- unsafe upload behavior
- stale or inconsistent subscription enforcement
- important DB writes that can partially fail

### Medium
- N+1 performance issue
- duplicated business logic
- missing validation
- weak UX around error handling
- inconsistent role checks

---

## Change Style Preferences

Prefer:

- concise, targeted diffs
- clear function names
- existing utilities/helpers when available
- existing auth helpers when correct
- consistent return shapes

Avoid:

- massive rewrites
- introducing patterns not already used in the codebase
- weakening strict typing
- changing unrelated files
- “cleanup” that adds risk

---

## Output Format for Code Tasks

When responding to a code task, prefer this structure:

1. Root cause
2. Risk level
3. Files to change
4. Patch / updated code
5. Why this fix is safe
6. Any follow-up concerns

If multiple issues exist, rank them by severity first.

---

## Repository Assumptions

Assume:

- this is an active production-style SaaS
- auth and tenant boundaries are more important than convenience
- admin and org-user experiences must remain separated
- backwards-compatible fixes are preferred
- bugs should be fixed with minimal disruption

---

## Special Instructions for This Codebase

### If you see `getAuthContextOptional()`
Treat it carefully.
Ask:
- should this route actually require auth?
- should optional auth be replaced with strict auth?
- is the route accidentally allowing unauthorized behavior?

### If you see `organizationId` coming from request input
Treat it as a possible security issue.
Prefer authenticated org context unless this is explicitly a super-admin workflow.

### If you see mock/demo logic in production pages
Do not leave demo placeholders in critical business flows unless explicitly intentional.
Flag them.

### If you see client-side role checks only
Treat them as insufficient.
Sensitive permissions must be enforced server-side too.

### If you see repeated DB lookups in loops
Flag or optimize if practical, especially on dashboard and reporting pages.

---

## Good Example Behaviors

Good:
- tightening org scoping in a route
- adding validation to a POST body
- replacing body/query orgId with auth context
- fixing incorrect status transitions
- improving token cookie safety
- reducing N+1 queries in hot paths

Bad:
- removing auth checks to “make it work”
- trusting client-provided org identifiers
- exposing internal errors to the UI
- doing broad refactors during a bug fix
- adding new dependencies for simple problems

---

## Final Rule

This project handles employee, payroll, organization, and subscription data.

Treat every change as if:
- real companies use it
- payroll depends on it
- security matters
- tenant isolation must never fail