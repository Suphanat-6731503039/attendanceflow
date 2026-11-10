# Product Requirements Document

## 1. Product Overview

### Product Name
AttendanceFlow

### Problem Statement
Universities often use paper sheets or ad hoc spreadsheets to track attendance. This causes missing or duplicate records, delayed summaries, and limited transparency for students and instructors. AttendanceFlow provides one secure workflow for recording attendance during a class session and reviewing the result immediately.

### Target Users
- Students attending university courses
- Instructors managing course sessions and attendance
- Teaching assistants or course coordinators reviewing summaries
- Administrators managing access, enrollment, and exceptional corrections

### Product Goal
Enable an enrolled student to submit attendance once during a valid session window and enable authorized staff to review, correct, and report attendance reliably.

### Assumptions
- MVP serves a small number of courses and students.
- Each course has one instructor owner, with optional admin support.
- Users authenticate with university email or an approved internal account.
- Attendance is recorded during class or within a short grace period.
- MVP is not an LMS replacement and does not use biometric or location tracking.

## 2. Scope

### In Scope (MVP)
- Email authentication and role-based access for student, instructor, and admin.
- Course and enrollment management.
- Instructor creation of sessions with start/end times.
- Student attendance marking for enrolled students during the active window.
- Duplicate prevention and idempotent attendance requests.
- Student personal attendance history and summary.
- Instructor session/course summaries with present, absent, late, and excused statuses.
- Authorized attendance override with a required reason and audit record.
- One webhook event for attendance creation or update, including retry logging.
- Structured API errors and basic operational logging.

### Out of Scope / Future Improvement
- Face recognition, biometrics, GPS, and geofencing.
- Predictive analytics, grading, payroll, and financial integration.
- Multi-campus or multi-institution integration.
- Full LMS replacement.
- Offline capture, QR check-in, advanced exports, and push notifications.

## 3. Actors and Permissions

| Actor | Goal | Main actions | Access boundary |
|---|---|---|---|
| Student | Record and understand personal attendance | View enrolled courses, active sessions, mark attendance, view own summary | Own attendance and enrolled course metadata |
| Instructor | Run sessions and monitor participation | Create sessions, view course summaries, override records with reason | Courses they own and their enrolled students |
| Admin | Maintain platform integrity | Manage users, roles, enrollments, courses, and exceptional corrections | All platform data required for administration |
| Webhook worker | Notify downstream integration | Deliver attendance events, retry failures, record delivery status | Event payloads and delivery metadata only |

## 4. Core User Journey

| Step | User action | System response | Data / rule | Possible failure |
|---:|---|---|---|---|
| 1 | Student signs in | Authenticates and loads enrolled courses | Auth identity and role | Invalid credentials |
| 2 | Student opens an active session | Shows session status and attendance action | Enrollment and session window | Session is closed or user is not enrolled |
| 3 | Student submits attendance | Validates and writes one record | Unique `(session_id, student_id)` and server time | Duplicate, invalid window, or database failure |
| 4 | Student receives result | Shows confirmed status | Attendance record | Network timeout after successful write |
| 5 | Instructor opens summary | Shows present, absent, late, and excused counts | Course ownership and attendance status | Unauthorized access or stale data |
| 6 | System emits event | Queues webhook delivery and records outcome | Outbox/event record and retry policy | External endpoint unavailable |

## 5. Functional Requirements

### FR-01 - Session creation
The system shall allow an instructor or admin to create a session with course, title, start time, end time, and optional location.

### FR-02 - Attendance marking
The system shall allow an enrolled student to submit attendance only while the session is active or within the configured grace period.

### FR-03 - Duplicate prevention
The system shall enforce at most one active attendance record per `(session_id, student_id)` and return a stable duplicate response for repeated requests.

### FR-04 - Attendance summary
The system shall provide authorized instructors and admins with session and course summaries by attendance status.

### FR-05 - Student personal view
The system shall allow students to view only their own attendance history and summary for enrolled courses.

### FR-06 - Role-based access
The system shall authenticate every protected request and enforce role, course ownership, enrollment, and record ownership checks on the server.

### FR-07 - Attendance override
The system shall allow an instructor or admin to change a record only with sufficient permission and a non-empty reason.

### FR-08 - Attendance event webhook
The system shall create a durable event when attendance is created or updated and retry failed deliveries without creating duplicate business records.

### FR-09 - Shared API contract
The system shall return `{ success, data, error }` for all API responses, with stable machine-readable error codes.

### FR-10 - Auditability and retention
The system shall retain attendance records, override reasons, audit events, and webhook delivery status for the academic operating period.

## 6. Non-Functional Requirements

- **NFR-01 Performance:** Main attendance screens should load within 3 seconds on a normal university connection for MVP scale.
- **NFR-02 Security:** Authentication, server-side authorization, validation, and least-privilege data access are mandatory.
- **NFR-03 Availability:** Target 99% uptime during the class schedule for MVP deployment.
- **NFR-04 Cost:** Production must run on free-tier services without requiring paid billing.
- **NFR-05 Maintainability:** A team of 3-5 student developers must be able to test, deploy, and understand the system in one semester.
- **NFR-06 Observability:** Log invalid requests, authorization failures, webhook failures, and critical business errors without logging unnecessary personal data.
- **NFR-07 Accessibility:** Core flows must be keyboard usable, have clear labels, and remain usable on mobile screens.

## 7. Business Rules

- **BR-01:** A student may have one attendance record per session.
- **BR-02:** The server, not the client clock, determines whether a session is active.
- **BR-03:** Only an enrolled student may mark attendance.
- **BR-04:** Only the course owner or an admin may create sessions and view class-level attendance.
- **BR-05:** Status must be `present`, `absent`, `late`, or `excused`.
- **BR-06:** Post-submission changes require instructor/admin permission and a reason.
- **BR-07:** Session end time must be later than start time.
- **BR-08:** Course code, enrollment, and attendance identities must be unique where specified by the data model.

## 8. Data Model

### Collections
- **users/{userId}:** full name, email, role, account status, timestamps.
- **courses/{courseId}:** code, name, term, instructorId, timestamps.
- **courses/{courseId}/enrollments/{userId}:** status and enrolledAt.
- **courses/{courseId}/sessions/{sessionId}:** title, startTime, endTime, status, location, createdBy.
- **attendance/{attendanceId}:** sessionId, courseId, studentId, status, markedAt, markedBy, overrideReason, timestamps.
- **webhookEvents/{eventId}:** eventType, attendanceId, payload reference, status, attempts, nextAttemptAt, sentAt, errorMessage.
- **auditLogs/{auditId}:** actorId, action, resourceType, resourceId, reason, timestamp.

### Integrity constraints
- Unique logical key for attendance: `(sessionId, studentId)`.
- Unique enrollment: `(courseId, userId)`.
- Foreign references must point to existing course, session, and user records.
- Attendance status is validated against the allowed set.
- Attendance writes and event creation use a transaction or idempotent server operation.

### Data not stored
National IDs, payment data, biometric data, classroom camera footage, and unrelated health notes.

## 9. Acceptance Criteria

- [ ] A student can sign in and see only enrolled courses.
- [ ] An instructor can create a valid session with `endTime > startTime`.
- [ ] An enrolled student can mark attendance only in the valid server-side window.
- [ ] Repeated or concurrent submissions produce one attendance record.
- [ ] A student cannot read another student's attendance.
- [ ] An instructor cannot manage a course they do not own.
- [ ] Overrides require authorization and a reason and are auditable.
- [ ] Summaries show counts by status and do not expose unauthorized records.
- [ ] Attendance changes create a webhook event and failed delivery is retried and logged.
- [ ] Automated tests cover validation, permissions, duplicate/concurrent writes, and webhook failure.

## 10. Constraints and Risks

- Team size: 3-5 developers; delivery time: one semester; budget: 0 THB.
- Free-tier quotas and cold starts may affect peak class-time performance.
- Client connectivity may time out after a successful write; the API must support safe retry/query.
- Webhook destinations may be unavailable; delivery must be asynchronous and observable.
- Personal attendance data requires careful rules, minimal payloads, and access logging.

## 11. MVP Priority

1. Authentication, roles, courses, and enrollment.
2. Session creation and secure attendance marking.
3. Student and instructor summaries.
4. Override audit trail.
5. Webhook delivery, retries, and operational logs.
