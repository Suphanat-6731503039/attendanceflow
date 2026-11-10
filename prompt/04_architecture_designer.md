Act as a senior software architect.

Design an architecture for this platform.

Here are the requirements:

Record attendance securely and surface useful attendance summaries.
Deliver 3 core screens for the main user journey.
Provide at least 6 REST API operations and document the shared contract.
Publish one inter-team webhook; include an AI-assisted flow and a deterministic fallback.
Write at least 7 automated tests for essential paths and validation.

Here is the data model:

[data model]

Constraints:

- University student project
- 3-5 developers
- One semester
- Budget = 0 THB
- Must deploy using free-tier services
- Keep architecture simple
- Do not introduce microservices unless clearly necessary

Consider these deployment options:

1. Vercel + Supabase
2. Cloudflare Workers + D1
3. Firebase

For each option explain:

- Frontend
- Backend/API
- Database
- Authentication
- Storage
- Deployment
- Advantages
- Disadvantages
- Major risks

Finally recommend ONE architecture
and explain why it is appropriate.

Prefer simplicity over theoretical scalability.