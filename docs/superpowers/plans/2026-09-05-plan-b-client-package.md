# Plan B: `@visibleprojects/report-a-problem` client package

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish a thin, installable package that gives any Next.js repo the "Report a problem" panel and the two server forwarders that talk to `error-triage-service`, with no database, migrations, or sink code of its own.

**Architecture:** Plain `tsc` library (ESM, `react-jsx`) in `~/projects/report-a-problem`, following `doc-render`'s release mechanics: `dist/` committed, GitHub tag tarball as the install URL. Three layers: pure helpers (ported from experttech unchanged), server handlers (`createReportProblemHandlers`, web-standard Request/Response), and the client (`ReportProblemPanel`, `ReportProblemProvider`, hand-written scoped CSS). The panel mints one `submissionId` per open, signs and PUTs attachments directly to storage, and posts the report to the consumer's own route, which forwards to the service.

**Tech Stack:** TypeScript 5, React 18 peer, `lucide-react` and `html2canvas` peers, vitest 2 with jsdom for helper and handler tests, Playwright headed script for the panel.

**Spec:** `docs/superpowers/specs/2026-09-05-consolidation-design.md` (section "Client package"). Depends on plan A's service endpoints being merged (`/api/v1/report` with `submission_id`/`attachment_ids`, `/api/v1/attachments/sign`).

## Global Constraints

- Work on `main` of `~/projects/report-a-problem` (the repo is new; the `planning` branch holds only docs and merges first).
- `dist/` is committed. `.gitignore` contains exactly `node_modules/` and `test-results/`.
- Package name `@visibleprojects/report-a-problem`, version `0.1.0`, `"type": "module"`, exports map with `"."` and `"./style.css"`, `"files": ["dist", "src"]`.
- Peer dependencies: `react >=18`, `react-dom >=18`, `lucide-react >=0.400`, `html2canvas >=1.4`. No runtime dependencies.
- Build: `tsc && cp src/style.css dist/style.css`. No bundler.
- Every CSS class the package emits starts with `rap-`. Every color comes from a `--rap-*` custom property with a neutral default.
- Forwarder body cap `32 * 1024` bytes; attachments max 10; report timeout default `8000` ms; attachment sign timeout `5000` ms.
- Zero `process.env` reads inside the package. Everything comes through `config`.
- No Sentry, no feature flags, no Tailwind.

---

### Task 1: Scaffold and build pipeline

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `src/index.ts`, `src/style.css` (token block only for now)

- [ ] **Step 1: Create the repo on GitHub and merge planning docs**

```bash
cd ~/projects/report-a-problem
git checkout main && git merge --ff-only planning
gh repo create capoyeti/report-a-problem --private --source=. --remote=origin --push
```

- [ ] **Step 2: Write `package.json`**

```json
{
  "name": "@visibleprojects/report-a-problem",
  "version": "0.1.0",
  "description": "Report-a-problem panel plus server forwarders for error-triage-service.",
  "repository": "github:capoyeti/report-a-problem",
  "license": "MIT",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" },
    "./style.css": "./dist/style.css"
  },
  "files": ["dist", "src"],
  "scripts": {
    "build": "tsc && cp src/style.css dist/style.css",
    "test": "vitest run",
    "verify:panel": "npx tsx scripts/report-panel-verify.ts",
    "smoke:tarball": "bash scripts/smoke-tarball.sh"
  },
  "peerDependencies": {
    "react": ">=18", "react-dom": ">=18", "lucide-react": ">=0.400", "html2canvas": ">=1.4"
  },
  "devDependencies": {
    "@types/react": "^18.3.14", "@types/react-dom": "^18.3.5", "@types/node": "^22.10.2",
    "react": "^18.3.1", "react-dom": "^18.3.1", "lucide-react": "^0.468.0", "html2canvas": "^1.4.1",
    "typescript": "^5.7.2", "vitest": "^2.1.8", "jsdom": "^25.0.1", "playwright": "^1.49.0", "tsx": "^4.19.2"
  },
  "engines": { "node": ">=20" }
}
```

- [ ] **Step 3: `tsconfig.json`, `vitest.config.ts`, `.gitignore`**

```json
{
  "compilerOptions": {
    "target": "ES2020", "module": "ESNext", "moduleResolution": "Bundler",
    "jsx": "react-jsx", "declaration": true, "outDir": "dist", "rootDir": "src",
    "strict": true, "esModuleInterop": true, "skipLibCheck": true, "lib": ["ES2020", "DOM", "DOM.Iterable"]
  },
  "include": ["src"]
}
```

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { environment: 'node', include: ['test/**/*.test.ts'] } });
```

`.gitignore`: two lines, `node_modules/` and `test-results/`.

- [ ] **Step 4: Empty entry and a build check**

`src/index.ts` containing `export {};` and `src/style.css` containing only the token block:

```css
/* @visibleprojects/report-a-problem. Override any --rap-* token in your own global CSS. */
:root {
  --rap-accent: #2563eb;
  --rap-accent-text: #ffffff;
  --rap-bg: #ffffff;
  --rap-surface: #f4f4f5;
  --rap-text: #18181b;
  --rap-muted: #71717a;
  --rap-border: #e4e4e7;
  --rap-warning: #b45309;
  --rap-danger: #b91c1c;
  --rap-radius: 12px;
  --rap-shadow: 0 10px 30px rgba(0,0,0,.18);
  --rap-font: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
  --rap-z: 2147483000;
}
```

Run: `npm install && npm run build && ls dist`
Expected: `index.js index.d.ts style.css`.

```bash
git add -A && git commit -m "chore: scaffold client package (tsc + css copy build)"
```

---

### Task 2: Port the pure helpers with their tests

**Files:**
- Create: `src/lib/report-payload.ts`, `src/lib/panel-position.ts`, `src/lib/needs-screenshot.ts`, `src/lib/attachment-filename.ts`
- Create: `test/report-payload.test.ts`, `test/panel-position.test.ts`, `test/needs-screenshot.test.ts`, `test/attachment-filename.test.ts`
- Modify: `src/index.ts`

**Interfaces:**
- Produces: `buildUserReportPayload(description: string, ctx: ReportContext): UserReportPayload | null`, `ReportContext` (without `screenshotPaths`), `USER_MESSAGE_MAX`, `TECHNICAL_MAX`, `clampPanelPosition`, `Point`, `needsScreenshot`, `sanitizeAttachmentFilename`.

- [ ] **Step 1: Copy sources and tests**

```bash
E=~/projects/experttech
cp $E/lib/errors/report-payload.ts      src/lib/report-payload.ts
cp $E/lib/errors/panel-position.ts      src/lib/panel-position.ts
cp $E/lib/errors/needs-screenshot.ts    src/lib/needs-screenshot.ts
cp $E/lib/errors/attachment-filename.ts src/lib/attachment-filename.ts
for f in report-payload panel-position needs-screenshot attachment-filename; do
  [ -f $E/tests/errors/$f.test.ts ] && cp $E/tests/errors/$f.test.ts test/$f.test.ts
done
```

- [ ] **Step 2: Adjust**

In each copied file: rewrite `@/lib/errors/...` imports to relative `./...`; in tests to `../src/lib/...`. In `report-payload.ts` delete the `screenshotPaths?: string[]` line from `ReportContext` (attachment ids now travel top-level, see Task 3). If a copied test references `screenshotPaths`, delete that case. Any test file that did not exist in experttech gets this minimum:

```ts
// test/needs-screenshot.test.ts (only if experttech had none)
import { describe, it, expect } from 'vitest';
import { needsScreenshot } from '../src/lib/needs-screenshot';
describe('needsScreenshot', () => {
  it('is a pure predicate over the description', () => {
    expect(typeof needsScreenshot('the button is misaligned')).toBe('boolean');
  });
});
```

`src/index.ts`:

```ts
export { buildUserReportPayload, USER_MESSAGE_MAX, TECHNICAL_MAX } from './lib/report-payload.js';
export type { ReportContext, UserReportPayload } from './lib/report-payload.js';
export { clampPanelPosition } from './lib/panel-position.js';
export type { Point } from './lib/panel-position.js';
export { needsScreenshot } from './lib/needs-screenshot.js';
export { sanitizeAttachmentFilename } from './lib/attachment-filename.js';
```

Run: `npm test && npm run build`
Expected: green; `dist/lib/*.js` present.

```bash
git add -A && git commit -m "feat: port pure helpers from experttech (payload, position, screenshot heuristic, filename)"
```

---

### Task 3: Server handlers `createReportProblemHandlers`

**Files:**
- Create: `src/server/types.ts`, `src/server/same-origin.ts`, `src/server/handlers.ts`
- Create: `test/handlers.test.ts`
- Modify: `src/index.ts`

**Interfaces:**
- Produces:

```ts
export interface ReportProblemSession {
  user: { id: string; email?: string | null; name?: string | null };
  tenantId?: string | null;
  tenantName?: string | null;
}
export interface ReportProblemHandlerConfig {
  serviceUrl: string;      // e.g. https://error-triage-service.vercel.app
  serviceKey: string;      // X-Triage-Key for this app; server-only
  verifySession: () => Promise<ReportProblemSession | { error: unknown }>;
  timeoutMs?: number;      // report call, default 8000
  fetch?: typeof fetch;    // test seam
}
export function createReportProblemHandlers(config: ReportProblemHandlerConfig): {
  report: (req: Request) => Promise<Response>;
  attachment: (req: Request) => Promise<Response>;
};
```

- Wire formats (panel to forwarder): `POST report` JSON `{ userMessage, technicalMessage?, code, route?, context, submission_id, attachment_ids }`; response `{ ok: true, ref, reportId, delivered, duplicate? }` or `{ ok: false, error }` with 401 / 403 / 413 / 429 / 502. `POST attachment` JSON `{ filename, mime, size_bytes }`; response passes the service body through with its status.

- [ ] **Step 1: Failing tests**

```ts
// test/handlers.test.ts
import { describe, it, expect, vi } from 'vitest';
import { createReportProblemHandlers } from '../src/server/handlers';

const session = { user: { id: 'u1', email: 'u@x.test', name: 'U' }, tenantId: 't1', tenantName: 'Tenant' };
function mk(over: Partial<Parameters<typeof createReportProblemHandlers>[0]> = {}, svc?: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = vi.fn(async (url: any, init: any) => { calls.push({ url, init }); return svc ? svc(url, init) : new Response(JSON.stringify({ ok: true, filed: true, report_id: 'r1', ref: 'REP-9', delivered: { db: true } }), { status: 200 }); });
  const h = createReportProblemHandlers({ serviceUrl: 'https://svc.test/', serviceKey: 'k', verifySession: async () => session, fetch: fetchImpl as any, ...over });
  return { h, calls };
}
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`https://app.test${path}`, { method: 'POST', headers: { 'content-type': 'application/json', host: 'app.test', origin: 'https://app.test', ...headers }, body: JSON.stringify(body) });

describe('report forwarder', () => {
  it('binds identity from the session, maps camelCase to the service payload, returns ref', async () => {
    const { h, calls } = mk();
    const res = await h.report(post('/api/error-report', { userMessage: 'broke', code: 'user_report', route: '/x', context: { kind: 'manual_report' }, submission_id: '3f2a1b40-1111-4222-8333-444455556666', attachment_ids: ['3f2a1b40-1111-4222-8333-444455556667'] }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true, ref: 'REP-9', reportId: 'r1' });
    expect(calls[0].url).toBe('https://svc.test/api/v1/report');
    expect((calls[0].init.headers as any)['x-triage-key']).toBe('k');
    const sent = JSON.parse(calls[0].init.body as string);
    expect(sent).toMatchObject({ tenant_id: 't1', tenant_name: 'Tenant', reporter: { id: 'u1', email: 'u@x.test', name: 'U' }, code: 'user_report', user_message: 'broke', route: '/x', submission_id: '3f2a1b40-1111-4222-8333-444455556666', attachment_ids: ['3f2a1b40-1111-4222-8333-444455556667'] });
    expect(sent.reporter.id).toBe('u1');
  });
  it('never lets the client set identity fields', async () => {
    const { h, calls } = mk();
    await h.report(post('/api/error-report', { userMessage: 'x', tenant_id: 'evil', reporter: { id: 'evil' } }));
    const sent = JSON.parse(calls[0].init.body as string);
    expect(sent.tenant_id).toBe('t1'); expect(sent.reporter.id).toBe('u1');
  });
  it('401 without a session', async () => {
    const { h } = mk({ verifySession: async () => ({ error: 'nope' }) });
    expect((await h.report(post('/api/error-report', { userMessage: 'x' }))).status).toBe(401);
  });
  it('403 on cross-origin', async () => {
    const { h } = mk();
    expect((await h.report(post('/api/error-report', { userMessage: 'x' }, { origin: 'https://evil.test' }))).status).toBe(403);
  });
  it('413 over 32KB', async () => {
    const { h } = mk();
    expect((await h.report(post('/api/error-report', { userMessage: 'x'.repeat(33 * 1024) }))).status).toBe(413);
  });
  it('drops malformed submission_id and non-uuid / >10 attachment ids', async () => {
    const { h, calls } = mk();
    await h.report(post('/api/error-report', { userMessage: 'x', submission_id: 'not-a-uuid', attachment_ids: Array(12).fill('3f2a1b40-1111-4222-8333-444455556667').concat(['junk']) }));
    const sent = JSON.parse(calls[0].init.body as string);
    expect(sent.submission_id).toBeUndefined();
    expect(sent.attachment_ids.length).toBe(10);
  });
  it('502 when the service times out or errors; 429 passes through', async () => {
    const { h: h1 } = mk({}, () => { throw Object.assign(new Error('t'), { name: 'TimeoutError' }); });
    expect((await h1.report(post('/api/error-report', { userMessage: 'x' }))).status).toBe(502);
    const { h: h2 } = mk({}, () => new Response('{"ok":false}', { status: 429 }));
    expect((await h2.report(post('/api/error-report', { userMessage: 'x' }))).status).toBe(429);
  });
});

describe('attachment forwarder', () => {
  it('forwards filename/mime/size with the session reporter and passes the service body through', async () => {
    const { h, calls } = mk({}, () => new Response(JSON.stringify({ ok: true, attachment_id: 'a1', upload_url: 'https://sb/up' }), { status: 200 }));
    const res = await h.attachment(post('/api/error-report/attachment', { filename: 'shot.png', mime: 'image/png', size_bytes: 10 }));
    expect(await res.json()).toMatchObject({ ok: true, attachment_id: 'a1', upload_url: 'https://sb/up' });
    expect(calls[0].url).toBe('https://svc.test/api/v1/attachments/sign');
    expect(JSON.parse(calls[0].init.body as string)).toMatchObject({ reporter: { id: 'u1' }, tenant_id: 't1', filename: 'shot.png', mime: 'image/png', size_bytes: 10 });
  });
  it('415 status from the service is passed through', async () => {
    const { h } = mk({}, () => new Response('{"ok":false,"error":"unsupported_type"}', { status: 415 }));
    expect((await h.attachment(post('/api/error-report/attachment', { filename: 'x.exe', mime: 'application/x-msdownload', size_bytes: 1 }))).status).toBe(415);
  });
});
```

Run: `npx vitest run test/handlers.test.ts`
Expected: FAIL, module missing.

- [ ] **Step 2: Implement**

```ts
// src/server/types.ts
export interface ReportProblemSession {
  user: { id: string; email?: string | null; name?: string | null };
  tenantId?: string | null;
  tenantName?: string | null;
}
export interface ReportProblemHandlerConfig {
  serviceUrl: string;
  serviceKey: string;
  verifySession: () => Promise<ReportProblemSession | { error: unknown }>;
  timeoutMs?: number;
  fetch?: typeof fetch;
}
```

```ts
// src/server/same-origin.ts
// Compare the browser's Origin host against the Host header it sent, NOT the
// request URL's host: Next can resolve req.url to a different host and cause
// false 403s (learned in experttech).
export function isSameOrigin(req: Request): boolean {
  const origin = req.headers.get('origin') || req.headers.get('referer');
  if (!origin) return true;
  const host = req.headers.get('host');
  if (!host) return true;
  try { return new URL(origin).host === host; } catch { return false; }
}
```

```ts
// src/server/handlers.ts
import type { ReportProblemHandlerConfig, ReportProblemSession } from './types.js';
import { isSameOrigin } from './same-origin.js';

const MAX_BODY_BYTES = 32 * 1024;
const MAX_ATTACHMENTS = 10;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : undefined);
const obj = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

function hasSession(s: ReportProblemSession | { error: unknown }): s is ReportProblemSession {
  return !('error' in s) || s.error === undefined;
}

async function readJson(req: Request): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; res: Response }> {
  const raw = await req.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) return { ok: false, res: json(413, { ok: false, error: 'payload_too_large' }) };
  try { return { ok: true, body: obj(JSON.parse(raw || '{}')) }; } catch { return { ok: false, res: json(400, { ok: false, error: 'invalid_json' }) }; }
}

async function callService(cfg: ReportProblemHandlerConfig, path: string, payload: unknown, timeoutMs: number): Promise<Response | 'unavailable'> {
  const f = cfg.fetch ?? fetch;
  try {
    return await f(`${cfg.serviceUrl.replace(/\/$/, '')}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-triage-key': cfg.serviceKey },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch { return 'unavailable'; }
}

export function createReportProblemHandlers(cfg: ReportProblemHandlerConfig) {
  const timeoutMs = cfg.timeoutMs ?? 8000;

  async function guard(req: Request): Promise<{ ok: true; session: ReportProblemSession } | { ok: false; res: Response }> {
    if (!isSameOrigin(req)) return { ok: false, res: json(403, { ok: false, error: 'bad_origin' }) };
    const s = await cfg.verifySession();
    if (!hasSession(s) || !s.user?.id) return { ok: false, res: json(401, { ok: false, error: 'unauthorized' }) };
    return { ok: true, session: s };
  }

  const identity = (s: ReportProblemSession) => ({
    tenant_id: s.tenantId ?? null,
    tenant_name: s.tenantName ?? null,
    reporter: { id: s.user.id, email: s.user.email ?? null, name: s.user.name ?? null },
  });

  return {
    async report(req: Request): Promise<Response> {
      const g = await guard(req); if (!g.ok) return g.res;
      const r = await readJson(req); if (!r.ok) return r.res;
      const b = r.body;
      const submissionId = str(b.submission_id, 64);
      const attachmentIds = (Array.isArray(b.attachment_ids) ? b.attachment_ids : [])
        .filter((x): x is string => typeof x === 'string' && UUID_RE.test(x)).slice(0, MAX_ATTACHMENTS);
      // Whitelist client diagnostics FIRST, then bind identity from the session. Never spread client input over identity.
      const payload = {
        code: str(b.code, 200), route: str(b.route, 200),
        user_message: str(b.userMessage, 2000), technical_message: str(b.technicalMessage, 8192), stack: str(b.stack, 8192),
        context: obj(b.context), occurred_at: new Date().toISOString(),
        submission_id: submissionId && UUID_RE.test(submissionId) ? submissionId : undefined,
        attachment_ids: attachmentIds,
        ...identity(g.session),
      };
      const res = await callService(cfg, '/api/v1/report', payload, timeoutMs);
      if (res === 'unavailable') return json(502, { ok: false, error: 'service_unavailable' });
      if (res.status === 429) return json(429, { ok: false, error: 'rate_limited' });
      if (!res.ok) return json(502, { ok: false, error: 'service_error' });
      const svc = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!svc.ok) return json(502, { ok: false, error: 'service_error' });
      return json(200, { ok: true, ref: svc.ref ?? svc.report_id ?? null, reportId: svc.report_id ?? null, delivered: svc.delivered ?? {}, duplicate: svc.duplicate === true, filed: svc.filed !== false });
    },

    async attachment(req: Request): Promise<Response> {
      const g = await guard(req); if (!g.ok) return g.res;
      const r = await readJson(req); if (!r.ok) return r.res;
      const b = r.body;
      const size = typeof b.size_bytes === 'number' ? b.size_bytes : Number.NaN;
      if (!Number.isFinite(size) || typeof b.mime !== 'string') return json(400, { ok: false, error: 'invalid_body' });
      const id = identity(g.session);
      const res = await callService(cfg, '/api/v1/attachments/sign', { reporter: { id: id.reporter.id }, tenant_id: id.tenant_id, filename: str(b.filename, 255), mime: b.mime, size_bytes: size }, 5000);
      if (res === 'unavailable') return json(502, { ok: false, error: 'service_unavailable' });
      const text = await res.text();
      return new Response(text, { status: res.status, headers: { 'content-type': 'application/json' } });
    },
  };
}
```

Add to `src/index.ts`:

```ts
export { createReportProblemHandlers } from './server/handlers.js';
export type { ReportProblemHandlerConfig, ReportProblemSession } from './server/types.js';
```

Run: `npm test`
Expected: all handler tests PASS.

```bash
git add -A && git commit -m "feat: createReportProblemHandlers (report + attachment forwarders to error-triage-service)"
```

---

### Task 4: Panel port, provider, scoped CSS

**Files:**
- Create: `src/client/ReportProblemPanel.tsx` (port of `~/projects/experttech/components/errors/ReportProblemModal.tsx`)
- Create: `src/client/ReportProblemProvider.tsx`
- Create: `src/client/upload.ts`
- Modify: `src/style.css`, `src/index.ts`
- Create: `test/upload.test.ts`

**Interfaces:**
- Produces:

```ts
export interface ReportProblemPanelProps {
  open: boolean;
  onClose: () => void;
  endpoints?: { report?: string; attachment?: string }; // defaults '/api/error-report', '/api/error-report/attachment'
}
export function ReportProblemPanel(props: ReportProblemPanelProps): JSX.Element | null;
export function ReportProblemProvider(props: { enabled?: boolean; endpoints?: ReportProblemPanelProps['endpoints']; children: React.ReactNode }): JSX.Element;
export function useReportProblem(): { open: () => void; close: () => void; isOpen: boolean; enabled: boolean };
export async function uploadAttachment(endpoint: string, file: File, fetchImpl?: typeof fetch): Promise<string | null>; // attachment_id or null
```

- [ ] **Step 1: Failing test for `uploadAttachment`**

```ts
// test/upload.test.ts
import { describe, it, expect, vi } from 'vitest';
import { uploadAttachment } from '../src/client/upload';

const file = new File([new Uint8Array([1, 2, 3])], 'shot.png', { type: 'image/png' });
describe('uploadAttachment', () => {
  it('signs via the app endpoint, PUTs bytes to upload_url, returns the attachment id', async () => {
    const calls: any[] = [];
    const f = vi.fn(async (url: string, init: any) => {
      calls.push({ url, init });
      if (url === '/api/error-report/attachment') return new Response(JSON.stringify({ ok: true, attachment_id: 'a1', upload_url: 'https://sb.test/up?token=t' }), { status: 200 });
      return new Response('{}', { status: 200 });
    });
    expect(await uploadAttachment('/api/error-report/attachment', file, f as any)).toBe('a1');
    expect(JSON.parse(calls[0].init.body)).toEqual({ filename: 'shot.png', mime: 'image/png', size_bytes: 3 });
    expect(calls[1]).toMatchObject({ url: 'https://sb.test/up?token=t', init: { method: 'PUT' } });
    expect(calls[1].init.headers['content-type']).toBe('image/png');
  });
  it('returns null when signing is refused or the PUT fails', async () => {
    const refuse = vi.fn(async () => new Response('{"ok":false}', { status: 415 }));
    expect(await uploadAttachment('/api/error-report/attachment', file, refuse as any)).toBeNull();
    const putFails = vi.fn(async (url: string) => url.startsWith('https://') ? new Response('', { status: 400 }) : new Response(JSON.stringify({ ok: true, attachment_id: 'a1', upload_url: 'https://sb.test/up' }), { status: 200 }));
    expect(await uploadAttachment('/api/error-report/attachment', file, putFails as any)).toBeNull();
  });
});
```

- [ ] **Step 2: Implement `upload.ts`**

```ts
// src/client/upload.ts
// Sign through the app (session-bound), then PUT the bytes straight to storage.
// The app server and the service never see attachment bytes.
export async function uploadAttachment(endpoint: string, file: File, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  try {
    const sign = await fetchImpl(endpoint, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ filename: file.name, mime: file.type, size_bytes: file.size }),
    });
    const body = (await sign.json().catch(() => ({}))) as { ok?: boolean; attachment_id?: string; upload_url?: string };
    if (!sign.ok || !body.ok || !body.attachment_id || !body.upload_url) return null;
    const put = await fetchImpl(body.upload_url, { method: 'PUT', headers: { 'content-type': file.type, 'x-upsert': 'false' }, body: file });
    return put.ok ? body.attachment_id : null;
  } catch { return null; }
}
```

Run: `npx vitest run test/upload.test.ts` Expected: PASS.

- [ ] **Step 3: Port the panel**

```bash
cp ~/projects/experttech/components/errors/ReportProblemModal.tsx src/client/ReportProblemPanel.tsx
```

Apply these edits, in order:

1. Rename the component and default export to `ReportProblemPanel`; add the `endpoints` prop with the defaults above; keep `'use client'` as the first line.
2. Imports: `@/lib/errors/report-payload` → `../lib/report-payload.js`, `panel-position` and `needs-screenshot` likewise. Delete the `captureReportToSentry` import and the line `ctx.sentryEventId = captureReportToSentry(description, ctx);`.
3. Submission id: add `const submissionIdRef = useRef<string | null>(null);` and in the effect that runs when `open` flips true set `submissionIdRef.current = crypto.randomUUID();`. Do not reset it on a failed send.
4. Attachments: replace the `Promise.all(shots.map(...fetch('/api/error-report/screenshot')...))` block with
   ```ts
   const attachmentIds = (await Promise.all(shots.map((s) => uploadAttachment(endpoints.attachment, s.file)))).filter((id): id is string => !!id);
   ```
   and delete `ctx.screenshotPaths = paths`.
5. Send: `fetch(endpoints.report, { ..., body: JSON.stringify({ ...payload, submission_id: submissionIdRef.current, attachment_ids: attachmentIds }) })`; on success `setReference(body.ref ?? body.reportId ?? null)` and `setEmailedCopy(body?.delivered?.reporter_copy === true)`.
6. Classes: replace every Tailwind `className` string with one `rap-*` class from this table, adding modifier classes where state is expressed today via conditional Tailwind:

   | Element | Class |
   |---|---|
   | panel root | `rap-panel` (+ `rap-panel--dragging`) |
   | drag handle row | `rap-handle` |
   | title | `rap-title` |
   | close button | `rap-icon-btn` |
   | body | `rap-body` |
   | description textarea | `rap-textarea` |
   | hint / char counter | `rap-hint` (+ `rap-hint--warn`) |
   | screenshot consent block | `rap-consent` |
   | screenshot thumbnail grid | `rap-shots` / item `rap-shot` / remove `rap-shot-remove` |
   | drop zone / add attachment | `rap-dropzone` (+ `rap-dropzone--active`) |
   | primary Send button | `rap-btn rap-btn--primary` |
   | secondary buttons | `rap-btn` |
   | success state | `rap-success` |
   | error hint | `rap-error` |
   | footer row | `rap-footer` |

   `grep -n 'className=' src/client/ReportProblemPanel.tsx` must return no line containing a Tailwind utility (no `flex`, `px-`, `text-`, `bg-`, `rounded`, `border-`) when done.
7. Write `src/style.css` for every class in the table under the token block. Fixed position, `z-index: var(--rap-z)`, `max-width: 420px`, `width: min(420px, calc(100vw - 24px))`, `font-family: var(--rap-font)`, `box-shadow: var(--rap-shadow)`, `border-radius: var(--rap-radius)`, colors only via tokens. Add `@media (prefers-reduced-motion: reduce)` disabling transitions and a `prefers-color-scheme: dark` block that only redefines the `--rap-*` tokens.

- [ ] **Step 4: Provider**

```tsx
// src/client/ReportProblemProvider.tsx
'use client';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { ReportProblemPanel, type ReportProblemPanelProps } from './ReportProblemPanel.js';

interface Ctx { open: () => void; close: () => void; isOpen: boolean; enabled: boolean }
const ReportProblemContext = createContext<Ctx>({ open: () => {}, close: () => {}, isOpen: false, enabled: false });

/** Owns open/close state and mounts the panel once. `enabled` is whatever the consumer decides (flag, role, env). */
export function ReportProblemProvider({ enabled = true, endpoints, children }: { enabled?: boolean; endpoints?: ReportProblemPanelProps['endpoints']; children: ReactNode }) {
  const [isOpen, setOpen] = useState(false);
  const open = useCallback(() => { if (enabled) setOpen(true); }, [enabled]);
  const close = useCallback(() => setOpen(false), []);
  const value = useMemo(() => ({ open, close, isOpen, enabled }), [open, close, isOpen, enabled]);
  return (
    <ReportProblemContext.Provider value={value}>
      {children}
      {enabled ? <ReportProblemPanel open={isOpen} onClose={close} endpoints={endpoints} /> : null}
    </ReportProblemContext.Provider>
  );
}
export function useReportProblem(): Ctx { return useContext(ReportProblemContext); }
```

Add to `src/index.ts`:

```ts
export { ReportProblemPanel } from './client/ReportProblemPanel.js';
export type { ReportProblemPanelProps } from './client/ReportProblemPanel.js';
export { ReportProblemProvider, useReportProblem } from './client/ReportProblemProvider.js';
export { uploadAttachment } from './client/upload.js';
```

- [ ] **Step 5: Build, check the directive survived, commit**

Run: `npm run build && head -1 dist/client/ReportProblemPanel.js && head -1 dist/client/ReportProblemProvider.js`
Expected: both print `'use client';` (tsc preserves prologue directives). `npm test` green.

```bash
git add -A && git commit -m "feat: ReportProblemPanel port (submission id, signed uploads, rap-* CSS) + provider"
```

---

### Task 5: Headed visual verification and tarball smoke test

**Files:**
- Create: `scripts/report-panel-verify.ts`, `scripts/harness/index.html`, `scripts/smoke-tarball.sh`
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Harness page**

`scripts/harness/index.html` loads React 18 UMD from cdnjs, `../../dist/style.css`, and an inline module that imports `../../dist/index.js`, wraps a button in `ReportProblemProvider` with `endpoints` pointing at `/mock/report` and `/mock/attachment`. `scripts/report-panel-verify.ts` starts a tiny `http.createServer` on port 4321 serving the harness and answering the two mock endpoints (`{ ok: true, ref: 'REP-1', delivered: { reporter_copy: true } }` and `{ ok: true, attachment_id: 'a1', upload_url: 'http://localhost:4321/mock/put' }`, PUT returns 200), then launches `chromium.launch({ headless: false, slowMo: 400 })`, clicks the trigger, drags the handle 120px, types a description, drops a generated PNG, clicks Send, asserts the success state shows `REP-1`, and saves `docs/visual-smoke/2026-09-05-panel/{open,dragged,sent}.png`. Also assert `getComputedStyle(panel).position === 'fixed'` to prove `style.css` applied.

Run: `npm run verify:panel`
Expected: three screenshots, process exits 0. Look at them.

- [ ] **Step 2: Tarball smoke**

```bash
# scripts/smoke-tarball.sh: install the EXACT tagged tarball into a throwaway consumer and resolve both exports.
set -euo pipefail
TAG="${1:?tag, e.g. v0.1.0}"
D=$(mktemp -d); cd "$D"; npm init -y >/dev/null
npm i --no-audit --no-fund "https://github.com/capoyeti/report-a-problem/archive/refs/tags/${TAG}.tar.gz" react react-dom lucide-react html2canvas >/dev/null
node -e "import('@visibleprojects/report-a-problem').then(m => { if (typeof m.createReportProblemHandlers !== 'function') process.exit(1); })"
test -f node_modules/@visibleprojects/report-a-problem/dist/style.css
echo "smoke ok: $TAG"
```

`.github/workflows/ci.yml`: on push and PR run `npm ci && npm test && npm run build && git diff --exit-code dist` (fails if `dist/` was not rebuilt and committed); on tag push `v*` additionally run `bash scripts/smoke-tarball.sh "$GITHUB_REF_NAME"`.

```bash
git add -A && git commit -m "test: headed panel verification script, tarball smoke, CI"
```

---

### Task 6: README, release v0.1.0

**Files:**
- Create: `README.md`

- [ ] **Step 1: README** with exactly these sections: What you get; Install (the tarball line); Server wiring (two route files, shown in full):

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
    return { user: { id: s.user.id, email: s.user.email, name: s.user.user_metadata?.full_name }, tenantId: s.tenantId ?? null };
  },
});
export const POST = h.report;
```

```ts
// app/api/error-report/attachment/route.ts  (same config object; export const POST = h.attachment;)
```

Client wiring (`import '@visibleprojects/report-a-problem/style.css'` in the root layout; `ReportProblemProvider enabled={...}` around the app; a trigger using `useReportProblem().open`); Theming (the token list); Env (`TRIAGE_SERVICE_URL`, `TRIAGE_SERVICE_KEY`, both server-only; how to get a key: the service's provisioning section); Release process (build, commit `dist/`, tag, push, smoke).

- [ ] **Step 2: Release**

```bash
npm run build && git add -A && git commit -m "docs: README; release v0.1.0" 
git tag v0.1.0 && git push origin main --tags
bash scripts/smoke-tarball.sh v0.1.0
```

Expected: `smoke ok: v0.1.0`.
