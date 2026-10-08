# @visibleprojects/report-a-problem

The app-side half of a two-part report-a-problem stack. The backend of record is
`error-triage-service`, a separate deployment that owns the database, the
attachment storage and the notification sinks. This package is the panel your
users see and the two server routes that forward to that service. No database, no
migrations, no sinks, and no environment variables read anywhere inside the
package.

One service serves many apps, so an app adopting this package needs a service URL
and a per-app key, and nothing else.

## What you get

- `ReportProblemPanel`: a draggable, non-blocking floating panel. Captures the
  page as it looked when it opened (via `html2canvas`, DOM rasterization only,
  never a system screen capture) and offers it for the reporter to include or
  discard. Modern colour functions (`oklch`, `lab`, `color()`), which Tailwind
  v4 emits throughout its default palette, are rewritten to `rgb()` on
  html2canvas's cloned document first, because html2canvas 1.4.1 throws on
  them and would otherwise return no capture at all. If capture still fails
  the panel says so rather than silently offering nothing. Takes screenshots, PDFs, text/CSV and Word/Excel files four ways:
  click the drop zone for the file picker, drop them on it, press Cmd+V (Ctrl+V)
  anywhere in the panel, or use its Paste from clipboard button. Up to 6 files of
  8MB each. Shows a human ticket reference on success.
- `ReportProblemProvider` and `useReportProblem()`: the open/close state and the
  single mount point, so a trigger anywhere in the tree is one hook call.
- `createReportProblemHandlers(config)`: `report` and `attachment` forwarders,
  each a web-standard `(req: Request) => Promise<Response>`. Identity is bound
  from your session on the server; the client can never set it.
- Pure helpers: `buildUserReportPayload`, `clampPanelPosition`,
  `needsScreenshot`, `sanitizeAttachmentFilename`.
- `style.css`: hand-written, `rap-` prefixed, every colour a `--rap-*` custom
  property. No Tailwind, no CSS-in-JS, nothing that can collide with your styles.

Attachment bytes never pass through your server or the service function. The
panel asks your route for a signed URL and PUTs the file straight to the
service's storage, which keeps uploads clear of serverless request body limits.

## Install

```bash
npm i https://github.com/capoyeti/report-a-problem/archive/refs/tags/v0.1.1.tar.gz
```

Pin the tag. `dist/` is committed, so the tarball installs with no build step of
its own. Peer dependencies you must already have: `react` and `react-dom` (18 or
newer), `lucide-react` for the icons, `html2canvas` for the opening capture.

The repository is private, so that URL needs access to it.

The examples below are Next.js App Router. The forwarders take a web-standard
`Request` and return a `Response`, so any other framework is a one-line adapter.

## Server wiring

Two route files, one shared config object. `verifySession` is yours: any function
that resolves the current user, returning `{ error }` when there is not one. The
example calls a `verifySession` helper of the kind a Supabase app tends to have,
but nothing about the package assumes Supabase.

```ts
// app/api/error-report/route.ts
import { createReportProblemHandlers } from '@visibleprojects/report-a-problem';
import { verifySession } from '@/lib/auth/verify-session';

const h = createReportProblemHandlers({
  serviceUrl: process.env.TRIAGE_SERVICE_URL!,
  serviceKey: process.env.TRIAGE_SERVICE_KEY!,
  verifySession: async () => {
    const s = await verifySession();
    if (s.error || !s.user) return { error: s.error ?? 'unauthorized' };
    return {
      user: { id: s.user.id, email: s.user.email, name: s.user.user_metadata?.full_name },
      tenantId: s.tenantId ?? null,
    };
  },
});

export const POST = h.report;
```

```ts
// app/api/error-report/attachment/route.ts
import { createReportProblemHandlers } from '@visibleprojects/report-a-problem';
import { verifySession } from '@/lib/auth/verify-session';

const h = createReportProblemHandlers({
  serviceUrl: process.env.TRIAGE_SERVICE_URL!,
  serviceKey: process.env.TRIAGE_SERVICE_KEY!,
  verifySession: async () => {
    const s = await verifySession();
    if (s.error || !s.user) return { error: s.error ?? 'unauthorized' };
    return {
      user: { id: s.user.id, email: s.user.email, name: s.user.user_metadata?.full_name },
      tenantId: s.tenantId ?? null,
    };
  },
});

export const POST = h.attachment;
```

Config options: `serviceUrl`, `serviceKey`, `verifySession`, and optional
`timeoutMs` (the report call, default 8000ms) and `fetch` (a test seam).

The report forwarder awaits the service rather than firing and forgetting: a
person is watching the panel for a reference number. The panel mints one
`submission_id` per open and reuses it across retries, so a retry after a
timeout resolves to the same report instead of filing a second one.

Statuses the report forwarder returns: 200 with `{ ok, ref, reportId, delivered,
duplicate, filed }`, 401 (no session), 403 (cross-origin or reporting_disabled), 503 (session availability guard failure), 413 (body over 32KB),
429 (service rate limit), 502 (service down or erroring). Attachment failures preserve controlled 401/403/413/415/429/503 statuses; arbitrary service errors become 502. Raw service error bodies are never forwarded.

## Client wiring

Import the stylesheet once, in the root layout:

```ts
// app/layout.tsx
import '@visibleprojects/report-a-problem/style.css';
```

Wrap the app in the provider. `enabled` is yours to decide: a flag, a role, an
environment check.

```tsx
import { ReportProblemProvider } from '@visibleprojects/report-a-problem';

<ReportProblemProvider enabled={isSignedIn}>{children}</ReportProblemProvider>
```

Trigger it from anywhere below the provider:

```tsx
'use client';
import { useReportProblem } from '@visibleprojects/report-a-problem';

export function ReportProblemMenuItem() {
  const { open, enabled } = useReportProblem();
  if (!enabled) return null;
  return <button onClick={open}>Report a problem</button>;
}
```

If your routes live elsewhere, pass `endpoints`:

```tsx
<ReportProblemProvider endpoints={{ report: '/api/support/report', attachment: '/api/support/attachment' }}>
```

Defaults are `/api/error-report` and `/api/error-report/attachment`.

## Theming

Override any token in your own global CSS, after the package stylesheet. The
package ships light defaults and a `prefers-color-scheme: dark` block that
redefines only these tokens.

| Token | Default | Used for |
|---|---|---|
| `--rap-accent` | `#2563eb` | primary button, focus ring, success tick |
| `--rap-accent-text` | `#ffffff` | text on the primary button |
| `--rap-bg` | `#ffffff` | panel background |
| `--rap-surface` | `#f4f4f5` | consent card, drop zone, hover fills |
| `--rap-text` | `#18181b` | body text |
| `--rap-muted` | `#71717a` | hints, counters, icons |
| `--rap-border` | `#e4e4e7` | all borders and dividers |
| `--rap-warning` | `#b45309` | the "a screenshot would help" nudge |
| `--rap-danger` | `#b91c1c` | error text, remove-attachment hover |
| `--rap-radius` | `12px` | panel corner radius |
| `--rap-shadow` | `0 10px 30px rgba(0,0,0,.18)` | panel shadow |
| `--rap-font` | `system-ui, ...` | panel font stack |
| `--rap-z` | `2147483000` | panel stacking order |

```css
:root {
  --rap-accent: #0f766e;
  --rap-radius: 6px;
}
```

Motion is disabled under `prefers-reduced-motion: reduce`.

## Env

Both are server-only. Never expose them to the browser, and never prefix either
with `NEXT_PUBLIC_`.

| Variable | Value |
|---|---|
| `TRIAGE_SERVICE_URL` | the service origin, e.g. `https://error-triage-service.vercel.app` |
| `TRIAGE_SERVICE_KEY` | the per-app `X-Triage-Key` |

To get a key, register your app with `error-triage-service`. Registration is a
row in the service's own `apps` table (slug, issue-tracker project, notification
recipients, `ticket_prefix`, `reporter_confirmation`), and its README is the
reference. One key per app. Rotating a key is a service-side change and needs no
redeploy here.

## Verifying locally

```bash
npm test                      # helpers and both forwarders
npx playwright install chromium
npm run verify:panel          # headed Chromium against dist/, writes docs/visual-smoke/
```

`verify:panel` runs against `dist/`, not `src/`, so a stale build or a missing
`style.css` fails there rather than in a consumer.

## Release process

`dist/` is committed, so it must be rebuilt in the same commit as any `src/`
change. CI enforces this with `git diff --exit-code dist`.

```bash
npm run build
git add -A && git commit -m "..."
git tag v0.1.1 && git push origin main --tags
bash scripts/smoke-tarball.sh v0.1.1
```

The smoke script installs that exact tag into a throwaway consumer and resolves
both exports. CI runs it automatically on any `v*` tag push.

## License

MIT. See `LICENSE`.

## Candidate 0.1.4 reliability contract

This candidate has not been released. Keep published dependency pins until the coordinator reviews and releases it. Strict filing proof is a deliberate compatibility correction: update mocks or custom report routes to return `ok:true`, `filed:true` and a nonempty string `ref` or `reportId`. A service success must contain `ref` or `report_id`. Missing proof, no-op and malformed responses never show a success or promise an email. Reporter-copy wording requires `delivered.reporter_copy === true`.

`verifySession` can return a `ReportProblemSessionFailure` with optional `status: 401 | 403 | 503`. Omission defaults to 401. Use 403 for an authoritative disable and 503 for an unavailable acceptance check. Thrown checks become controlled 503. Perform fresh authority checks in this consumer callback, independently of cached UI visibility.

Provider and panel accept optional typed availability:

```tsx
<ReportProblemProvider
  key={`${tenantId}:${actorId}:${profileId}`}
  enabled={triggerVisible}
  availability={{ canSubmit, message, onRetry: retryConnection, retrying }}
>
  {children}
</ReportProblemProvider>
```

`enabled` controls trigger visibility. An open panel remains mounted when disabled, with Send blocked. Availability changes preserve text, files and position and do not cancel a dispatched POST. The host owns public status messages, freshness timers and bounded explicit recovery; the package never polls. Omitted availability remains ready for existing consumers.

A failed attachment blocks Send from filing a reduced report. Retry uploads only failed files and reuses successful UUIDs, with at most three concurrent pipelines. Remove excludes a file explicitly. Signing responses must have UUID IDs, and report routes reject malformed/mixed attachment lists or lists over ten entries. `uploadAttachment` stays string/null compatible; `uploadAttachmentDetailed` returns typed, controlled outcomes.

Browser signing, PUT and report requests are bounded to 15, 60 and 20 seconds respectively, including report/sign response reads. Once POST begins, an ambiguous result retains the exact body, endpoint and UUID and locks description and attachment edits. Retry sends that same report. A later definitive refusal cannot erase earlier ambiguity. Only a first-attempt definitive refusal permits edits under the same UUID. Durable duplicate proof resolves to the original reference.

Drafts stay only in mounted memory. Close/Cancel, reload, logout or a provider identity key change clears them. Close after an unresolved POST explains that the report may already have been received; aborting browser work never proves server cancellation. Capture is never uploaded without explicit Include consent. No browser storage, payload logging or analytics is introduced.
