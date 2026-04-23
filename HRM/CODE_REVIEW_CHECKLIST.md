# CODE_REVIEW_CHECKLIST.md

## Purpose

Use this checklist when reviewing any code in this repository.

This is a production-style multi-tenant HR SaaS platform. Reviews must prioritize:

1. Tenant isolation
2. Authentication and authorization
3. Data correctness
4. Stability
5. Maintainability
6. Performance
7. UX resilience

Do not approve code that “works” but weakens security, tenant boundaries, or role enforcement.

---

## 1. Tenant Isolation Checklist

### Required questions
- Does this code access organization-scoped data?
- If yes, where does the `orgId` come from?
- Is the `orgId` taken from trusted server auth context instead of request input?
- Is every DB query properly scoped to the authenticated tenant?
- Could this route or action expose another organization’s data?

### Red flags
- `organizationId` or `orgId` coming from:
  - query params
  - request body
  - client props
  - local storage
  - cookies when secure server context exists
- queries missing `organization_id` filters
- employee, document, leave, payroll, or report lookups by ID without tenant scoping
- update/delete actions scoped only by record ID and not by organization

### Review result
- [ ] Tenant boundary is safe
- [ ] No cross-tenant access path found
- [ ] Authenticated org context is used where appropriate

---

## 2. Authentication Checklist

### Required questions
- Is this route/action/page protected appropriately?
- Should auth be required instead of optional?
- Are tokens or cookies handled safely?
- Is admin auth separated from regular user auth?

### Red flags
- sensitive routes using optional auth without a good reason
- auth checks only in the client
- missing session verification on server actions
- sensitive data returned to unauthenticated users
- admin routes relying on non-admin auth helpers
- readable cookies containing sensitive auth data unnecessarily

### Review result
- [ ] Authentication is correctly enforced
- [ ] No sensitive route is accidentally public
- [ ] Session/token handling looks safe

---

## 3. Authorization / RBAC Checklist

### Required questions
- Does this action require a specific role?
- Is the role check enforced on the server?
- Is the allowed role scope correct?
- Could a lower-privilege user perform a higher-privilege action?

### Red flags
- owner / hr_manager / payroll_manager / department_manager / employee actions mixed incorrectly
- `super_admin` routes not strictly protected
- UI-only role restrictions
- broad “authenticated user” access to sensitive operations
- payroll, compensation, org updates, or user assignment actions without explicit role checks

### Review result
- [ ] Role enforcement is correct
- [ ] No privilege escalation path found
- [ ] Server-side authorization is present where needed

---

## 4. Input Validation Checklist

### Required questions
- Are request parameters validated?
- Are body values validated before use?
- Are IDs, dates, enums, numeric fields, and booleans checked?
- Are dangerous assumptions made about optional fields?

### Red flags
- raw request body values passed directly into DB logic
- no validation for UUIDs, dates, emails, or status fields
- parse errors not handled
- missing required field checks
- invalid enum states allowed through

### Review result
- [ ] Input is validated
- [ ] Invalid input is rejected safely
- [ ] Error responses are structured and safe

---

## 5. Data Integrity Checklist

### Required questions
- Does this code perform multiple related writes?
- What happens if one write succeeds and another fails?
- Is transactional behavior needed?
- Could it leave inconsistent state?

### Red flags
- creating Cognito user + DB user + employee without rollback or recovery path
- updates across multiple tables without failure handling
- destructive operations that do not consider dependent data
- workflow state changes without validation

### Review result
- [ ] Data consistency risk is acceptable or addressed
- [ ] Failure scenarios are handled
- [ ] State transitions are valid

---

## 6. Database Query Checklist

### Required questions
- Is the query scoped?
- Is pagination used where needed?
- Is the query efficient enough for expected usage?
- Is there N+1 behavior that should be reduced?

### Red flags
- unbounded `select *` on large tables
- repeated queries inside loops
- missing pagination on admin or list endpoints
- filtering in application code instead of DB where avoidable
- expensive dashboard/reporting queries with no safeguards

### Review result
- [ ] Query is properly scoped
- [ ] Query is reasonably efficient
- [ ] No obvious N+1 issue in hot path

---

## 7. API Route Checklist

### Required questions
- Is the correct HTTP method used?
- Are request and response shapes clear and stable?
- Are status codes correct?
- Are internal errors hidden from clients?

### Red flags
- 200 on failure
- 500 for validation errors
- raw error objects or stack traces returned to client
- inconsistent response structure across similar endpoints
- route mixing too much business logic with transport logic

### Review result
- [ ] Route behavior is correct
- [ ] Error handling is safe
- [ ] Status codes are sensible

---

## 8. Server Actions Checklist

### Required questions
- Is the action protected server-side?
- Does it trust only server-side context?
- Is it safe to call repeatedly?
- Are mutations validated and authorized?

### Red flags
- server action trusting hidden form inputs for sensitive values
- no role check inside action
- direct mutation without validation
- redirect masking silent failures

### Review result
- [ ] Action is secure
- [ ] Action validates input
- [ ] Action handles failure safely

---

## 9. Payroll / Compensation Checklist

### Required questions
- Does this code affect money, salaries, periods, approvals, or compensation history?
- Are approval state transitions valid?
- Are only authorized roles allowed to act?
- Are totals / budgets / statuses computed correctly?

### Red flags
- approved periods editable without restriction
- payroll processing before approval
- compensation review completion without full checks
- incorrect salary / percentage calculations
- missing audit logs on sensitive financial actions

### Review result
- [ ] Financial logic appears correct
- [ ] Approval workflow is protected
- [ ] No high-risk compensation/payroll issue found

---

## 10. Documents / Uploads Checklist

### Required questions
- Are uploads validated?
- Is file ownership / org ownership enforced?
- Is public access intentional?
- Are document actions role-scoped?

### Red flags
- public-read uploads without business need
- file type or size not checked
- document verification without role enforcement
- placeholder/demo upload behavior in production path
- document listing not tenant-scoped

### Review result
- [ ] Upload flow is safe enough
- [ ] Document access is scoped correctly
- [ ] File exposure risk is understood

---

## 11. Admin Portal Checklist

### Required questions
- Is this route/page truly super-admin only?
- Does it use admin cookies / admin middleware correctly?
- Could a normal org user reach or simulate the flow?

### Red flags
- shared auth helpers across admin and standard user flows without guardrails
- missing `super_admin` check
- admin cookies readable or misused
- organization admin confused with platform admin

### Review result
- [ ] Admin isolation is preserved
- [ ] No normal-user access path found
- [ ] Super-admin enforcement is explicit

---

## 12. Frontend Safety Checklist

### Required questions
- Does the UI depend on server truth for sensitive operations?
- Are destructive actions confirmed?
- Are loading, success, and error states handled?
- Is sensitive data accidentally exposed in the UI?

### Red flags
- client-only permission checks
- hidden buttons but no server enforcement
- sensitive tokens or claims shown in UI
- destructive actions with no confirmation
- forms with poor failure handling

### Review result
- [ ] UI is not trusted for security
- [ ] Error and loading states are acceptable
- [ ] Sensitive behavior is enforced server-side

---

## 13. State / Async Checklist

### Required questions
- Could concurrent requests create inconsistent state?
- Are async calls awaited correctly?
- Could stale state or race conditions affect correctness?
- Is there duplicate submission protection where needed?

### Red flags
- multiple clicks causing duplicate writes
- mutation state not locked during processing
- stale client state assumed to be authoritative
- race between auth refresh and protected fetch

### Review result
- [ ] Async flow is safe enough
- [ ] Duplicate actions are controlled
- [ ] No obvious race condition found

---

## 14. Logging / Observability Checklist

### Required questions
- Are errors logged on the server where useful?
- Are secrets/tokens excluded from logs?
- Are sensitive actions audited when appropriate?

### Red flags
- logging tokens, cookies, PII, or secrets
- no logging for critical failure paths
- missing audit logs for org changes, payroll, plan changes, settings changes, approvals

### Review result
- [ ] Logging is useful and safe
- [ ] Sensitive values are not leaked
- [ ] Audit coverage is acceptable for sensitive actions

---

## 15. UX / Product Correctness Checklist

### Required questions
- Does the feature behave in a way users would expect?
- Are empty states, loading states, and error states sensible?
- Are workflows complete, or is mock/demo behavior still present?

### Red flags
- demo placeholders in production UX
- forms that appear successful but do nothing
- actions with no visible feedback
- page depends on mocked data while pretending to be real

### Review result
- [ ] UX is honest and functional
- [ ] No misleading mock behavior remains unnoticed
- [ ] Workflow is reasonably complete

---

## 16. Code Quality Checklist

### Required questions
- Is the change minimal and readable?
- Does it follow project conventions?
- Are types correct and useful?
- Is logic duplicated unnecessarily?

### Red flags
- large rewrites for a small fix
- unnecessary new abstractions
- weak typing / `any` added without reason
- repeated business logic that should reuse existing helpers
- mixing route transport logic and business logic unnecessarily

### Review result
- [ ] Code is maintainable
- [ ] Types are reasonable
- [ ] Change size is appropriate

---

## 17. Performance Checklist

### Required questions
- Is this in a hot path (dashboard, employees list, reports, admin list, attendance)?
- Can the query or component scale reasonably?
- Is there excessive re-rendering or repeated fetching?
- Is caching or pagination needed?

### Red flags
- dashboards performing many independent DB calls
- loops with per-item DB access
- client pages doing large data fetches repeatedly
- expensive filters handled purely client-side when server filtering exists

### Review result
- [ ] No significant performance regression found
- [ ] Scaling risk is acceptable for this change
- [ ] Hot-path behavior is considered

---

## 18. Security Headers / Config Checklist

### Required questions
- Does this change affect middleware, CSP, cookies, or platform config?
- Could it weaken browser protections?
- Does it expose new origins or capabilities unnecessarily?

### Red flags
- weaker CSP without strong reason
- insecure cookie settings
- excessive use of `unsafe-inline` / `unsafe-eval` spreading further
- admin route matcher gaps
- new external origins added without need

### Review result
- [ ] Platform security posture is preserved
- [ ] No unnecessary config weakening found

---

## Review Severity Guide

### Critical
Must be fixed before merge:
- tenant isolation bug
- auth bypass
- privilege escalation
- admin isolation failure
- financial workflow corruption
- secret/token exposure

### High
Should be fixed before merge unless explicitly accepted:
- unsafe upload behavior
- incorrect status transitions
- missing validation on important routes
- partial-write inconsistency
- severe reporting or payroll correctness issue

### Medium
Should usually be fixed soon:
- N+1 in moderate path
- duplicated logic
- weak UX around errors
- non-critical missing validation
- inconsistent patterns

### Low
Can be deferred:
- style cleanup
- naming improvements
- minor refactors
- small UI polish

---

## Reviewer Output Template

Use this format when summarizing a review:

### Summary
- What was reviewed
- Overall risk level

### Findings
1. Severity — Title
   - Root cause
   - Why it matters
   - Recommended fix

### Approved / Not Approved
- [ ] Approved
- [ ] Approved with follow-ups
- [ ] Changes required

### Must Fix Before Merge
- item 1
- item 2

### Follow-up Suggestions
- item 1
- item 2

---

## Final Reminder

This codebase handles:
- employee records
- payroll and compensation
- organization data
- subscriptions and admin operations

When in doubt:
- trust server auth context
- scope by tenant
- enforce role checks
- validate input
- prefer minimal safe fixes