# AttendanceFlow

AttendanceFlow manages attendance, class sessions, reports, and backups in its own workspace. Optional UniEnroll integration synchronizes enrollment rosters and attendance events through authenticated APIs and webhooks; the two systems retain separate databases.

## Run locally

```bash
npm install
npm run dev
```

The Vite server serves the frontend only. Cloud-backed authentication and attendance data require Cloudflare Pages Functions and the D1 binding in `wrangler.toml`.

## Cloudflare setup and deploy

The Pages project is `attendanceflow` at [https://attendanceflow.pages.dev](https://attendanceflow.pages.dev). The D1 database `attendanceflow-app` is dedicated to this app and is separate from the existing Enrollment database. Class images and slide files are stored in the `attendanceflow-materials` R2 bucket.

The Cloudflare Pages Functions are in `functions/api`. The durable webhook retry worker is deployed separately from `worker/partner-dispatcher.js`.

Create the materials bucket and apply the app's D1 schema before deploying:

```bash
npx wrangler r2 bucket create attendanceflow-materials
npx wrangler d1 migrations apply attendanceflow-app --remote
npm run pages:deploy
npm run integrations:deploy
```

D1 migrations add student-linked accounts, class-specific invitations, durable webhook inbox/outbox, request idempotency, and reconciliation records. Attendance check-in stores timestamp and location only; R2 is used only for instructor-provided class materials.

### UniEnroll integration

Configure these as Cloudflare secrets; do not put credentials in source code or `wrangler.toml`:

- Pages project `attendanceflow`: `UNIENROLL_PARTNER_TOKEN`, `UNIENROLL_PARTNER_ID` (if required by the partner), `UNIENROLL_SIGNATURE_SECRET`, and `UNIENROLL_WEBHOOK_SECRET`.
- Scheduled Worker `attendanceflow-integration`: `UNIENROLL_WEBHOOK_SECRET`.
- `UNIENROLL_API_BASE_URL` is optional and defaults to `https://unienroll-backend.team03-enrollment.workers.dev`. If the partner supplies a different base URL, configure the same HTTPS URL for Pages and the scheduled Worker.

Set secret values interactively:

```bash
npx wrangler pages secret put UNIENROLL_PARTNER_TOKEN --project-name attendanceflow
npx wrangler pages secret put UNIENROLL_PARTNER_ID --project-name attendanceflow
npx wrangler pages secret put UNIENROLL_SIGNATURE_SECRET --project-name attendanceflow
npx wrangler pages secret put UNIENROLL_WEBHOOK_SECRET --project-name attendanceflow
npx wrangler secret put UNIENROLL_WEBHOOK_SECRET --config wrangler.integration.toml
```

The partner token is sent in `X-Partner-Key`; the optional partner ID is sent in `X-Partner-Id`. These values must match the credentials issued for the UniEnroll `/api/partner/enrollments` endpoint. `UNIENROLL_SIGNATURE_SECRET` must match the sender's HMAC key; `UNIENROLL_WEBHOOK_SECRET` must be the receiver secret issued for `/api/webhooks/incoming`. If any previously shared credential was real, rotate it before deployment.

Integration routes:

- `GET /api/partner/enrollments?course_code=CS101&section_number=SEC01` proxies an authenticated roster request to UniEnroll. Only instructor/admin accounts may use it.
- `POST /api/partner/enrollments/sync` with `{ "sessionId": "..." }` imports the selected class roster. Set its course code and optional section when creating the class. Marked attendance history is retained if an enrollment is later removed.
- `POST /api/webhooks/receive` accepts signed enrollment events (`enrollment.created`, `enrollment.swapped`, `enrollment.dropped`, `enrollment.changed`, and `schedule.changed`). It verifies `X-UniEnroll-Signature: sha256=<HMAC-SHA256 of the exact raw body>`, deduplicates `event_id`, and queues processing.
- Student check-in writes attendance and its `attendance.recorded` event to D1 in the same revision-checked operation. Delivery to UniEnroll uses `POST /api/webhooks/incoming`, `X-Webhook-Secret`, and `Idempotency-Key: <event_id>`.
- Check-in requests require an `Idempotency-Key`; an identical retry replays the original response for 24 hours, while reuse with a different payload is rejected.
- The Pages request attempts delivery immediately with a four-second timeout and up to three exponential retries (1/2/4 seconds). D1 outbox/inbox records remain durable across runtime failures; the scheduled Worker retries due work every minute. Exhausted events enter reconciliation and can be retried from the instructor's Attendance view.

Configure UniEnroll to send enrollment webhooks to `https://<your-pages-domain>/api/webhooks/receive`. Verify the exact partner credential header, HMAC key, and event payload fields with the UniEnroll operator before enabling production traffic.

The login screen does not ask for a setup code. If no account exists yet, choose **First time here? Set up workspace** to open the separate first-administrator setup screen. The administrator needs a one-time setup code created by the deployment operator. The code is stored in D1 as a SHA-256 hash and expires; it is consumed when the first account is created. The administrator can then create 24-hour, one-time invite codes for instructors from **Data & backup**. New accounts require a password of at least 12 characters.

When a student already has a linked account but cannot sign in, an administrator can use **Professor view** to generate a single-use password-reset link from that student's class roster. The student opens the link and sets a new password; the link expires after 24 hours, and existing sessions for that student are revoked. The application does not send the link by email, so the administrator must share it directly.

For local Pages emulation, run `npm run pages:dev`. Wrangler emulates the D1 binding locally; configure a local D1 database and an unused setup token before testing first-time setup. Never use production student data in an unprotected local environment.

## Workflows

- Sign in, first-admin setup, one-time instructor invitations, admin-issued student password-reset links, and sign out.
- Students can register with email and password; their account remains pending until an administrator enrolls it in a class.
- Shared student directory; sync course rosters from UniEnroll, edit students, or archive them without removing attendance history. Admin class rosters support selecting multiple students at once.
- Professor portal at `/professor` to create classes and recurring weekly session blocks, attach text, HTTPS links, images, PDFs, or PowerPoint files, and review attendance evidence.
- Student portal at `/student` to view enrolled classes and upcoming weekly sessions and check in during the scheduled weekday/time with browser location.
- Create, open, close, reopen, and review class sessions with session-specific roster snapshots.
- Mark attendance present, late, absent, excused, or unmarked. Closing a session converts unmarked records to absent.
- Search and filter records, review historical reports, and export CSV.
- Download and restore validated JSON backups. Restoring replaces shared workspace data for all team members.
- Periodic shared-data refresh and revision checks to detect conflicting concurrent edits.

## Data and privacy

Cloudflare D1 stores account password hashes, hashed session/invitation/setup tokens, student-linked accounts, attendance timestamps and coordinates, the shared AttendanceFlow workspace, and durable integration event metadata. Attendance evidence consists of the check-in time and optional location; the app does not collect or store photos. Authentication uses HTTP-only, same-site session cookies; browser write endpoints require a same-origin request. UniEnroll integration uses server-side credentials and does not access the Enrollment database directly.

Download backups from **Data & backup** and keep them in a secure location. A JSON backup contains student details, attendance records, timestamps, and locations. The D1 workspace is limited to 1 MB per save.
