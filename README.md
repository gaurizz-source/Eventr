# evntr — IGDTUW Campus Event Platform

A campus-wide event discovery and management platform built for IGDTUW societies to launch events, track registrations, verify attendance, and issue certificates — end to end, at zero hosting cost.

---

## Tech Stack

- **Frontend:** Vanilla JavaScript, HTML, CSS (no framework) — `app.js`, `index.html`, `styles.css`
- **Auth:** AWS Cognito (User Pool)
- **Backend:** Single AWS Lambda function, routed manually via `event.requestContext.http.path` (Lambda Function URL, not API Gateway)
- **Database:** DynamoDB — three tables: `CampusEvents`, `EventRSVPs`, `SocietyMembers`
- **Email:** AWS SES (currently sandbox mode — see Known Limitations)
- **PDF Generation:** jsPDF (client-side, via CDN)
- **QR Codes:** qrcode.js (generation) + html5-qrcode (camera scanning)
- **Charts:** Chart.js (via CDN)

No servers to manage, no paid hosting required beyond AWS free-tier-eligible usage at campus scale.

---

## Core Features

### For Students
- Browse and search campus events with date/category filters
- Register for events — atomic capacity checks prevent overbooking
- Automatic waitlist with auto-promotion when a confirmed spot opens up
- QR code check-in — proof of actual attendance, separate from registration
- Download a Certificate of Participation (only unlocked after verified check-in on a past event) — supports either an auto-generated design or a society-provided custom template
- Payment proof upload (screenshot link) required before a paid registration is accepted
- View full event details: multi-day schedule, eligibility, prizes, team size, organiser contact

### For Societies / Hosts
- Launch events with rich optional details (schedule, prizes, eligibility, "why participate," contact info, custom certificate template)
- Edit event details post-publish *(currently has a known bug — see below)*
- Delete events (with automatic orphaned-RSVP cleanup)
- Camera-based QR scanner for attendee check-in
- View & export registrant lists (CSV)
- Add/remove society members, who get visibility into all of that host's events
- Analytics dashboard — registration trends (30-day) and category popularity

---

## Project Structure

```
/index.html       — all views, markup, and modals
/app.js           — all frontend logic and state management
/styles.css       — styling
/aws-config.js     — Cognito pool config (not committed — see Setup)
Lambda handler.js — single-function backend, one big switch on route + method
```

There is no build step for the frontend beyond `npm run dev` on port 3000 — no bundler, no framework compilation.

---

## Setup

1. **Cognito:** create a User Pool + App Client, set `UserPoolId` and `ClientId` in `aws-config.js`.
2. **DynamoDB:** create three tables — `CampusEvents` (PK: `eventId`), `EventRSVPs` (PK: `rsvpId`), `SocietyMembers` (PK: `ownerEmail`, SK: `memberEmail`).
3. **Lambda:** deploy the handler with a Function URL, IAM permissions for DynamoDB (Scan/Get/Put/Update/Delete/TransactWrite/BatchWrite) and SES (SendEmail).
4. **SES:** verify at least one sender email address for sandbox testing. See Known Limitations for production access.
5. Set `ApiBaseUrl` in `aws-config.js` to the Lambda Function URL.

---

## Known Limitations (deliberate, not oversights)

- **Edit Event returns a 500 error** on save. Root cause understood (likely a type mismatch between an empty-string `capacity` and `Number()`, or an `undefined` fallback DynamoDB rejects) — intentionally not fixed per product decision.
- **SES is sandbox-restricted** (200 emails/day, verified recipients only). Moving to production requires verifying an *owned* domain — IGDTUW's institutional domain isn't available for this, and a personally-owned domain was deferred to keep the project fully free to run.
- **Schedule and rich-details fields can only be set at event creation**, not edited afterward — deliberately not wired into the broken Edit Event flow.
- **DynamoDB access patterns rely heavily on `Scan` + `FilterExpression`** rather than indexed queries (see Improvements below) — fine at current college-scale event volumes, but a real scaling constraint.

---

## Suggested Improvements

### Performance & Scale
- **Add DynamoDB GSIs** for `eventId` on `EventRSVPs` and `hostEmail` on `CampusEvents`. Right now almost every read is a full-table `Scan` with a filter — cheap today, but this is the single biggest cost/latency risk if the platform grows beyond a few hundred events.
- **Paginate the event list** instead of loading and rendering every event at once.
- **Debounce the dashboard search input** — it currently re-filters on every keystroke.

### Reliability
- **Fix the Edit Event 500 error** whenever it becomes a priority — check CloudWatch logs for the exact stack trace; likely candidates are documented above.
- **Add basic input validation** on the Lambda side beyond email-domain regex — e.g. reject negative capacity, malformed dates, oversized text fields.
- **Add a loading/error state pattern** consistently across all fetches — some flows currently fail silently to the console only.

### Security
- Cognito ID tokens are fetched and stored but **never actually sent as an `Authorization` header** on protected routes (`Authorization: idToken` is commented out in a few places) — right now, route protection relies entirely on trusting the email in the request body. Worth wiring up real token verification server-side before this handles anything sensitive.
- **Rate-limit registration and check-in endpoints** to prevent scripted abuse (e.g., one student spamming registrations).

### Features
- **Push notifications** — a real PWA + Web Push setup (see below) would let hosts notify all registrants of an event change without relying on SES production access.
- **Calendar export (.ics)** for registered events — small addition, high day-to-day utility.
- **Branch/Year analytics breakdown** — deferred earlier this session; requires adding `studentBranch`/`studentYear` to the RSVP write path.
- **Per-event (not just per-society) membership** — was discussed and deliberately scoped down to society-level; revisit if a society specifically needs finer-grained event staffing.
- **Dark mode** — purely cosmetic, but often requested for a student-facing app used late at night before deadlines.

### DevOps
- **Move `API_BASE_URL` and Cognito config out of a committed file** into environment variables, even for a no-build vanilla JS project (a small config-injection step at deploy time avoids ever committing infra URLs to source control).
- **Add basic automated tests** for the Lambda routes — even a handful of integration tests against the DynamoDB local emulator would catch regressions like the Edit Event bug before deploy.

---

## Should This Become a PWA?

**Recommendation: yes, worth doing, low cost, low risk.**

What it buys:
- "Add to Home Screen" installability — makes the platform feel like a native app for students without any app store submission
- Faster repeat loads via cached static assets (JS/CSS/fonts/images)
- Basic offline resilience (a proper "you're offline" state instead of a blank/broken page)

What it does *not* solve, and shouldn't try to:
- Registration, check-in, capacity counts, and analytics are inherently live-data operations. A PWA should **not** cache API responses aggressively — use a network-first strategy for anything hitting `/events`, `/rsvp`, `/society/*`, etc., and cache-first only for static assets. Treat offline mode as "graceful degradation," not "offline functionality."
- QR scanning needs camera access, which requires HTTPS regardless of PWA status — if the site is already served over HTTPS (standard for most free hosting), this is unaffected either way.

Implementation is two new files (`manifest.json` + a service worker script) plus a few icon assets — no new AWS services, no additional cost. Happy to build this out when you're ready.
