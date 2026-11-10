# Week 02 Platform Architecture Design Workshop

## Workshop purpose

This workshop takes each group from an approved project topic to an implementable, reviewed Product Requirements Document (PRD) and platform architecture.

The goal is not to choose the most fashionable technology. The goal is to make defensible design decisions: understand the problem, identify users, define requirements, design a simple platform, and test the design from multiple professional perspectives.

> **Start from the problem, not the technology.**

Do not begin with “Should we use Firebase, Supabase, or Cloudflare?” Begin with “Whose problem are we solving, what must the product do, and what constraints must it satisfy?”

## Learning outcomes

By the end of the workshop, students will be able to:

1. Turn a project topic into a clear product concept and MVP scope.
2. Distinguish functional requirements, non-functional requirements, business rules, and constraints.
3. Design a minimum data model and a simple platform architecture.
4. Explain why each architectural component is necessary.
5. Review a PRD critically through a designated delivery role.
6. Improve a design using evidence-based review feedback.

## Team structure and role rotation

Each group has already selected its project topic. Every member receives one role for this workshop. Roles must rotate in later activities so that every student practices more than one perspective during the course.

| Role | Primary review perspective |
|---|---|
| Product Manager | User problem, product value, scope, priorities, and acceptance criteria |
| Frontend UX/UI | User journeys, interaction states, accessibility, responsive experience, and usability |
| Backend API and Database | Business logic, API boundaries, data model, data integrity, and concurrency |
| Quality and Security | Testability, failure scenarios, authentication, authorization, validation, and risk |
| Delivery and Document | Feasibility, deployment, cost, documentation quality, dependencies, and release readiness |

### Role rotation rule

- Keep the assigned role for this workshop’s individual review.
- In future workshops, rotate roles so that no student repeatedly owns the same area.
- The group owns the final PRD together. A role reviewer identifies risks and proposes changes; the group decides and records the final decision.

## Timebox

Recommended duration: **3 hours 30 minutes**.

| Phase | Activity | Time |
|---|---|---:|
| 0 | Set up the team and roles | 10 min |
| 1 | Define the product problem and MVP | 30 min |
| 2 | Write requirements and rules | 35 min |
| 3 | Design data and platform architecture | 40 min |
| 4 | Select a feasible stack and write the PRD | 35 min |
| 5 | Role-based PRD review | 35 min |
| 6 | Consolidate decisions and submit | 25 min |

## Required deliverables

Each group submits the following in its repository:

```text
project/
├── PRD.md
├── architecture.md
├── role-reviews.md
└── diagrams/
    └── platform-architecture.png or platform-architecture.md
```

The final documents must be written in English.

---

## Phase 0 — Set up the team and roles (10 minutes)

### Step 0.1 — Create a working document

Create `PRD.md` and add the project name, group members, assigned roles, date, and selected topic.

### Step 0.2 — Agree on the workshop rule

Use AI as an **architecture copilot**, not an authority. AI may suggest ideas, but students must check every assumption and make the final decision.

Before accepting an AI suggestion, ask:

1. Is this supported by our project topic or requirement?
2. Can a student team build it in one semester?
3. Does it fit a zero-cost deployment budget?
4. What would happen if we remove it?

---

## Phase 1 — Define the product problem and MVP (30 minutes)

### Step 1.1 — Describe the problem before describing the solution

Complete the following statements in `PRD.md`:

```markdown
## 1. Product Overview

### Product Name

### Problem Statement
What problem exists now? Who experiences it? Why is the current process inadequate?

### Target Users

### Product Goal
What meaningful outcome should the platform create for users?
```

Avoid vague statements such as “make life easier.” State the current pain, its effect, and the improvement the platform should provide.

### Step 1.2 — Identify actors and permissions

List every actor that interacts with the platform. For each actor, describe their goal and main actions.

| Actor | Goal | Main actions | Information they may access |
|---|---|---|---|
| Example: Student | Reserve a facility | View availability, create booking, cancel booking | Their own bookings |
| Example: Administrator | Manage facilities | Create facility, block slot, view reports | All facilities and bookings |

Do not forget non-human actors when relevant, such as an external payment service, notification service, or scheduled system job.

### Step 1.3 — Define one core user journey

Choose the single most important happy path. A product should deliver value even if only this journey is completed well.

Example:

```text
Sign in → Search facility → View availability → Select time → Create booking → Receive confirmation
```

For each step, document the user action, system response, data used, and possible failure.

| Step | User action | System response | Data / rule involved | Possible failure |
|---:|---|---|---|---|
| 1 | Sign in | Verify identity and open dashboard | User account, role | Invalid credentials |

### Step 1.4 — Define the MVP boundary

Separate what the group must build now from what can wait.

```markdown
## 2. Scope

### In Scope (MVP)
-

### Out of Scope / Future Improvement
-
```

If an idea does not make the core journey work, it is probably not an MVP feature.

### Optional AI prompt — Product discovery

```text
You are a product analyst.

Our university student project topic is:
[topic]

Help us analyze the product idea. Do not select technology.

Identify:
1. The main problem and target users
2. The current workflow and pain points
3. One core user journey
4. Expected user value
5. Assumptions that need validation
6. MVP features and features that should be out of scope

Keep the result realistic for a 3–5 person student team, one semester, and a zero-THB deployment budget.
Clearly label assumptions; do not present them as facts.
```

---

## Phase 2 — Write requirements and rules (35 minutes)

### Step 2.1 — Write functional requirements

Functional requirements describe what the system must do. Give every requirement a stable ID.

```markdown
## 5. Functional Requirements

### FR-01 — [Short name]
The system shall ...

### FR-02 — [Short name]
The system shall ...
```

Good example: `FR-05 — The system shall prevent a user from booking an occupied facility time slot.`

Weak example: `The booking page should work well.`

### Step 2.2 — Write non-functional requirements

Non-functional requirements describe quality attributes and constraints. They often determine architecture more strongly than features do.

Include relevant requirements for:

- Performance and responsive design
- Security and privacy
- Availability and reliability
- Accessibility
- Cost and free-tier limits
- Maintainability and documentation
- Expected scale

Example:

```markdown
### NFR-03 — Authorization
The backend shall verify that a user may access or modify only resources permitted by their role and ownership.

### NFR-04 — Cost
The production deployment shall operate within free-tier services and must not require paid billing during the course.
```

### Step 2.3 — Write business rules and constraints

Business rules are product rules that must remain true regardless of interface design.

```markdown
## 7. Business Rules

### BR-01
A facility time slot may have at most one confirmed booking.

### BR-02
Only an administrator may block an unavailable time slot.

## 15. Constraints
- Team size: 3–5 developers
- Development time: one semester
- Deployment budget: 0 THB
- Services must be available on an appropriate free tier
```

### Step 2.4 — Define acceptance criteria

For each high-priority feature, write observable conditions for completion.

```markdown
### AC-FR-05
- [ ] A user can create a booking only when the selected slot is available.
- [ ] Two simultaneous requests cannot produce two confirmed bookings for the same slot.
- [ ] The API returns a clear error when the slot is no longer available.
```

### Optional AI prompt — Requirements review

```text
Act as a senior product engineer.

Based on the following problem, users, and core journey:
[paste content]

Propose a concise MVP requirement set. Separate:
1. Functional requirements
2. Non-functional requirements
3. Business rules
4. Permissions
5. Constraints
6. Out-of-scope features

Use IDs such as FR-01, NFR-01, and BR-01. Do not select technology or add features without explaining why they are necessary.
```

---

## Phase 3 — Design data and platform architecture (40 minutes)

### Step 3.1 — Identify the minimum data model

Ask: **What information must the system remember for the MVP to work?**

For each entity, record essential fields, relationships, ownership, and lifecycle.

| Entity | Essential fields | Relationships | Who may create / read / update / delete? |
|---|---|---|---|
| Example: Booking | id, user_id, facility_id, start_time, end_time, status | Belongs to user and facility | User creates/reads own; admin manages all |

Do not design every possible field. Start with the smallest model that supports the requirements.

### Step 3.2 — Protect data integrity

Identify where invalid, duplicate, or inconsistent data could appear. Add database constraints or backend rules that prevent it.

For example, checking availability only in the frontend does not prevent two users from booking at the same time. The backend and database must enforce the rule.

Document at least one integrity rule:

```markdown
### Data Integrity Rule
The database and backend must prevent duplicate confirmed bookings for the same facility and time period.
```

### Step 3.3 — Draw the first architecture diagram

Begin with the simplest possible platform:

```text
User → Frontend → Backend / API → Database
```

Add a component only when a requirement needs it:

```text
Browser
   ↓
Frontend
   ↓
Backend / API
   ├── Database
   ├── Authentication
   ├── File Storage (if required)
   └── External Service (if required)
```

For every box and arrow, write one sentence explaining why it exists and what data moves through it.

### Step 3.4 — Answer the architecture decision questions

Record answers in `architecture.md`:

1. Where does the client run?
2. Where does business logic run?
3. Where is each type of data stored?
4. Where does authentication happen?
5. Where is authorization enforced?
6. Where are files stored, if needed?
7. Which external services are called, from where, and with what failure plan?
8. Which component prevents duplicate or conflicting operations?

### Step 3.5 — Test the failure path

For the core journey, identify what happens when:

- a network request fails or is repeated;
- two users act simultaneously;
- an input is invalid or malicious;
- an external service is unavailable;
- the database operation fails;
- a user attempts to access another user’s data.

Good architecture considers both the happy path and the failure path.

### Optional AI prompt — Architecture options

```text
Act as a senior software architect.

Project requirements:
[paste requirements]

Minimum data model:
[paste data model]

Compare simple platform options suitable for a student project, such as:
1. Vercel + Supabase
2. Cloudflare Workers + D1
3. Firebase

For each option explain frontend, backend/API, database, authentication, storage, deployment, advantages, disadvantages, and major risks.

Recommend one option that is feasible for 3–5 students, one semester, and zero deployment budget. Prefer simplicity over theoretical scalability. Do not recommend microservices unless a requirement clearly demands them.
```

---

## Phase 4 — Select a feasible stack and write the PRD (35 minutes)

### Step 4.1 — Select technology using requirements, not preference

Complete the following table. Every decision requires a reason linked to a requirement or constraint.

| Layer | Selected technology | Requirement or constraint supported | Why this is feasible |
|---|---|---|---|
| Frontend | | | |
| Backend / API | | | |
| Database | | | |
| Authentication | | | |
| File storage | | | |
| Hosting / deployment | | | |

Before confirming the stack, verify free-tier limits, account requirements, and whether unexpected billing is possible.

### Step 4.2 — Complete the PRD

Use this structure in `PRD.md`:

```markdown
# Product Requirements Document

## 1. Product Overview
## 2. Scope
## 3. User Roles and Permissions
## 4. Core User Journey
## 5. Functional Requirements
## 6. Non-Functional Requirements
## 7. Business Rules
## 8. Data Model
## 9. Platform Architecture
## 10. Technology Stack
## 11. API / Interface Notes
## 12. Security and Privacy
## 13. Error Handling and Failure Scenarios
## 14. Deployment Plan
## 15. Constraints
## 16. Risks and Mitigations
## 17. Acceptance Criteria
## 18. Future Improvements
```

### Step 4.3 — Perform a group architecture reality check

As a group, challenge every component:

| Question | Action if the answer is unclear |
|---|---|
| Which requirement needs this component? | Remove it or justify it in the PRD. |
| Can we build and test it this semester? | Simplify or move it out of scope. |
| Does it introduce security, cost, or operational work? | Document the risk and mitigation. |
| What fails if it is unavailable? | Add failure handling or choose a simpler design. |

Architecture smells to challenge include unnecessary microservices, several databases without a reason, frontend-only permission checks, secret keys exposed in the client, missing unique constraints, and external API calls on every page load.

---

## Phase 5 — Role-based PRD review (35 minutes)

After the group has created the main PRD, **each student independently reviews the same PRD from their assigned role perspective.** This is the required individual contribution for the workshop.

### Step 5.1 — Create a review record

Add one section per reviewer to `role-reviews.md`:

```markdown
## [Name] — [Assigned Role]

### Summary

### Findings
| ID | PRD section | Issue or question | Why it matters | Severity | Recommended change |
|---|---|---|---|---|---|

### Decision requests for the group
-
```

Use severity levels:

- **Critical** — The product could be insecure, incorrect, or impossible to build.
- **High** — A major user, data, quality, or delivery risk needs resolution before implementation.
- **Medium** — Important improvement; resolve if it affects the MVP.
- **Low** — Clarification, polish, or future improvement.

### Step 5.2 — Review from the assigned role

#### Product Manager review

Check whether the PRD answers:

- Is the problem specific and supported by a clear target user?
- Does the MVP solve the core journey before adding extra features?
- Are priorities and out-of-scope items explicit?
- Are requirements testable and acceptance criteria measurable?
- Do business rules reflect real product decisions?

Example finding: `PM-01 — FR-03 says users can search, but does not define what can be searched or what a useful result contains.`

#### Frontend UX/UI review

Check whether the PRD answers:

- Can users complete the core journey with understandable screens and states?
- Are empty, loading, error, success, and permission-denied states identified?
- Is the interface usable on relevant screen sizes?
- Are form validation, feedback, and accessibility considered?
- Could a user make an irreversible or confusing mistake?

Example finding: `UX-01 — The booking journey has a success state but no design requirement for an unavailable slot after another user books it.`

#### Backend API and Database review

Check whether the PRD answers:

- Is every requirement supported by a clear data owner and API responsibility?
- Are entity relationships and required fields sufficient?
- What prevents duplicates, invalid states, and race conditions?
- Which rules must be enforced on the backend rather than the frontend?
- Are API inputs, outputs, and error cases clear enough to implement?

Example finding: `BE-01 — BR-01 requires one confirmed booking per slot, but the data model has no database constraint or transaction strategy.`

#### Quality and Security review

Check whether the PRD answers:

- How will each acceptance criterion be tested?
- Are authentication and authorization clearly separated?
- Can users access or change only permitted data?
- Are sensitive data, validation, logging, and secrets handled safely?
- What happens during network, database, and third-party service failures?

Example finding: `QS-01 — The PRD requires administrators to delete bookings but does not require backend role verification; an interface-only check is insecure.`

#### Delivery and Document review

Check whether the PRD answers:

- Can the group build, deploy, test, and document this within one semester?
- Are hosting, domain, environment variables, free-tier limits, and deployment steps realistic?
- Are dependencies, risks, and ownership visible?
- Is the PRD internally consistent and understandable by a new team member?
- Is there a minimum release plan and a rollback or recovery approach where appropriate?

Example finding: `DD-01 — The selected platform requires a paid account for a required service; this violates the zero-THB constraint.`

### Step 5.3 — Challenge the architecture before proposing new technology

Reviewers must first ask “why?” before recommending a tool.

```text
Which requirement requires this component?
What happens if we remove it?
Where is authorization enforced?
What happens when two users act at the same time?
What happens when this service fails?
Can the team operate this during the semester?
```

Do not recommend Redis, queues, microservices, Kafka, vector databases, or additional services solely because they are popular.

### Optional AI prompt — Role-specific review

```text
Act as the [assigned role] reviewer for a university software project.

Review the PRD below. Do not redesign it immediately and do not invent requirements.

[paste PRD]

Evaluate it through this role’s responsibilities. List findings in a table with:
- ID
- PRD section
- issue or missing decision
- why it matters
- severity: Critical / High / Medium / Low
- practical recommended change

Focus on feasibility for a 3–5 person team, one semester, and a zero-THB deployment budget.
```

---

## Phase 6 — Consolidate decisions and submit (25 minutes)

### Step 6.1 — Conduct the review meeting

Each reviewer has two minutes to present only their highest-priority findings. The group must decide one of the following for each Critical or High finding:

- **Accept** — revise the PRD now.
- **Defer** — move it to future improvement with a reason.
- **Reject** — record why the current design remains appropriate.

### Step 6.2 — Record the decision log

Add this table to `role-reviews.md`:

| Finding ID | Decision | PRD change made | Owner | Reason |
|---|---|---|---|---|
| BE-01 | Accept | Added unique constraint and conflict response | Backend API and Database | Prevent duplicate booking |

### Step 6.3 — Final architecture status

The group assigns one final status:

- **READY** — No unresolved Critical or High issues; implementation can begin.
- **READY WITH CHANGES** — Revisions are identified and completed before implementation.
- **NOT READY** — Core requirements, security, feasibility, or architecture decisions are still unresolved.

### Step 6.4 — Submit the final package

Before submission, verify:

- [ ] The PRD is complete and written in English.
- [ ] Each student has a role-based review section.
- [ ] Critical and High findings have a recorded decision.
- [ ] The architecture diagram matches the PRD and technology stack.
- [ ] Every major component has a requirement-based justification.
- [ ] The design is feasible within one semester and zero deployment cost.

---

## Assessment rubric

| Criterion | Points |
|---|---:|
| Problem definition and target users | 10 |
| Core user journey and MVP scope | 10 |
| Functional and non-functional requirements | 15 |
| Data model and business rules | 10 |
| Platform architecture and reasoning | 20 |
| Technology feasibility and deployment plan | 10 |
| Quality, security, and failure analysis | 10 |
| Individual role-based PRD review | 10 |
| Decision log and document quality | 5 |
| **Total** | **100** |

## Final reflection

Use these distinctions when evaluating your work:

```text
Idea ≠ Requirement
Requirement ≠ Architecture
Architecture ≠ Technology
Working code ≠ Good architecture
```

AI can produce a convincing PRD or architecture very quickly. Engineers add value by questioning assumptions, identifying risk, removing unnecessary complexity, and ensuring that the design is useful, safe, and buildable.
