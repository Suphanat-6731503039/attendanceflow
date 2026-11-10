# Product Requirements Document

## 1. Product Overview

### Product Name
AttendanceFlow

### Problem Statement
Universities still rely on manual attendance tracking, such as paper sheets, sign-in sheets, or ad hoc spreadsheets. This creates errors, missing records, delayed summaries, and weak transparency for both instructors and students. Students often do not know whether they have been marked present, and instructors spend time reconciling attendance after class.

### Target Users
- Students attending classes
- Lecturers / instructors managing class attendance
- Course coordinators or teaching assistants who need summary reporting
- Academic staff responsible for attendance compliance

### Product Goal
Create a simple, secure attendance system that allows students to record attendance for a class session and gives instructors a clear summary of present/absent status without requiring complex enterprise software.

### Assumptions
- The platform will be used in a university setting with a small number of students per course.
- Each course has a defined session schedule and a single instructor or course owner.
- Identity is verified through university email or a simple internal account system.
- Attendance is recorded during or shortly after a class session, not through full biometric systems.
- The MVP is not intended to replace a full LMS or enterprise academic management platform.

---

## 2. Scope

### In Scope
- Student attendance marking for a class session
- Course-based session management
- Instructor dashboard for attendance records and summaries
- Basic student attendance visibility for their own course status
- One inter-team webhook notification for attendance events
- Secure role-based access for students, instructors, and admins
- Basic attendance summary reports for the current course or session

### Out of Scope
- Face recognition or biometric verification
- GPS/physical geofencing enforcement
- Advanced analytics or predictive attendance forecasting
- Multi-campus integration with multiple institutions
- Full LMS replacement
- Payroll, financial, or grading integration beyond attendance tracking
- Large-scale real-time collaboration features

---

## 3. User Roles

### Student
- Views their enrolled courses and attendance sessions
- Marks attendance for active sessions
- Views personal attendance summary for a course
- Cannot modify another student's attendance record without authorization

### Instructor
- Creates and manages course sessions
- Marks or overrides attendance for students when necessary
- Views summary reports for class participation
- Receives attendance-related alerts or summaries

### Admin
- Manages users, course assignments, and access policies
- Reviews attendance anomalies and resolves issues
- Maintains system configuration and permissions

---

## 4. User Journey

### Main Journey
1. Instructor creates or opens a course session for a class.
2. Students log in and open the active session in the course.
3. Students submit attendance using the permitted method for that session.
4. The system validates the student, session, and timing.
5. The instructor reviews attendance summary and identifies who is present, absent, or late.
6. The system emits a webhook event for downstream integration or notifications.

---

## 5. Functional Requirements

### FR-01: Session creation
The system shall allow an instructor to create a class session with a course, date, start time, end time, and optional session status.

### FR-02: Attendance marking
The system shall allow an enrolled student to submit attendance for an active session only within the allowed attendance window.

### FR-03: Duplicate prevention
The system shall prevent duplicate attendance submissions for the same student in the same session.

### FR-04: Attendance summary
The system shall provide an instructor with an attendance summary for each session and each course, including present, absent, and late counts.

### FR-05: Student personal view
The system shall allow a student to view their own attendance history and current summary for each course.

### FR-06: Role-based access
The system shall restrict access so that students can only view their own status and instructors/admins can manage course-level data.

### FR-07: Attendance status override
The system shall allow an instructor or admin to correct attendance status when a legitimate exception occurs.

### FR-08: Event webhook
The system shall publish a webhook event when a student's attendance record is created or updated.

### FR-09: Shared API contract
The system shall expose REST endpoints with a consistent response structure of success, data, and error details.

### FR-10: Basic data retention
The system shall retain attendance records and summaries for the duration required by academic operations and system usage.

---

## 6. Non-Functional Requirements

### NFR-01 Performance
The UI shall load the main attendance screens in under 3 seconds on a normal university network connection for the targeted MVP usage.

### NFR-02 Security
Authentication and authorization must be enforced on all sensitive actions, and data access must be restricted by role and ownership.

### NFR-03 Availability
The system should remain available during a university class schedule, with a target of 99% uptime for the MVP deployment.

### NFR-04 Cost
The system must remain within a zero-deployment-budget constraint and prefer free-tier services and low-cost hosting.

### NFR-05 Maintainability
The system must be simple to understand, test, and deploy by a team of 3–5 student developers in one semester.

### NFR-06 Observability
The app must log invalid requests, authorization failures, and critical business errors for debugging and support.

---

## 7. Business Rules

### BR-01: One attendance submission per student per session
A student may submit attendance only once for a given session unless an authorized user overrides it.

### BR-02: Attendance must fall within session time
Attendance can only be recorded during the session's active window or a defined short grace period.

### BR-03: Only enrolled students may mark attendance
A user cannot mark attendance for a course they are not enrolled in.

### BR-04: Instructor is course owner
Only the instructor or designated admin for a course can create sessions and manage the course attendance summary.

### BR-05: Attendance statuses are constrained
Attendance status must be one of: Present, Absent, Late, or Excused, as defined by MVP requirements.

### BR-06: Override requires authorization
Attendance changes after submission require an instructor/admin action with a reason or note.

---

## 8. Data Model

### User
Important fields:
- id
- full_name
- email
- role (student | instructor | admin)
- status
- created_at
- last_login_at

Relationships:
- One user can have many enrollments
- One user can own many sessions
- One user can have many attendance records

Who can create/read/update/delete it:
- User self-registers and updates their own profile
- Admin manages roles and status
- Instructor may read course-related user data only when necessary

### Course
Important fields:
- id
- code
- name
- term
- instructor_id
- created_at

Relationships:
- One course has many sessions
- One course has many enrollments

Who can create/read/update/delete it:
- Instructor creates and manages their own courses
- Admin can support or correct course ownership
- Students read course metadata only for enrolled courses

### Enrollment
Important fields:
- id
- user_id
- course_id
- enrolled_at
- status

Relationships:
- Many enrollments belong to one user
- Many enrollments belong to one course

Who can create/read/update/delete it:
- Admin or instructor manages enrollment records
- Students read only their own enrollment entries

### Session
Important fields:
- id
- course_id
- title
- start_time
- end_time
- created_by
- status
- location (optional)

Relationships:
- One course has many sessions
- One session has many attendance records

Who can create/read/update/delete it:
- Instructor can create/edit their course sessions
- Admin can manage session integrity
- Students read active or completed session information for enrolled courses

### AttendanceRecord
Important fields:
- id
- session_id
- student_id
- status (present | absent | late | excused)
- marked_at
- marked_by
- override_reason
- created_at
- updated_at

Relationships:
- Many attendance records belong to one session
- Many attendance records belong to one student

Who can create/read/update/delete it:
- Student creates their own attendance when eligible
- Instructor/admin updates or overrides records
- Students read only their own attendance records
- Admin may delete records only in exceptional cases with audit trail

### WebhookEvent
Important fields:
- id
- event_type
- payload
- status
- retries
- sent_at
- error_message

Relationships:
- One attendance record may trigger one or more event records

Who can create/read/update/delete it:
- System creates it automatically
- Admin reads and monitors it
- System may retry or mark failed sends

### Data that should NOT be stored
- Full national ID or passport details
- Facial biometric data
- Payment or banking data
- Sensitive personal notes unrelated to attendance
- Raw classroom camera footage

### Sensitive data
- Email addresses and student IDs
- Course enrollment data
- Attendance records tied to an individual student
- Override reasons that could include personal health or disability information

### Potential duplicate or inconsistent data
- Duplicate enrollment entries for the same student and course
- Multiple marks for one session by the same student
- Instructor typing different course codes or names for the same course
- Manual override without proper audit log

### Important database constraints
- Unique constraint on (session_id, student_id) for attendance if only one active record is allowed per session
- Foreign keys for course_id, instructor_id, student_id, session_id
- Allowed status values restricted to enum or validation list
- Session end time must be greater than start time
- Enrollment unique constraint on (user_id, course_id)

---

## 9. Architecture

### Architecture Overview
The recommended MVP architecture is a simple web application using React for the frontend, Firebase Auth for identity, Firestore for persistence, and Firebase Functions for backend logic and webhook processing. This keeps the system easy to implement, low-cost, and realistic for a student team. The app will support course sessions, attendance marking, summaries, and one attendance webhook event.

### Architecture Diagram

```text
Browser / Mobile
      |
      v
React Frontend
      |
      +--> Firebase SDK client logic
      |
      v
Firebase Auth
      |
      v
Firestore
      |
      +--> Users
      +--> Courses
      +--> Enrollments
      +--> Sessions
      +--> Attendance records
      |
      +--> Cloud Function / HTTP endpoint
                    |
                    v
              Webhook sender / external integration
```

### Components

#### Frontend
- React app for login, course list, attendance page, instructor dashboard
- Simple UI for students and instructors
- Minimal state management for MVP

#### Backend
- Firebase Functions for API logic, attendance validation, and summary generation
- Optional HTTP endpoint for webhook delivery
- Business logic centralized in serverless functions

#### Database
- Firestore for users, courses, enrollments, sessions, attendance, and webhook logs
- Document-based schema for MVP simplicity
- Firestore security rules enforce role-based and ownership-based access

#### Authentication
- Firebase Auth for email-based sign-in and role-based access control
- Use basic user roles: student, instructor, admin

#### Storage
- Not required for core MVP beyond optional profile image or documents
- Keep storage minimal; avoid storing user documents unless required

#### External Services
- Single webhook destination for attendance events
- Optional Firebase Cloud Messaging or email-based notifications only if required for essential alerts

---

## 10. Technology Stack

| Layer | Technology | Reason |
|---|---|---|
| Frontend | React | Familiar UI framework and easy to build for a small student team |
| Backend | Firebase SDK / Functions | Simple serverless logic and minimal infrastructure overhead |
| Database | Firestore | Free-tier friendly and straightforward for attendance data models |
| Auth | Firebase Auth | Simple user login and access control with low setup effort |
| Hosting | Firebase Hosting | Free-tier friendly and lightweight deployment for a student MVP |
| Webhook | Firebase Function + HTTP webhook | Minimal implementation for the required inter-team integration |

---

## 11. API / Interfaces

### Shared API Contract
All REST APIs will follow a common response format:

```json
{
  "success": true,
  "data": {},
  "error": null
}
```

If a request fails:

```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "INVALID_SESSION",
    "message": "This session is not currently active."
  }
}
```

### API-01: Create session
POST /api/sessions
- Creates a new class session
- Requires instructor/admin permission

### API-02: Get course sessions
GET /api/courses/:courseId/sessions
- Returns sessions for a course

### API-03: Mark attendance
POST /api/attendance/mark
- Creates or updates an attendance record for the current student
- Validates student, course membership, and active time window

### API-04: Get own attendance summary
GET /api/students/:studentId/attendance-summary
- Returns a student's attendance summary for a course

### API-05: Get class attendance summary
GET /api/sessions/:sessionId/attendance-summary
- Returns who is present, absent, late, or excused

### API-06: Update attendance
PATCH /api/attendance/:attendanceId
- Allows instructor/admin to override or correct a record

### API-07: Webhook delivery
POST /api/webhooks/attendance
- Receives or emits an attendance event to an external system
- Includes event type, session id, student id, and status

---

## 12. Security

### Authentication
- All users must authenticate before accessing protected routes or APIs.
- Use email-based login via Supabase Auth.

### Authorization
- Students can only read and modify their own attendance records and summary for enrolled courses.
- Instructors can manage sessions and attendance for their assigned courses.
- Admins can manage course enrollment and system roles.

### Data Protection
- Sensitive attendance data must be protected by role-based access and database rules.
- All API routes must validate identity and permissions before any mutation.
- Webhook payloads must not include unnecessary personal information.
- Do not expose raw student records to unauthorized users.

---

## 13. Error Handling

### Expected Errors
- User is not enrolled in the course
- Session is not active
- Duplicate attendance submission
- Invalid attendance status
- Unauthorized role access
- Webhook delivery failure

### Failure Scenarios
- A student attempts to submit attendance after the session ends
- Instructor tries to override a record without permission
- Database write fails while creating attendance
- Network error occurs during webhook delivery
- External integration is temporarily unavailable

### Handling Approach
- Return structured API errors with clear error codes and messages.
- Prevent duplicate writes by transactional database checks.
- Retry webhook delivery a small number of times with logging.
- Log failures without exposing sensitive data in user-visible messages.

---

## 14. Deployment

### Development
- Local development via Next.js dev server
- Supabase project for dev database and auth
- Local environment variables for API keys and project URLs
- GitHub-based workflow for continuous integration

### Production
- Frontend deployed to Firebase Hosting
- Database and authentication hosted in Firebase project
- Environment variables managed in Firebase config and Cloud Functions
- One production webhook endpoint configured for external notification delivery

---

## 15. Constraints

- Budget: 0 THB deployment budget
- Time: one semester for MVP development
- Team: 3–5 student developers
- Free-tier services preferred
- Architecture should remain simple and avoid unnecessary enterprise complexity
- MVP scope should prioritize attendance recording and summaries over advanced analytics

---

## 16. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Duplicate attendance submissions | Inaccurate attendance records | Enforce unique constraint and validation checks |
| Unauthorized access | Data exposure | Role-based access and database-level security rules |
| Webhook delivery failure | Downstream system misses attendance updates | Retry logic and log failures |
| Session timing mismatch | Incorrect attendance state | Validate session start/end before marking |
| Instructor override abuse | Unreliable records | Require reason and audit trail |
| Database outage | Attendance save failure | Use transactional writes and clear error handling |

---

## 17. Acceptance Criteria

### MVP is complete when:

- [ ] Students can sign in and view their enrolled courses.
- [ ] Instructors can create a valid class session.
- [ ] Students can mark attendance once per session within the valid time window.
- [ ] Instructors can view attendance summaries by session and course.
- [ ] Duplicate attendance attempts are blocked.
- [ ] Role-based access prevents unauthorized access to attendance records.
- [ ] A webhook is emitted when an attendance change occurs.
- [ ] Automated tests cover critical attendance, validation, and permission flows.

---

## 18. Future Improvements

- Attendance analytics dashboard with trends across the term
- Late and excused status dashboard with better filters
- Offline attendance capture for unstable networks
- QR code session check-in for faster classroom use
- Integration with broader LMS or academic systems
- Export of attendance records to CSV or PDF

---

## 19. MVP Summary
This MVP is intentionally narrow and realistic: a secure attendance system for a university class, built by a small student team, deployed on free-tier infrastructure, and focused on core value creation. The platform records attendance, prevents duplicates, supports role-based access, surfaces summaries, and emits a single webhook event. It delivers clear business value without requiring advanced enterprise features or a large operational footprint.