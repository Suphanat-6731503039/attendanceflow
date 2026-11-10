# AttendanceFlow — Final Project Presentation

> **SE MFU · 2026 PlatformDev · Mini Project Final Presentation**<br>
> **Project:** AttendanceFlow — Class Attendance and Enrollment Integration<br>
> **Deployment:** [attendanceflow.pages.dev](https://attendanceflow.pages.dev)<br>
> **Presentation date:** 10 November 2026<br>
> **Team:** Team 07 Attendance

This document maps the project to all eight final-presentation requirements. It describes the deployed system and distinguishes implemented features from integrations that still need partner-side verification.

## Project overview

AttendanceFlow is a web application for managing classes, student rosters, schedules, attendance, and reports. It provides separate workflows for administrators, professors, and students. Cloudflare Pages hosts the application and API, Cloudflare D1 stores application data, and a scheduled Cloudflare Worker retries partner events.

The application is designed to exchange enrollment and attendance information with UniEnroll without directly accessing UniEnroll's database. Attendance evidence uses check-in time and optional browser location; photo upload and R2 storage are intentionally not part of the deployed design.

## 1. Complete & Cloud Deploy

### Production components

| Component | Deployment |
|---|---|
| Web application and Pages Functions | Cloudflare Pages project `attendanceflow` |
| Public application URL | [https://attendanceflow.pages.dev](https://attendanceflow.pages.dev) |
| Application database | Cloudflare D1 database `attendanceflow-app` |
| Integration retry service | Cloudflare Worker `attendanceflow-integration` |
| Retry schedule | Every minute |

The production routes `/Admin`, `/student`, `/professor`, and `/api/auth/status` were checked and returned HTTP 200 after deployment.

### Deploy or update

Requirements: Node.js/npm, Wrangler, and an authenticated Cloudflare account with access to the project.

```bash
npm install
npm run build
npx wrangler d1 migrations apply attendanceflow-app --remote
npm run pages:deploy
npm run integrations:deploy
```

Configure partner credentials as Cloudflare secrets, not in source files or client-side code. See [README_APP.md](./README_APP.md) for the variable names and setup details. Verify secret **names** in Cloudflare without copying or sharing their values.

## 2. Demo Features & Happy Path

### Roles and workflows

- **Admin (`/Admin`)** — manage the shared workspace, student directory, attendance sessions, reports, invitations, and data backups.
- **Professor (`/professor`)** — create classes and schedules, manage or invite a class roster, review attendance status, and inspect an individual student's check-in time and available location evidence.
- **Student (`/student`)** — view their linked schedule and attendance history, then check in only for a class scheduled for today and only between its start and end times.

There are 10 student accounts and 2 professor accounts prepared for the demonstration. Do not publish account passwords; use the credentials supplied separately to authorized presenters and change temporary passwords before continued use.

### Suggested live demonstration

1. Sign in as a professor and create a class with a course code, section, room, date, and start/end time.
2. Add or invite students to the class roster. If the partner service is unavailable, use the prepared local roster for the attendance demonstration.
3. Sign in as a student and show today's class and the check-in time window.
4. Check in during the scheduled window. Show that the record contains a timestamp and optional browser location, not a photo.
5. Return to the professor view and open the student's attendance details.
6. Open the admin view to show shared attendance records, reporting/export, and backup controls.

The student check-in time restriction is enforced by the server, not just by hiding a button in the browser.

## 3. Integrate with at Least One Group (API / Webhook)

### Integration design

AttendanceFlow integrates with UniEnroll through authenticated HTTP APIs and signed webhooks:

| Direction | Endpoint | Purpose |
|---|---|---|
| AttendanceFlow → UniEnroll | `GET /api/partner/enrollments` | Request the active roster for a course/section |
| UniEnroll → AttendanceFlow | `POST https://attendanceflow.pages.dev/api/webhooks/receive` | Receive signed enrollment or schedule events |
| AttendanceFlow → UniEnroll | `POST /api/webhooks/incoming` | Deliver `attendance.recorded` events |

Roster requests send the partner key in `X-Partner-Key` and, when required, the partner identifier in `X-Partner-Id`. Incoming enrollment webhooks use `X-UniEnroll-Signature: sha256=<HMAC-SHA256>` over the exact request body. Attendance deliveries use `X-Webhook-Secret` and an `Idempotency-Key` equal to the event ID.

Enrollment events supported by the receiver include `enrollment.created`, `enrollment.swapped`, `enrollment.dropped`, `enrollment.changed`, and `schedule.changed`.

### Current integration status — 10 November 2026

- The Pages and Worker secret **names** are configured in Cloudflare.
- The roster endpoint is implemented and deployed. The latest live request returned **401 Unauthorized** from UniEnroll, so roster synchronization is **not currently confirmed working**. UniEnroll's operator must verify the issued partner key and partner ID for this project.
- The signed webhook receiver, event deduplication, attendance outbox, and scheduled retry flow are implemented.
- Earlier integration test evidence recorded successful webhook receipt/deduplication and attendance delivery. Re-run a partner-approved end-to-end test after the current credentials and partner identity have been confirmed.

Do not describe live roster synchronization as successful until the authenticated roster request returns a successful response and the imported roster is verified in a class.

## 4. Development Process & AI

### Development workflow

1. Translate the project requirements into role-based flows and API/data requirements.
2. Implement the React user interface, Pages Functions API, D1 schema/migrations, and scheduled integration Worker.
3. Build and validate locally, then deploy the Pages application and integration Worker to Cloudflare.
4. Verify production routes, authentication, attendance flows, and partner integration responses.
5. Record known limitations and update the documentation before presenting.

### Tools and AI assistance

- **Frontend:** React, Vite, and Lucide icons.
- **Backend/platform:** Cloudflare Pages Functions, D1, Wrangler, and a scheduled Worker.
- **AI assistance:** used as a coding assistant for implementation, debugging, test planning, and documentation. Generated changes were reviewed and build/runtime checks were used; AI output is not treated as proof that a feature works.
- **Version control:** GitHub repository [Suphanat-6731503039/attendanceflow](https://github.com/Suphanat-6731503039/attendanceflow).

## 5. Security & PDPA

### Safeguards implemented

- Passwords are stored as derived hashes using PBKDF2-SHA-256, not as plaintext.
- Session and invitation/setup tokens are stored as hashes; the session cookie is HTTP-only, SameSite=Lax, and Secure when served over HTTPS.
- Server-side role checks protect privileged routes. Check-in, student, professor, and admin actions are validated by the API.
- Webhook signatures are verified using HMAC; comparison is performed without an early-exit string comparison.
- Request bodies and key fields are validated, and API responses are marked `Cache-Control: no-store`.
- Partner credentials stay in Cloudflare secrets and are not included in the frontend bundle.
- The app does not collect or store attendance photos and does not require R2.

### Personal-data handling

Attendance data may include student identifiers, class records, timestamps, and optional location coordinates. Access is limited by account role and linked student identity. Authorized administrators can export or restore workspace backups; backups therefore contain personal data and must be kept in an access-controlled location.

This is a technical privacy summary, not a claim of legal certification or complete PDPA compliance. The institution/operator should define and communicate the lawful purpose, retention/deletion period, data-subject request process, backup handling, and incident-response contact before using the system with real students. Avoid collecting location during a demo unless needed.

## 6. Testing & Quality Assurance

### Checks performed

- `npm run build` — passed for the deployed application.
- JavaScript syntax checks for the API and partner integration modules — passed.
- Production route checks for `/Admin`, `/student`, `/professor`, and `/api/auth/status` — HTTP 200.
- Account checks were performed for the prepared student and professor accounts.
- Webhook tests documented acceptance and duplicate-event handling.
- Live enrollment roster request — **failed with 401 from UniEnroll**; this remains an integration blocker, not a passing test.

### Demo acceptance checklist

- [ ] Admin, professor, and student can sign in using authorized demo accounts.
- [ ] Professor can create a class and manage its roster.
- [ ] Student sees only their linked classes and can check in only during the scheduled class window.
- [ ] A repeated check-in request with the same idempotency key does not create a second attendance record.
- [ ] Professor can inspect the student's recorded attendance details.
- [ ] A repeated webhook `event_id` does not enqueue the same event twice; reuse with a different payload is rejected.
- [ ] UniEnroll roster sync returns success after the partner confirms the correct credentials and partner ID.
- [ ] Admin can export a report and download a workspace backup.

## 7. Explain Code, Modify & Redeploy

### Repository map

| Path | Responsibility |
|---|---|
| `src/App.jsx` | Admin, professor, student, login, and workspace user interface |
| `src/lib/cloudAttendanceApi.js` | Browser-to-API client |
| `src/lib/attendanceDataValidation.js` | Client-side workspace data validation |
| `functions/api/[[path]].js` | Authentication, authorization, attendance, workspace, and API routes |
| `functions/lib/partnerIntegration.js` | Enrollment requests, webhook signature checks, inbox/outbox, retry, and reconciliation |
| `worker/partner-dispatcher.js` | Scheduled processing of due integration work |
| `migrations/` | D1 schema migrations |
| `wrangler.toml` | Pages output and D1 binding |
| `wrangler.integration.toml` | Integration Worker entry point, schedule, and D1 binding |

### Change and redeploy

For frontend/API/schema changes, update the relevant source and migration, then run:

```bash
npm run build
npx wrangler d1 migrations apply attendanceflow-app --remote
npm run pages:deploy
```

Only apply migrations when new migration files are part of the change. For scheduled Worker changes:

```bash
npm run integrations:deploy
```

After deployment, verify the affected route and workflow in production. Keep secrets out of commits, screenshots, terminal logs, and chat messages.

## 8. Final Evaluation & Full Attendance

### Evaluation summary

| Evaluation area | Status |
|---|---|
| Complete web application and Cloudflare deployment | **Deployed** |
| Admin, professor, and student demonstration flows | **Implemented** |
| Attendance window enforcement and professor detail view | **Implemented** |
| API/webhook integration architecture | **Implemented** |
| Live UniEnroll roster synchronization | **Needs partner credential/ID verification (401)** |
| Security controls and privacy-aware photo-free design | **Implemented; operational privacy policies still required** |
| Build and production route checks | **Passed** |
| Final end-to-end demonstration | **Ready with a local/prepared roster; repeat partner integration checks after 401 is resolved** |

### Attendance demonstration evidence

For the final evaluation, demonstrate a complete path: class schedule → student check-in → professor review. Use the prepared class roster if UniEnroll is still returning 401. Record the evaluator's required attendance evidence separately; this application does not represent that every class member attended the project presentation.

### Known limitations and next steps

1. Ask UniEnroll to verify the current `X-Partner-Key` and `X-Partner-Id` values for the AttendanceFlow partner.
2. Re-test `GET /api/partner/enrollments` and complete a roster sync into a class.
3. Re-run signed enrollment-webhook and attendance-delivery tests with the partner and retain sanitized evidence.
4. Agree on retention, deletion, backup, and data-subject request procedures with the institution before broader deployment.
