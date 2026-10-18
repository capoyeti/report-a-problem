// Headed regressions against committed dist, with synthetic loopback fixtures.
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { chromium, type Browser, type Page } from 'playwright';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const OUT = path.join(ROOT, 'docs/verification/report-reliability-react18');
const MIME: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
let origin = '';
let failFile = '';
let mode: 'file' | 'noop' | 'malformed' | 'drop' | 'refuse' | 'hold' = 'file';
let refusal = 403;
let reportEntered: (() => void) | undefined;
let releaseReport: (() => void) | undefined;
const counts = { signs: 0, puts: 0, posts: 0, unexpectedExternal: 0, changedRetryBodies: 0 };
const signed = new Map<string, number>();
const durable = new Map<string, { id: string; body: string }>();
const posted: { path: string; body: string }[] = [];
const errors: string[] = [];
const sockets = new Set<import('node:net').Socket>();
function reply(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
}
function file(res: http.ServerResponse, target: string) {
  if (!fs.existsSync(target)) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(target)] ?? 'application/octet-stream' }).end(fs.readFileSync(target));
}
async function body(req: http.IncomingMessage) {
  let value = ''; for await (const chunk of req) value += chunk;
  assert.ok(value.length < 32 * 1024); return value;
}
const server = http.createServer((req, res) => {
  void (async () => {
    const pathname = new URL(req.url ?? '/', origin || 'http://127.0.0.1').pathname;
    if (pathname === '/mock/attachment' && req.method === 'POST') {
      counts.signs++;
      const metadata = JSON.parse(await body(req));
      signed.set(metadata.filename, (signed.get(metadata.filename) ?? 0) + 1);
      if (metadata.filename === failFile) { reply(res, 503, { ok: false, error: 'service_unavailable' }); return; }
      reply(res, 200, { ok: true, attachment_id: randomUUID(), upload_url: `${origin}/mock/put` }); return;
    }
    if (pathname === '/mock/put') {
      counts.puts++; await body(req); res.writeHead(200).end(); return;
    }
    if (pathname === '/mock/report' || pathname === '/mock/changed-report') {
      counts.posts++;
      const raw = await body(req); const payload = JSON.parse(raw);
      posted.push({ path: pathname, body: raw });
      if (mode === 'refuse') { reply(res, refusal, { ok: false, error: refusal === 401 ? 'unauthorized' : refusal === 403 ? 'reporting_disabled' : refusal === 503 ? 'service_unavailable' : 'rate_limited' }); return; }
      if (mode === 'noop') { reply(res, 200, { ok: true, filed: false, reason: 'tenant_not_allowed' }); return; }
      if (mode === 'malformed') { res.writeHead(200, { 'content-type': 'application/json' }).end('{'); return; }
      const previous = durable.get(payload.submission_id);
      if (previous && previous.body !== raw) counts.changedRetryBodies++;
      const report = previous ?? { id: randomUUID(), body: raw };
      durable.set(payload.submission_id, report);
      if (mode === 'drop') { req.socket.destroy(); return; }
      if (mode === 'hold') await new Promise<void>((resolve) => { releaseReport = resolve; reportEntered?.(); });
      reply(res, 200, { ok: true, filed: true, reportId: report.id, ref: 'REP-1', duplicate: !!previous, delivered: { reporter_copy: false } }); return;
    }
    const vendors: Record<string, string> = {
      '/vendor/react.js': 'node_modules/react/umd/react.production.min.js',
      '/vendor/react-dom.js': 'node_modules/react-dom/umd/react-dom.production.min.js',
      '/vendor/html2canvas.js': 'node_modules/html2canvas/dist/html2canvas.min.js',
    };
    if (vendors[pathname]) { file(res, path.join(ROOT, vendors[pathname])); return; }
    if (pathname === '/favicon.ico') { res.writeHead(204).end(); return; }
    if (pathname === '/') { file(res, path.join(ROOT, 'scripts/harness/index.html')); return; }
    if (pathname.startsWith('/shim/')) { file(res, path.join(ROOT, 'scripts/harness', pathname)); return; }
    if (pathname.startsWith('/dist/')) { file(res, path.join(ROOT, pathname)); return; }
    res.writeHead(404).end();
  })().catch((error) => { errors.push(String(error)); reply(res, 500, { ok: false }); });
});
server.on('connection', (socket) => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });

async function configured(page: Page, patch: Record<string, unknown>) {
  await page.evaluate((value) => (window as any).rapHarness.set(value), patch);
  await page.waitForFunction((value) => Object.entries(value).every(([key, expected]) =>
    JSON.stringify((window as any).rapHarness.current[key]) === JSON.stringify(expected)), patch);
}
async function ready(page: Page) {
  await page.waitForFunction(() => {
    const button = document.querySelector<HTMLButtonElement>('[data-testid="report-send"]');
    return !!button && !button.disabled && !document.querySelector('[data-testid="report-availability"]');
  });
}
async function availability(page: Page, value: string) {
  await page.evaluate((v) => (window as any).rapHarness.availability(v), value);
  await page.waitForFunction((mode) => {
    const button = document.querySelector<HTMLButtonElement>('[data-testid="report-send"]');
    const notice = document.querySelector('[data-testid="report-availability"]');
    return button?.disabled === (mode === 'unavailable')
      && (mode === 'ready' ? !notice : notice?.textContent?.includes(mode === 'checking' ? 'checking' : 'temporarily unavailable'));
  }, value);
}
async function attach(page: Page, names: string[]) {
  await page.getByTestId('report-file-input').setInputFiles(names.map((name) => ({ name, mimeType: 'image/png', buffer: Buffer.from(PNG, 'base64') })));
}
async function close(page: Page) {
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByTestId('report-problem-panel').waitFor({ state: 'hidden' });
}
async function open(page: Page, text = 'Synthetic export button problem') {
  await page.getByTestId('harness-trigger').click();
  await page.getByTestId('report-text').fill(text);
}
async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  let browser: Browser | undefined;
  try {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`;
    browser = await chromium.launch({ headless: false });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.origin === origin || ['data:', 'blob:'].includes(url.protocol)) await route.continue();
      else { counts.unexpectedExternal++; await route.abort(); }
    });
    const page = await context.newPage();
    page.on('dialog', (dialog) => void dialog.accept().catch((error) => errors.push(error.message)));

    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(origin, { waitUntil: 'networkidle' });
    await open(page); await attach(page, ['good.png', 'bad.png']);
    await page.getByTestId('report-auto-shot').waitFor();
    const panel = page.getByTestId('report-problem-panel');
    assert.equal(await panel.evaluate((el) => getComputedStyle(el).position), 'fixed');
    const handle = page.getByTestId('report-drag-handle'); const before = (await handle.boundingBox())!;
    await handle.hover(); await page.mouse.down(); await page.mouse.move(before.x + before.width / 2 + 100, before.y + before.height / 2 - 50, { steps: 8 }); await page.mouse.up();
    await page.waitForFunction(() => document.querySelector<HTMLElement>('[data-testid="report-problem-panel"]')?.style.left !== '');
    const position = await panel.getAttribute('style'); assert.ok(position?.includes('left:'));
    const signStart = counts.signs;
    for (const value of ['checking', 'unavailable', 'ready', 'unavailable']) {
      await availability(page, value);
      assert.equal(await page.getByTestId('report-text').inputValue(), 'Synthetic export button problem');
      assert.equal(await page.locator('.rap-shot').count(), 2);
      assert.equal(await panel.getAttribute('style'), position);
    }
    assert.equal(counts.signs, signStart); assert.equal(counts.posts, 0);
    assert.equal(await page.getByTestId('report-send').isDisabled(), true);
    await page.screenshot({ path: path.join(OUT, 'unavailable.png') });
    await page.getByRole('button', { name: 'Retry connection' }).focus(); await page.keyboard.press('Enter');
    await page.waitForFunction(() => (window as any).rapRetries === 1);
    await ready(page);
    assert.equal(await page.getByTestId('report-send').isEnabled(), true);
    failFile = 'bad.png'; await page.getByTestId('report-send').click();
    await page.getByText("Some attachments couldn't be uploaded. Retry them or remove them before sending.").waitFor();
    assert.equal(counts.posts, 0); assert.equal(await page.locator('.rap-shot').count(), 2);
    await page.screenshot({ path: path.join(OUT, 'partial-attachments.png') });
    failFile = ''; await page.getByTestId('report-send').click(); await page.getByTestId('report-sent').waitFor();
    assert.equal(signed.get('good.png'), 1); assert.equal(signed.get('bad.png'), 2);
    assert.equal(JSON.parse(posted.at(-1)!.body).attachment_ids.length, 2);
    assert.equal(await page.getByTestId('report-sent').innerText().then((s) => s.includes('emailed')), false);
    await page.screenshot({ path: path.join(OUT, 'sent.png') }); await close(page);

    // Hold a real POST response so keyboard exclusion and availability changes
    // are asserted at a known in-flight boundary rather than a guessed delay.
    mode = 'hold';
    const entered = new Promise<void>((resolve) => { reportEntered = resolve; });
    await open(page, 'Held report with explicit attachment'); await attach(page, ['held.png']);
    const postsBefore = counts.posts; const signsBefore = counts.signs; const putsBefore = counts.puts;
    await page.getByTestId('report-send').focus(); await page.keyboard.press('Enter'); await entered;
    await page.waitForFunction(() => document.querySelector<HTMLButtonElement>('[data-testid="report-send"]')?.disabled);
    await page.keyboard.press('Enter');
    await page.getByTestId('report-send').evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
    assert.equal(counts.posts, postsBefore + 1); assert.equal(counts.signs, signsBefore + 1); assert.equal(counts.puts, putsBefore + 1);
    const heldBody = posted.at(-1)!.body;
    await availability(page, 'unavailable'); await configured(page, { enabled: false });
    await page.getByTestId('harness-trigger').waitFor({ state: 'hidden' });
    assert.equal(await page.getByTestId('report-text').inputValue(), 'Held report with explicit attachment');
    assert.equal(JSON.parse(heldBody).attachment_ids.length, 1);
    releaseReport!(); await page.getByTestId('report-sent').waitFor();
    assert.equal(counts.posts, postsBefore + 1); assert.equal(posted.at(-1)!.body, heldBody);
    await configured(page, { enabled: true, availability: undefined }); await close(page);

    // A no-op or invalid response must never reach sent.
    for (const failure of ['noop', 'malformed'] as const) {
      mode = failure; await open(page); await page.getByTestId('report-send').click(); await page.getByTestId('report-error').waitFor();
      assert.equal(await page.getByTestId('report-sent').count(), 0); assert.equal(await page.getByTestId('report-text').isDisabled(), true); await close(page);
    }
    // A lost response followed by each preflight refusal retains the original
    // endpoint, UUID and byte-identical body until duplicate proof arrives.
    for (const status of [401, 403, 503, 429]) {
      await configured(page, { endpoints: { report: '/mock/report', attachment: '/mock/attachment' } });
      mode = 'drop'; await open(page, `Original report ${status}`); const start = posted.length;
      await page.getByTestId('report-send').click(); await page.getByTestId('report-error').waitFor();
      await page.evaluate(() => history.pushState({}, '', '/changed-context'));
      await configured(page, { endpoints: { report: '/mock/changed-report', attachment: '/mock/attachment' } });
      mode = 'refuse'; refusal = status;
      const responseReady = page.waitForResponse((response) => new URL(response.url()).pathname === '/mock/report' && response.request().method() === 'POST' && response.status() === status);
      await page.getByTestId('report-send').click();
      const refusedResponse = await responseReady;
      await refusedResponse.finished();
      assert.equal(refusedResponse.request().postData(), posted[start].body);
      assert.equal(new URL(refusedResponse.url()).pathname, posted[start].path);
      await page.waitForFunction((status) => {
        const button = document.querySelector<HTMLButtonElement>('[data-testid="report-send"]');
        const error = document.querySelector('[data-testid="report-error"]')?.textContent;
        const expected = status === 401 ? 'sign in again' : status === 403 ? 'not enabled' : status === 429 ? 'minute' : 'still here';
        return !!button && !button.disabled && button.textContent?.includes('Retry same report') && error?.includes(expected);
      }, status);
      assert.equal(await page.getByTestId('report-text').isDisabled(), true);
      assert.deepEqual(posted[start + 1], posted[start]);
      mode = 'file';
      const duplicateReady = page.waitForResponse((response) => new URL(response.url()).pathname === '/mock/report' && response.request().method() === 'POST' && response.status() === 200);
      await page.getByTestId('report-send').click();
      const duplicateResponse = await duplicateReady;
      const duplicate = await duplicateResponse.json();
      await page.getByTestId('report-sent').waitFor();
      assert.equal(duplicateResponse.request().postData(), posted[start].body);
      assert.equal(duplicate.duplicate, true);
      const submissionId = JSON.parse(posted[start].body).submission_id;
      assert.equal(duplicate.reportId, durable.get(submissionId)?.id);
      for (const request of posted.slice(start)) assert.deepEqual(request, posted[start]);
      assert.deepEqual(posted[start + 2], posted[start]); await close(page);
    }
    mode = 'file';
    await page.goto(origin, { waitUntil: 'networkidle' }); await open(page); await attach(page, ['scope.png']);
    await configured(page, { enabled: false });
    await page.getByTestId('harness-trigger').waitFor({ state: 'hidden' }); assert.equal(await page.getByTestId('report-text').inputValue(), 'Synthetic export button problem'); assert.equal(await page.getByTestId('report-send').isDisabled(), true);
    await close(page); await configured(page, { enabled: true }); assert.equal(await panel.count(), 0);
    await page.getByTestId('harness-collapsed').click(); assert.equal(await page.getByTestId('report-text').inputValue(), '');
    await page.getByTestId('report-text').fill('Will be cleared on scope switch');
    await configured(page, { scope: 'new-tenant:new-actor:new-profile' });
    await panel.waitFor({ state: 'hidden' }); await open(page); assert.equal(await page.locator('.rap-shot').count(), 0);
    await page.reload({ waitUntil: 'networkidle' }); assert.equal(await panel.count(), 0);
    await page.setViewportSize({ width: 390, height: 844 }); await open(page); await availability(page, 'unavailable'); assert.equal(await page.getByTestId('report-send').isDisabled(), true);
    await page.getByRole('button', { name: 'Retry connection' }).click(); await ready(page); assert.equal(await page.getByTestId('report-send').isEnabled(), true); await close(page);
    assert.ok(counts.posts <= 40, 'HTTP attempts stay bounded across transport loss scenarios');
    assert.equal(durable.size, 6);
    assert.equal(counts.changedRetryBodies, 0); assert.equal(counts.unexpectedExternal, 0); assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(OUT, 'counts.json'), JSON.stringify({ ...counts, durableReports: durable.size, react: '18.3.1', headed: true }, null, 2) + '\n');
    console.log('VERIFY OK', JSON.stringify({ ...counts, durableReports: durable.size }));
    console.log(`Screenshots: ${path.relative(ROOT, OUT)}/{unavailable,partial-attachments,sent}.png`);
  } finally {
    try { await browser?.close(); } finally {
      for (const socket of sockets) socket.destroy();
      if (server.listening) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
