# @visibleprojects/report-a-problem

The app-side half of the report-a-problem stack. The backend of record is
[`error-triage-service`](https://error-triage-service.vercel.app); this package
is the panel your users see and the two server routes that forward to it. No
database, no migrations, no sinks, no environment variables read inside the
package.

## What you get

- `ReportProblemPanel`: a draggable, non-blocking floating panel. Captures the
  page as it looked when it opened (via `html2canvas`, DOM rasterization only,
  never a system screen capture) and offers it for the reporter to include or
  discard. Accepts pasted and dropped screenshots, PDFs, text/CSV and Word/Excel
  files, up to 6 files of 8MB each. Shows a human ticket reference on success.
- `ReportProblemProvider` and `useReportProblem()`: the open/close state and the
  single mount point, so a trigger anywhere in the tree is one hook call.
- `createReportProblemHandlers(config)`: `report` and `attachment` forwarders,
  each a web-standard `(req: Request) => Promise<Response>`. Identity is bound
  from your session on the server; the client can never set it.
- Pure helpers: `buildUserReportPayload`, `clampPanelPosition`,
  `needsScreenshot`, `sanitizeAttachmentFilename`.
- `style.css`: hand-written, `rap-` prefixed, every colour a `--rap-*` custom
  property. No Tailwind, no CSS-in-JS, nothing that can collide with your styles.

Attachment bytes never pass through your server or the service. The panel asks
your route for a signed URL and PUTs the file straight to the service's storage.

## Install

```bash
npm i https://github.com/capoyeti/report-a-problem/archive/refs/tags/v0.1.0.tar.gz
```

Pin the tag. `dist/` is committed, so the tarball needs no build step. Peer
dependencies you must already have: `react`, `react-dom`, `lucide-react`,
`html2canvas`.

## Server wiring

Two route files, one shared config object.

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
duplicate, filed }`, 401 (no session), 403 (cross-origin), 413 (body over 32KB),
429 (service rate limit), 502 (service down or erroring). The attachment
forwarder passes the service's status and body straight through.

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

To get a key, register your app with `error-triage-service` (its README covers
provisioning: the app slug, Plane project, recipients, `ticket_prefix` and
`reporter_confirmation`). One key per app; rotating it is a service-side change
with no redeploy here.

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
git tag v0.1.0 && git push origin main --tags
bash scripts/smoke-tarball.sh v0.1.0
```

The smoke script installs that exact tag into a throwaway consumer and resolves
both exports. CI runs it automatically on any `v*` tag push.
