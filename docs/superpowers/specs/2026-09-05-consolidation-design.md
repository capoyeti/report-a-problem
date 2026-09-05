# Report-a-problem consolidation: one service, one thin client package

Date: 2026-09-05
Status: decided (Chad, 2026-09-05). Supersedes `2026-09-04-report-a-problem-design.md`.
Decision: `error-triage-service` survives as the backend of record. The
library-with-its-own-DB design in the 09-04 spec is closed. What that spec
got right (panel, attachments, idempotency, ownership, styling, distribution
mechanics) moves across: the backend parts into the service, the edge parts
into a thin client package published from this repo.

## Why consolidate

Two designs existed for one problem and neither referenced the other:

- `~/projects/error-triage-service` (EXPERTTECH-150, June 2026): standalone
  Next.js + Supabase service on Vercel (`https://error-triage-service.vercel.app`),
  per-app keys, per-tenant gating, DB, email, WhatsApp, Plane intake, LLM
  triage sweep. 76 tests. Deployed dark, both global flags OFF, never took a
  live report. CCP already has a forwarder (`apps/web/src/lib/error-triage/forwarder.ts`).
- experttech PRs 190 and 194 (September 2026): the panel UI, multi-attachment
  upload, Plane screenshot comments, and the security hardening, all built
  inside experttech, plus the 09-04 spec to extract them as a per-repo library.

The service already solves the part the library could not: one deployment,
any stack, per-app config without redeploy, central triage. The service lacks
everything September built. So the September work lands in the service, and
each app only ships the UI plus a forwarder.

## Target architecture

```
browser (panel)  --(1) POST /api/error-report/attachment (multipart or metadata)-->  app server (forwarder)
                 <--   { upload_url, attachment_id }                                  |  X-Triage-Key
                 --(2) PUT file bytes directly to upload_url (service's Supabase storage)
                 --(3) POST /api/error-report { ...payload, submission_id, attachment_ids }--> app server --> service POST /api/v1/report
                 <--   { ok, ref, delivered }                                                       <--  DB row, email, WhatsApp, Plane issue + attachment comment
```

Three pieces, two repos:

| Piece | Repo | Ships as |
|---|---|---|
| Service: capture, persist, sinks, attachments, triage | `error-triage-service` | one Vercel deployment |
| Client package: panel, provider, CSS, forwarder factory, pure helpers | `report-a-problem` (this repo) | `@visibleprojects/report-a-problem` via GitHub tag tarball |
| Developer tooling: register app, doctor, list reports | `~/.claude/skills/report-a-problem/` | shell CLI wrapped in a skill (later, plan D) |

## Service changes (plan A)

All in `error-triage-service`. Each item names the September behavior it absorbs.

1. **Idempotent submissions.** `error_reports.submission_id text NOT NULL`,
   `UNIQUE (app_id, submission_id)`. Payload gains optional `submission_id`;
   the service generates one when absent. Insert via upsert with
   `onConflict: 'app_id,submission_id', ignoreDuplicates: true`. Zero rows
   returned means duplicate: fetch the existing row, return its ref with
   `duplicate: true`, run no sinks. Absorbs 09-04 round 2 and 3.
   Accepted limitation carried over unchanged: a crash strictly between the
   insert and the sinks leaves a row with no sinks and a retry will not
   self-heal it. Outbox is deferred.
2. **Human ticket reference.** `error_reports.ticket_number bigint generated
   by default as identity`, `apps.ticket_prefix text NOT NULL DEFAULT 'REP'`.
   Response `ref` becomes `${ticket_prefix}-${ticket_number}` (was the uuid).
   `report_id` stays the uuid. Absorbs experttech `lib/errors/ticket.ts`.
3. **Service-owned attachments.** New private bucket `report-attachments`
   (8MB, the experttech mime allowlist) in the service's Supabase project.
   New table `report_attachments (id uuid pk, app_id, reporter_id text,
   tenant_id text, path text, mime text, size_bytes int, report_id uuid null,
   created_at)`. New route `POST /api/v1/attachments/sign` (X-Triage-Key)
   takes `{ reporter, tenant_id, filename, mime, size_bytes }`, validates mime
   and size, inserts the row, calls `storage.createSignedUploadUrl(path)` and
   returns `{ ok, attachment_id, upload_url }`. The browser PUTs bytes straight
   to `upload_url`; no attachment bytes ever pass through the app server or the
   service function (Vercel's 4.5MB function body cap makes proxying a trap).
   Report payload gains `attachment_ids: string[]` (max 10). At report time
   the service selects rows where `id in ids AND app_id = caller AND
   reporter_id = payload.reporter.id AND report_id IS NULL`; anything else is
   silently dropped (never fail a report over one bad attachment). Matching
   rows get `report_id` set, a 365-day signed read URL each, and one Plane
   comment via the existing `addCommentOnce` using experttech's
   `buildScreenshotCommentHtml`. `delivered.attachments` records the outcome.
   Ownership is now a keyed lookup, which retires the path-prefix grammar
   (PR 194) entirely. Absorbs experttech `app/api/error-report/screenshot/route.ts`
   and `lib/errors/plane-screenshots.ts`.
4. **Reporter confirmation email.** `apps.display_name text`,
   `apps.reporter_confirmation boolean NOT NULL DEFAULT false`. When true and
   `code === 'user_report'` and the reporter has an email, send a generic
   confirmation (subject `We've got your report (REF)`), `delivered.reporter_copy`.
   Absorbs experttech `problemReportConfirmationEmail`.
5. **Docs.** README gains the attachment flow, the new payload fields, and the
   new `apps` columns. The 363-line uncommitted README rewrite already in the
   working tree is committed first, as-is, before any code moves.

Not moving into the service: Sentry capture, experttech's feature-flag gate,
experttech's in-repo sweep (the service already has one; experttech's is
retired at cutover).

## Client package (plan B)

`@visibleprojects/report-a-problem`, built from this repo. Same distribution
mechanics as the 09-04 spec, kept verbatim: tarball URL pinned per consumer,
`dist/` committed, `tsc && cp src/style.css dist/style.css`, export map with
`./style.css`, CI smoke test against the tagged tarball. Peer deps `react`,
`react-dom`, `lucide-react`, `html2canvas`.

Exports:

- `ReportProblemPanel` (ported from experttech `ReportProblemModal.tsx`):
  Sentry removed, endpoints prop, one `submissionId` minted on open and reused
  across retries, attachment flow changed to sign-then-PUT, Tailwind classes
  replaced by `.rap-*` classes driven by `--rap-*` custom properties.
- `ReportProblemProvider` and `useReportProblem()`: the ~40 lines of open and
  close state every consumer would otherwise rewrite. `enabled: boolean` prop.
- `createReportProblemHandlers(config)` returning `{ report, attachment }`,
  each a web-standard `(req: Request) => Promise<Response>` so they drop into
  a Next.js App Router route file unchanged and into anything else with a
  one-line adapter. Config: `serviceUrl`, `serviceKey`, `verifySession`
  (returns `{ user: { id, email?, name? }, tenantId?, tenantName? } | { error }`),
  optional `timeoutMs` (default 8000). The report forwarder awaits the service
  and returns its `ref`. This deviates from the June principle of fire-and-forget
  forwarding on purpose: a person is waiting for a reference, and the
  submission id makes a retry after timeout safe. Automatic error-boundary
  captures are a different call path and stay fire-and-forget in the consumer.
- Pure helpers ported unchanged: `buildUserReportPayload`, `clampPanelPosition`,
  `needsScreenshot`, `sanitizeAttachmentFilename`.

Removed from the 09-04 design: `createReportHandler` sinks config, Supabase
config, `migrations/`, the RLS test, `createPlaneClient`, `formatTicket`,
`computeDedupKey`, `buildScreenshotCommentHtml` (all now service-side).

## Follow-ups (not planned in detail here)

- **Plan C: experttech cutover.** Register experttech as an app in the
  service (Plane project, recipients, `ticket_prefix 'REP'`,
  `reporter_confirmation true`), install the package, replace
  `app/api/error-report/*` with the forwarders, delete `lib/errors/triage-sweep.ts`
  and its cron, keep `error_reports` history read-only. Do this only after
  plans A and B are live and one CCP report has round-tripped.
- **Plan D: CLI + skill.** `rap doctor` (env, key, health), `rap apps register`,
  `rap reports ls --app`, `rap pins` (pinned tag vs latest across consumers).
  Sits on the service DB and admin API, shell-first so Codex, Grok and Gemini
  can all call it.

## Pre-flight (before plan A starts)

- Confirm no Codex session is still driving `error-triage-service` (the June
  pickup stood Claude down; three months idle, treat as done unless told otherwise).
- Commit the uncommitted README in the service repo.
- Check whether the CCP app and key were ever bootstrapped
  (`select slug from apps` on the service DB) so plan A's manual test has a key to use.
- Bring `dist/` discipline from `doc-render`: `.gitignore` only `node_modules/`.
