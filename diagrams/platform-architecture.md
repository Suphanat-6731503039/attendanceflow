# AttendanceFlow Platform Architecture

```mermaid
flowchart TD
    U[Student or Instructor Browser] --> H[Firebase Hosting]
    H --> R[React Web App]
    R --> A[Firebase Authentication]
    R --> F[HTTPS Cloud Functions API]
    A --> F
    F --> V[Validation and Authorization]
    V --> T[Firestore Transaction]
    T --> D[(Firestore)]
    D --> E[Webhook Event Record]
    E --> W[Cloud Functions Webhook Worker]
    W --> X[External Webhook Destination]
    W --> D

    D --- C[Users, Courses, Enrollments, Sessions, Attendance, Audit Logs]
```

## Trust Boundaries

1. The browser is untrusted and cannot determine role, time eligibility, or ownership.
2. Cloud Functions verify identity and enforce business rules before mutations.
3. Firestore rules deny direct writes to server-managed attendance, audit, and webhook collections.
4. The webhook worker sends only the minimum required payload and records delivery status.
