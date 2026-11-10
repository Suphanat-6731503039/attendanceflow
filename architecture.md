# AttendanceFlow Architecture

## 1. Decision Summary

AttendanceFlow uses a single Firebase-based serverless stack for the MVP:

- React frontend hosted on Firebase Hosting
- Firebase Authentication for identity
- Cloud Functions for server-side business logic and HTTP APIs
- Cloud Firestore for persistence
- One Cloud Function worker for asynchronous webhook delivery

The PRD is the source of truth. Earlier references to a second backend platform are replaced by Firebase to avoid mixing authentication, database rules, and deployment platforms.

## 2. Architecture Diagram

```text
Student / Instructor Browser
            |
            v
     Firebase Hosting
       React application
            |
            +--------------------> Firebase Authentication
            |
            v
      HTTPS Callable/API Functions
       - session validation
       - attendance command
       - summaries
       - override + audit
            |
            v
       Cloud Firestore
   users, courses, enrollments,
   sessions, attendance, audits,
   webhook events
            |
            v
   Cloud Functions worker
   retry with backoff + logging
            |
            v
  External webhook destination
```

## 3. Component Responsibilities

### Frontend
The React app renders role-specific views, sends authenticated requests, displays structured errors, and never decides authorization or attendance eligibility locally.

### Authentication
Firebase Auth handles sign-in and token issuance. A server-side user profile stores the application role. Functions verify the Firebase ID token on every protected request.

### API and business logic
Cloud Functions own session-window checks, enrollment checks, duplicate prevention, summaries, overrides, audit records, and event creation. Direct client writes to attendance, audit, and webhook collections are denied by Firestore rules.

### Firestore
Firestore stores the MVP entities and supports transactional attendance commands. A denormalized `courseId` on attendance records enables scoped queries and avoids exposing unrelated course data.

### Webhook worker
Attendance commands create a durable webhook event with an idempotency key. A worker sends the minimal payload, records success/failure, and retries transient failures with bounded exponential backoff. Permanent failures remain visible to admins.

## 4. Request Flows

### Mark attendance
1. Client sends an authenticated request containing `sessionId` and an idempotency key.
2. Function verifies token, role, enrollment, session ownership of the course, and server time window.
3. Function runs a Firestore transaction.
4. If the logical attendance record already exists, it returns the existing result without creating a second record.
5. Otherwise it creates attendance, audit metadata, and a webhook event with the same transaction where practical.
6. Client receives `{ success, data, error }`.

### Override attendance
1. Instructor/admin submits attendance ID, new status, reason, and idempotency key.
2. Function verifies course ownership or admin role.
3. Function updates the record and writes an audit log in one transaction.
4. Function creates an update event for webhook delivery.

### Read summary
Functions verify that the requester is the student owner, course instructor, or admin before querying. Student responses contain only the requester's records; instructor responses contain only their course scope.

## 5. Firestore Data and Rules

- `users/{uid}`: profile and role; users may read their own profile, admins may manage roles.
- `courses/{courseId}`: course metadata; instructors may manage their own courses.
- `courses/{courseId}/enrollments/{uid}`: enrollment; students may read their own entry.
- `courses/{courseId}/sessions/{sessionId}`: session metadata; course owner/admin may write.
- `attendance/{attendanceId}`: server-managed; client direct writes are denied.
- `auditLogs/{auditId}` and `webhookEvents/{eventId}`: server-managed; admin read only as needed.

Rules are defense in depth, not a replacement for function-level authorization. Queries must be scoped by course or user identity; no client endpoint returns unrestricted attendance data.

## 6. API Contract

All endpoints return:

```json
{ "success": true, "data": {}, "error": null }
```

Error responses use stable codes such as `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_ENROLLED`, `SESSION_INACTIVE`, `DUPLICATE_ATTENDANCE`, `INVALID_STATUS`, and `WEBHOOK_DELIVERY_FAILED`.

Required operations:

| Method | Path | Permission |
|---|---|---|
| POST | `/api/sessions` | Course instructor/admin |
| GET | `/api/courses/:courseId/sessions` | Enrolled student or course instructor/admin |
| POST | `/api/attendance/mark` | Enrolled student |
| GET | `/api/students/:studentId/attendance-summary` | Same student or admin |
| GET | `/api/sessions/:sessionId/attendance-summary` | Course instructor/admin |
| PATCH | `/api/attendance/:attendanceId` | Course instructor/admin |
| POST | `/api/webhooks/attendance` | Internal worker or signed external request only |

## 7. Reliability and Security

- Use Firestore transactions and a unique logical attendance key to handle concurrent submissions.
- Use server timestamps for `markedAt`; never trust client time.
- Require idempotency keys for mutation commands and store command results where needed.
- Keep webhook payloads to event ID, session ID, student reference, status, and timestamp; do not include email unless required.
- Verify webhook signatures for inbound integrations and keep secrets in Firebase environment configuration.
- Apply bounded retries with exponential backoff and alert on repeated failures.
- Log authorization failures and business errors without logging tokens or unnecessary personal data.
- Configure retention for audit and webhook records according to academic policy.

## 8. Deployment and Operations

- Development uses Firebase Emulator Suite and local React tooling.
- CI runs linting, unit tests, integration tests against emulators, and a production build.
- Production uses Firebase Hosting, Auth, Firestore, and Functions in one project.
- Environment configuration contains project IDs, webhook URL, and signing secret; secrets are never committed.
- Monitoring tracks function errors, latency, rejected authorization, duplicate attempts, and webhook delivery status.

## 9. Trade-offs

Firebase minimizes infrastructure work and is appropriate for the expected MVP scale, but introduces vendor lock-in and Firestore query/index constraints. The team accepts this because the core workflow is document-oriented, the project has a zero-budget constraint, and a single managed platform reduces deployment complexity. If reporting becomes relational or cross-course analytics becomes central, a future migration to PostgreSQL should be evaluated rather than prematurely added to the MVP.

## 10. Architecture Readiness

Status: **READY WITH CHANGES**. The architecture is implementable after the required security rules, transaction tests, webhook retry worker, and Firebase-only configuration are completed.
