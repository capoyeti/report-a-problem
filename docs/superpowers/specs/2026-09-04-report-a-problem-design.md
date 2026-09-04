# report-a-problem: portable bug-report module — design spec

Date: 2026-09-04 (revised after round-1 adversarial review)
Status: revised, pending round-2 review
Origin: extracted from `experttech` PR #190 (https://github.com/capoyeti/experttech/pull/190)
and PR #194 (https://github.com/capoyeti/experttech/pull/194 — an attachment-ownership
security fix found while reviewing this spec; already applied to experttech directly)

## Revision note (round 1)

An adversarial review of the first draft found 6 material gaps: no durable-
delivery guarantee (the client can be told "we have it" when nothing
persisted), no stated RLS/access-control requirement on the migrations, no
ownership check on client-submitted attachment paths (an actual
vulnerability — fixed in experttech PR #194, and folded into this spec's
fixed behavior below), the reporter-confirmation email sink missing from the
interface entirely, a real risk the component ships unstyled (Tailwind's
content-scanning doesn't reach into `node_modules` by default) with no
theming story, and the ported Plane helpers reading `process.env` directly
instead of the injected config. All six are addressed below.

## Purpose

Chad runs many parallel Next.js + Supabase repos (experttech, Clever-Assets-AMP,
clever-connect-platform, shiftview, tabono, eb-website, ...). The "Report a
problem" feature just built and shipped in experttech — a draggable capture
panel, multi-attachment upload, and delivery into a Plane ticket with the
attachments actually visible — is generically useful in every one of them.
This spec defines a standalone, installable package so any repo can adopt it
without re-deriving the same code.

## Non-goals (explicitly out of scope for v1)

- **No scaffolding CLI.** Matches the existing `@visibleprojects/doc-render` /
  `@visibleprojects/model-pricing` pattern: a consumer installs the package
  and hand-wires a few thin files, following the README. Building a
  `create-*`/`init` generator is new tooling with real maintenance cost across
  differing repo layouts, for a benefit Chad said he doesn't need given he
  already integrates `doc-render` manually without friction.
- **No AI triage sweep.** experttech's `lib/errors/triage-sweep.ts` (a cron
  job that uses Claude to auto-diagnose each report and comment on the Plane
  issue) stays experttech-only. It needs its own `ANTHROPIC_API_KEY` and cron
  wiring, and adds real per-report API cost — not something every installing
  repo should get by default.
- **No second-repo integration in this pass.** This spec covers extracting
  and publishing the package only. Wiring it into AMP/CCP/ShiftView/tabono is
  separate, future, per-repo work (each needs its own Plane project, its own
  migration run, its own auth wiring).
- **No feature-flag system.** experttech gates the trigger behind a DB-backed
  `report_problem_button` flag it already has (`lib/features/flags.ts`). The
  package does not assume any flag system exists — the consumer passes a
  plain `enabled: boolean` to the trigger, computed however that repo likes.
- **No Sentry integration.** experttech's `captureReportToSentry` stays in
  experttech. A consumer that wants Sentry linkage wires its own capture call
  around the panel; the package doesn't take a Sentry dependency.
- **No auth implementation.** Every repo's session/auth setup differs. The
  package takes a `verifySession`-shaped callback via config; it never
  reaches into `@supabase/ssr`, cookies, or any specific auth library itself.

## Distribution

New standalone repo `~/projects/report-a-problem`, published as
`@visibleprojects/report-a-problem`. Installed the same way `doc-render` and
`model-pricing` already are — no private registry, no new auth to configure:

```json
"@visibleprojects/report-a-problem": "https://github.com/capoyeti/report-a-problem/archive/refs/tags/v0.1.0.tar.gz"
```

Versioned via git tags (`v0.1.0`, `v0.2.0`, ...). A consumer bumps its
`package.json` reference to move to a new version — no auto-update, matching
the existing pattern (`tabono`/`devpulse` both pin `doc-render` to an
explicit tag today).

## Package layout

```
report-a-problem/
  package.json          # name, main/types, peerDependencies
  tsconfig.json
  src/
    index.ts            # public exports
    component/
      ReportProblemPanel.tsx
    handlers/
      report-handler.ts       # createReportHandler(config)
      attachment-handler.ts   # createAttachmentHandler(config)
    lib/
      report-payload.ts
      panel-position.ts
      plane-screenshots.ts
      plane-client.ts         # createPlaneClient(config) -> addCommentOnce/setPriority/markIntakeDuplicate
      attachment-filename.ts
      needs-screenshot.ts
      dedup-key.ts
      ticket.ts
    types.ts            # ReportProblemConfig and friends
  migrations/
    001_error_reports_table.sql
    002_error_reports_screenshot_paths.sql
    003_error_screenshots_bucket.sql
  test/                  # vitest, mirrors experttech's existing test files
  README.md              # wiring steps for a new consumer
  docs/superpowers/specs/2026-09-04-report-a-problem-design.md   # this file
```

Build: `tsc` to `dist/` (mirrors `doc-render`'s `"main": "dist/index.js"`,
`"types": "dist/index.d.ts"` — a plain compiled library, no bundler needed).

## Public interface

### `ReportProblemPanel` (React component)

Same behavior as experttech's panel today: draggable non-blocking floating
panel, `html2canvas` auto-capture on open with explicit Include/Discard
consent (default excluded), multi-attachment accumulation (images + PDF/
text/CSV/docx/xlsx) via paste/drop, one Send.

```ts
interface ReportProblemPanelProps {
  open: boolean;
  onClose: () => void;
  /** Defaults to '/api/error-report' and '/api/error-report/attachment'. */
  endpoints?: { report?: string; attachment?: string };
}
```

Peer dependencies: `react`, `react-dom`, `lucide-react`, `html2canvas`.

**Styling (revised — round 1 finding):** the original draft assumed shipping
Tailwind utility class strings in the compiled JSX would just work. It
wouldn't reliably: Tailwind 3 consumers only scan their own configured
`content` paths (not `node_modules`), and Tailwind 4's `@source` opt-in has
the same problem — a compiled package installed as a dependency can render
completely unstyled by default. Fixing this by asking every consumer to add
a `@source` entry pointing into `node_modules/@visibleprojects/report-a-problem`
is fragile and easy to silently drift out of sync across repos.

Instead, the component ships its own **scoped, pre-built CSS file**
(`dist/style.css`, hand-written — not Tailwind — under a `.rap-*` class
prefix so it can never collide with a consumer's own classes), which the
consumer imports once (`import '@visibleprojects/report-a-problem/style.css'`
in their root layout). Colors are exposed as CSS custom properties with
neutral defaults (`--rap-accent`, `--rap-bg`, `--rap-surface`, `--rap-text`,
`--rap-border`, `--rap-warning`), so a consumer with its own brand palette
(Visible Projects' charcoal/amber/slate/ember, or whatever a given repo
uses) overrides them in their own global CSS — no Tailwind dependency, no
build-time coupling to the consumer's Tailwind version, no scanning problem.

### Handler factories

A consuming repo's own route files stay thin — they build a config object out
of their own primitives and hand it to the factory:

```ts
// consumer's app/api/error-report/route.ts
import { createReportHandler } from '@visibleprojects/report-a-problem';
import { verifySession } from '@/lib/auth/verify-session';
import { createServiceRoleClient } from '@/lib/supabase/server';

export const POST = createReportHandler({
  appName: 'AMP',
  verifySession,
  supabase: createServiceRoleClient,
  sinks: {
    email: { recipients: (process.env.SUPER_ADMIN_EMAILS ?? '').split(','), send: sendEmail },
    plane: process.env.ERROR_REPORT_PLANE_ENABLED === 'true' ? {
      apiUrl: process.env.PLANE_API_URL!, apiKey: process.env.PLANE_API_KEY!,
      workspaceSlug: process.env.PLANE_WORKSPACE_SLUG!, projectId: process.env.PLANE_PROJECT_ID!,
    } : undefined,
    whatsapp: process.env.N8N_WHATSAPP_WEBHOOK_URL ? { webhookUrl: process.env.N8N_WHATSAPP_WEBHOOK_URL } : undefined,
  },
});
```

```ts
interface ReportProblemConfig {
  appName: string; // used in ticket subject lines / Plane issue titles
  verifySession: () => Promise<
    { user: { id: string; email?: string; user_metadata?: Record<string, unknown> }; tenantId?: string; error?: undefined }
    | { error: unknown }
  >;
  supabase: () => SupabaseServiceRoleClient; // duck-typed: needs .from() and .storage
  table?: string;   // default 'error_reports'
  bucket?: string;  // default 'error-screenshots'
  sinks: {
    // Team/admin notification — the only sink besides the DB row that has a
    // sane universal default (silently no-ops if omitted, same as today).
    email?: { recipients: string[]; send: SendEmailFn };
    // Separate from the above (round-1 finding: this was missing entirely).
    // Mirrors experttech exactly: fires only for a manual report
    // (payload.code==='user_report' && context.kind==='manual_report'), to
    // the REPORTER's own email, with its own reply-to and template. Omitting
    // this config just means no confirmation copy is sent — never an error.
    reporterConfirmation?: {
      replyTo?: string[];
      render: (args: { name: string; ticketId: string; description: string; route?: string; timestamp: string }) =>
        { subject: string; html: string };
      send: SendEmailFn;
    };
    whatsapp?: { webhookUrl: string };
    plane?: { apiUrl: string; apiKey: string; workspaceSlug: string; projectId: string };
  };
}

type SendEmailFn = (args: { to: string | string[]; subject: string; html: string; replyTo?: string[] }) =>
  Promise<{ success: boolean; error?: unknown }>;
```

`createAttachmentHandler(config)` takes the same shape (only needs
`verifySession`, `supabase`, `bucket`).

Every field the current experttech route hardcodes (rate limiting, secret
scrubbing, same-origin check, size caps, mime allowlist) moves in as fixed
behavior — those aren't repo-specific, they're just correct, and stay
non-configurable to keep the interface small. Round 1 added two more
non-configurable, always-on behaviors to this list — see "Fixed security
behavior" below.

### Pure functions

`buildUserReportPayload`, `formatTicket`, `computeDedupKey`,
`sanitizeAttachmentFilename`, `buildScreenshotCommentHtml`,
`screenshotCommentMarker`, `clampPanelPosition`, `needsScreenshot` — ported
with no behavior change, still framework-agnostic, still independently
unit-tested.

**Plane helpers — changed, not ported as-is (round 1 finding):**
experttech's `addCommentOnce`/`setPriority`/`markIntakeDuplicate` read
`PLANE_API_URL`/`PLANE_API_KEY`/etc. straight from `process.env`. That's
incompatible with this package's config-injection model — the handler
factory already receives Plane credentials through `config.sinks.plane`, so
if these helpers kept reading ambient env vars, issue creation could target
one Plane project while the attachment comment silently targets a
different one (or nothing, if those env vars are unset). Instead, the
package exports `createPlaneClient(config.sinks.plane)` returning
`{ addCommentOnce, setPriority, markIntakeDuplicate }` bound to that exact
config — no ambient environment reads anywhere in the package. A contract
test asserts issue creation and the attachment comment always hit the same
workspace/project URL.

### Fixed security behavior (non-configurable, round 1 findings)

- **Attachment path ownership.** Every `screenshotPaths` entry must be
  prefixed with the authenticated caller's own `user.id` (exactly the check
  just added to experttech in PR #194) before it is ever signed. A path that
  fails this check is silently dropped from the report, never signed, never
  embedded — the same "never block the report over one bad attachment"
  posture already used for a failed upload.
- **Delivery success contract.** The DB row is not modeled as a "sink" —
  it's the one required, non-optional persistence step. If the insert into
  `table` fails, the handler returns `{ ok: false }` (the panel shows a real
  retry error), rather than experttech's current behavior of returning
  `{ ok: true }` even when every delivery attempt failed. Email/WhatsApp/Plane
  stay best-effort on top of that guaranteed write — one of them failing
  never fails the response, matching today's behavior for those three.
  Whether the migration has actually been run isn't something the handler
  can verify at runtime (a missing table just surfaces as the same insert
  failure as any other DB error) — the README states it as a hard
  prerequisite: run the migration before wiring the route, and the panel
  showing a retry error on every submit is the expected symptom of skipping
  that step, not a mysterious failure.

## Data model

Migration **templates** ship in `migrations/` as plain SQL, NOT auto-applied
— every repo's migration convention differs (timestamp-prefixed files,
numbered files, `supabase db push` vs `psql`). The README says: copy these
into your repo's migrations directory, adjust the table/bucket name if you
changed the defaults, run them your way.

`error_reports` ships only the columns the CORE route actually reads or
writes: `id`, `user_id`, `user_email`, `client_id` (nullable — not every
consumer is multi-tenant), `route`, `code`, `user_message`,
`technical_message`, `stack`, `context`, `user_agent`, `dedup_key`,
`screenshot_paths`, `ticket_number` (+ its sequence), `delivered`,
`plane_intake_id`, `plane_issue_id`. `dedup_key`/`plane_intake_id`/
`plane_issue_id` are written by the core route regardless of the triage
sweep (useful for debugging, and let a consumer adopt the sweep later
without a schema change) — but the sweep-only columns
(`triage_status`, `triage_summary`, `claimed_at`, `claim_token`,
`triaged_at`, `dedup_of`) are deliberately **excluded** from this package's
migrations, since nothing in the core module reads or writes them. A repo
that later adopts experttech's triage sweep adds those itself at that time.

`error-screenshots` bucket: private, 8MB cap, the same image+document mime
allowlist shipped in experttech today.

**Access control is normative, not optional (round 1 finding).** The
original draft listed columns but never stated the security posture —
reports carry stack traces and technical context, and having a service-role
client in the handler does NOT itself protect the table from anon/
authenticated access. The migration templates MUST, and the README states
this explicitly:
- Enable RLS on the table.
- Grant no policies to `anon` or `authenticated` — service role only.
- The bucket stays private with no public read policy (already the case).

The package's own test suite includes a check (against local Supabase) that
an anon/authenticated-scoped client gets zero rows/objects back, so a
consumer copying the migration wrong is at least caught in the package's own
CI, even though it can't force a consumer's copy-pasted migration to be
correct.

## Testing

The package carries its own vitest suite, ported near-verbatim from
experttech's `tests/errors/*.test.ts` and `tests/api/error-report-route.test.ts`
(same TDD discipline, same config-mocking pattern — the existing tests
already mock `verifySession`/`supabase`/`fetch`, which maps directly onto the
new injected-config shape). `ReportProblemPanel` itself stays
integration-verified via a headed Playwright script (same pattern as
experttech's `scripts/report-panel-verify.ts`) rather than jsdom component
tests, matching experttech's own established convention of not
component-testing React trees in vitest.

## Risks / open questions carried into implementation

- **`supabase` config is duck-typed**, not typed against a specific
  `@supabase/supabase-js` version — repos may be on different SDK versions.
  If this causes real friction, revisit with a peerDependency range.
- **Email `send` signature** is shaped after experttech's `sendEmail`
  (Resend). A consumer using a different provider (SES, Postmark, ...) has to
  write a small adapter matching `(args) => Promise<{success, error?}>`. Not
  a blocker for v1 — flagged so it isn't a surprise later.
