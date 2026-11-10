# AttendanceFlow Role Reviews

## Product Manager

**Findings**
- The core value is clear: reliable attendance capture and immediate summaries.
- MVP scope is appropriate, but QR check-in should remain future work until the basic flow is stable.
- The product must define the grace period as configuration rather than leaving it to each screen.

**Decision**
Keep session attendance, summaries, overrides, and one webhook in MVP. Treat analytics, QR, and LMS integration as future work.

## Frontend UX/UI

**Findings**
- The student flow needs clear states: not enrolled, upcoming, active, submitted, closed, and failed retry.
- The instructor view needs filters by session and status plus a visible last-updated time.
- Mobile and keyboard use matter because students may submit from a phone in class.

**Required changes**
Use accessible labels, semantic status text and color-independent indicators, disabled states during submission, and a retry-safe confirmation state. Do not display a success message unless the server confirms the record.

## Backend API and Database

**Findings**
- A client-side duplicate check is insufficient under concurrent requests.
- Firestore must not rely on a query-then-create sequence for attendance.
- Attendance and webhook creation need an idempotent command path.

**Required changes**
Use a deterministic attendance key or transaction, server timestamps, unique enrollment logic, validation of session ownership, and a durable webhook event. Add integration tests for simultaneous submissions.

## Quality and Security

**Findings**
- Attendance and enrollment are sensitive personal data.
- Role claims and client-provided student IDs must not be trusted.
- A webhook can leak data if payloads are too broad or signatures are missing.

**Required changes**
Verify Firebase tokens server-side, derive student identity from the token, deny direct client writes to protected collections, use least-privilege queries, sign webhook requests, redact logs, and audit overrides.

**Minimum test set**
Authentication, role denial, cross-student read denial, cross-course instructor denial, invalid timing, invalid status, duplicate request, concurrent request, failed webhook retry, and override-without-reason.

## Delivery and Document

**Findings**
- One Firebase stack is simpler than the mixed backend references in the supplied PRD.
- Free-tier limits and webhook cold starts are operational risks.
- The required release path should be reproducible by the whole team.

**Required changes**
Use Firebase Emulator Suite locally, document environment variables without secrets, add CI for tests/build, define a rollback procedure, and monitor webhook failures. Review free-tier quotas before a live class demonstration.

## Review Summary

| Area | Status | Main action |
|---|---|---|
| Requirement fit | Ready | Preserve focused MVP |
| Data integrity | Changes needed | Transaction and idempotency tests |
| Authorization | Changes needed | Server checks and restrictive rules |
| UX | Changes needed | Explicit state handling and accessibility |
| Delivery | Changes needed | Emulator, CI, quotas, and monitoring |

**Architecture Score:** 83/100

**Classification:** READY WITH CHANGES

The design is suitable for a student MVP once the listed controls are implemented and verified. The largest residual risks are concurrent writes, cross-scope data access, and webhook delivery reliability.
