/** Real-browser integration proof against a loopback-only synthetic wire server. */
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { chromium, type Page } from 'playwright';

for (const key of Object.keys(process.env)) if (/TOKEN|SECRET|API_KEY|DATABASE_URL|SUPABASE|PLANE_/i.test(key)) delete process.env[key];
const root = path.resolve(new URL('..', import.meta.url).pathname);
const output = path.join(root, 'docs/review-renderer-evidence');
const actors: Record<string, { id: string; name: string; role: string }> = {
  rhona: { id: 'rhona', name: 'Rhona', role: 'reviewer' }, chad: { id: 'chad', name: 'Chad', role: 'lead' },
};
type Comment = Record<string, any>;
const comments = new Map<string, Comment>();
const deleted = new Set<string>();
const grants = new Map<string, { actor: string; page: string }>();
const receipts = new Map<string, { request: string; status: number; body: unknown }>();
const requests: Array<{ method: string; pathname: string; actor: string | null }> = [];
let sequence = 0;
function json(res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers }).end(JSON.stringify(body));
}
async function body(req: http.IncomingMessage): Promise<any> {
  let raw = ''; for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > 256 * 1024) throw new Error('body too large'); }
  return raw ? JSON.parse(raw) : {};
}
const fixtureHtml = fs.readFileSync(path.join(root, 'examples/review-spike/index.html'), 'utf8').replace('</main>', `
<section data-review-id="target-parent" data-review-label="Public target group" class="card">
 <button id="nested-target" data-review-id="nested-target" data-review-label="Nested public action"><span id="target-child" data-review-id="target-child">Nested action</span></button>
 <p id="public-text" data-review-id="public-text">Public selection text for review fallback.</p>
 <div id="drawing" data-review-id="drawing" data-review-label="Public diagram" style="height:180px;background:#dbe8ef">Drawing area</div>
</section>
<div data-review-private><p id="private-text">Synthetic private sentinel never capture</p><button id="private-button">Private action</button></div>
<div data-review-exclude><button id="excluded-button">Excluded action</button></div>
<form><input id="password" type="password" value="synthetic-secret"><p id="form-text">Private form label</p></form>
<div contenteditable="true" id="editable">Editable private sentinel</div>
<div style="height:1000px" id="scroll-tail">Public scroll space</div>
</main>`);
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const actor = /(?:^|;\s*)fixture_actor=([a-z]+)/.exec(req.headers.cookie ?? '')?.[1] ?? null;
    const p = url.pathname; requests.push({ method: req.method!, pathname: p, actor });
    if (p === '/fixture/login') {
      const input = await body(req); if (!actors[input.actor]) return json(res, 400, {});
      return json(res, 200, {}, { 'set-cookie': `fixture_actor=${input.actor}; HttpOnly; SameSite=Strict; Path=/` });
    }
    if (p === '/fixture/logout') return json(res, 200, {}, { 'set-cookie': 'fixture_actor=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
    if (p === '/api/review/session') {
      if (!actor || !actors[actor]) return json(res, 401, {});
      const input = await body(req); const token = randomUUID(); grants.set(token, { actor, page: input.pagePath });
      return json(res, 200, { token, expiresAt: new Date(Date.now() + 600_000).toISOString(), actor: actors[actor], buildId: 'fixture-build-1',
        scope: { appId: 'fixture-app', tenantId: null, environment: 'test', campaignId: 'october', pagePath: input.pagePath, resourceId: null } });
    }
    if (p.startsWith('/api/review/v1/annotate/reviews/october/')) {
      const token = req.headers.authorization?.replace(/^Bearer /, '') ?? '';
      const grant = grants.get(token);
      if (!actor || !grant || grant.actor !== actor) return json(res, 401, {});
      const suffix = p.slice('/api/review/v1/annotate/reviews/october'.length);
      if (suffix === '/comments' && req.method === 'GET') {
        if (url.searchParams.get('page') !== grant.page) return json(res, 403, {});
        const etag = `"fixture-${sequence}"`;
        if (req.headers['if-none-match'] === etag) return void res.writeHead(304, { etag }).end();
        return json(res, 200, { comments: [...comments.values()].filter(c => c.page === grant.page) }, { etag });
      }
      const match = /^\/comments\/([A-Za-z0-9_-]+)(\/replies)?$/.exec(suffix);
      if (!match) return json(res, 404, {});
      const id = match[1], existing = comments.get(id);
      if (deleted.has(id)) return json(res, 410, {error: 'deleted'});
      if (existing && existing.page !== grant.page) return json(res, 404, {});
      const input = await body(req), key = `${actor}:${req.headers['idempotency-key']}`;
      const fingerprint = JSON.stringify([req.method, p, input]); const receipt = receipts.get(key);
      if (receipt) return json(res, receipt.request === fingerprint ? receipt.status : 409, receipt.request === fingerprint ? receipt.body : { error: 'operation_conflict' });
      const stamp = new Date(Date.now() + ++sequence).toISOString();
      let result: unknown;
      if (match[2] && req.method === 'POST') {
        if (!existing) return json(res, 404, {});
        existing.replies.push({ id: input.id, text: input.text, author: actors[actor].name, authorId: actor, createdAt: stamp, editedAt: null });
        existing.updatedAt = stamp; result = { comment: existing };
      } else if (req.method === 'PUT') {
        if (existing && existing.authorId !== actor) return json(res, 403, {});
        if (input.page !== grant.page) return json(res, 403, {});
        if (existing && input.updatedAt !== existing.updatedAt) return json(res, 409, { comment: existing });
        const c = { ...input, author: existing?.author ?? actors[actor].name, authorId: existing?.authorId ?? actor,
          replies: existing?.replies ?? [], updatedAt: stamp, createdAt: existing?.createdAt ?? stamp };
        comments.set(id, c); result = { comment: c };
      } else return json(res, 405, {});
      receipts.set(key, { request: fingerprint, status: 200, body: result }); return json(res, 200, result);
    }
    if (p === '/' || p === '/other-page') {
      res.writeHead(200, { 'content-type': 'text/html' }).end(fixtureHtml); return;
    }
    if (p.startsWith('/dist/')) {
      const file = path.resolve(root, '.' + p);
      if (!file.startsWith(root + '/dist/') || !fs.existsSync(file)) return json(res, 404, {});
      res.writeHead(200, { 'content-type': 'text/javascript' }).end(fs.readFileSync(file)); return;
    }
    res.writeHead(p === '/favicon.ico' ? 204 : 404).end();
  } catch { json(res, 500, { error: 'fixture_error' }); }
});

async function waitFor(page: Page, predicate: () => boolean) { await page.waitForFunction(predicate, undefined, { timeout: 10_000 }); }
async function main() {
  fs.mkdirSync(output, { recursive: true });
  for (const name of ['results.json', 'failure.json', 'failure.png']) fs.rmSync(path.join(output, name), { force: true });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const browser = await chromium.launch({ headless: process.env.REVIEW_HEADLESS === '1' });
  const checks: string[] = [], errors: string[] = [], external: string[] = [];
  const contexts: Awaited<ReturnType<typeof browser.newContext>>[] = [];
  async function pageAt(width: number, height: number, touch = false, actor = 'rhona') {
    const context = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch }); contexts.push(context);
    await context.route('**/*', route => {
      if (new URL(route.request().url()).origin === base) return route.continue();
      external.push(route.request().url()); return route.abort();
    });
    const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
    await page.goto(base + '/?synthetic=redacted#fixture');
    await page.getByRole('button', { name: `Use ${actor === 'rhona' ? 'Rhona' : 'Chad'} fixture` }).click();
    await waitFor(page, () => (window as any).reviewFixture?.syncState().state === 'idle');
    return page;
  }
  async function mark(page: Page, selector: string) {
    await page.getByRole('button', { name: 'Mark this page', exact: true }).first().click();
    await page.locator(selector).click();
    await page.getByRole('dialog', { name: 'Confirm review target' }).waitFor();
    await page.getByRole('button', { name: 'Use this target', exact: true }).click();
  }
  async function post(page: Page, text: string) {
    await page.locator('#__an_compose textarea').fill(text);
    await page.locator('#__an_compose').getByRole('button', { name: 'Comment', exact: true }).click();
    await waitFor(page, () => (window as any).reviewFixture?.syncState().state === 'idle');
  }
  async function noOverflow(page: Page) {
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), 'horizontal overflow');
  }
  let desktop: Page | undefined;
  try {
    desktop = await pageAt(1440, 900); const other = await pageAt(1280, 720, false, 'chad');
    await desktop.bringToFront();
    await mark(desktop, '#fee-document');
    assert.equal(await desktop.locator('#document-result').textContent(), 'The document has not been opened.');
    await post(desktop, 'The fee document action needs review.');
    await noOverflow(desktop);
    assert.equal(await desktop.getByRole('button', { name: 'Resume draft', exact: true }).isVisible(), false);
    await desktop.getByRole('button', { name: 'Resolve discussion', exact: true }).waitFor();
    await desktop.getByText('Closing a discussion does not verify a fix.', { exact: true }).waitFor();
    const first = [...comments.values()][0];
    assert(first.geom.selector.startsWith('[data-review-id='));
    assert.equal(await desktop.locator(first.geom.selector).count(), 1);
    assert.equal(first.originalContext.description, first.text);
    assert(!first.url.includes('?') && !first.url.includes('#'));
    await other.bringToFront(); const visibleStart = Date.now();
    await other.getByText(first.text, { exact: true }).waitFor({ timeout: 10_000 });
    const visibilityMs = Date.now() - visibleStart;
    assert.deepEqual(await other.getByRole('combobox', { name: 'Discussion status', exact: true }).locator('option').allTextContents(), ['Open discussion', 'Discussion in progress', 'Discussion closed', 'Discussion declined']);
    await other.locator('.an-card .an-cact').getByRole('button', { name: 'Reply', exact: true }).click();
    await other.getByRole('textbox', { name: 'Reply text', exact: true }).fill('Second reviewer reply.');
    await other.locator('.an-replybox').getByRole('button', { name: 'Reply', exact: true }).click();
    await waitFor(other, () => (window as any).reviewFixture.syncState().state === 'idle');
    await other.screenshot({ path: path.join(output, 'shared-1280.png') });
    checks.push('stable selector, no target activation, original context, canonical URL, two-browser shared reply within ten seconds');
    checks.push('discussion-scoped actions and lead options, fix-verification explanation, no Resume action after committed comment');
    await desktop.bringToFront(); await desktop.locator('#refresh-review').click();
    await desktop.getByText('Second reviewer reply.', { exact: false }).waitFor();
    // Stable identity survives DOM id and text changes; context remains the original.
    await desktop.evaluate(() => { document.querySelector('#fee-document')!.id = 'renamed'; document.querySelector('#renamed')!.textContent = 'Changed text'; });
    await desktop.waitForTimeout(300); assert.equal(await desktop.locator('.an-pin').count(), 1);
    await desktop.screenshot({ path: path.join(output, 'shared-1440.png') });
    await desktop.evaluate(() => document.querySelector('#renamed')!.remove());
    await desktop.getByText('Anchor unavailable.', { exact: false }).waitFor();
    assert.equal(await desktop.locator('.an-pin').count(), 0);
    checks.push('changed DOM identity and original context; removed anchor has explanation and no guessed overlay');
    // Conflict must hold across explicit submit, refresh and a full reload.
    const originalDescription = first.originalContext.description;
    first.text = 'Live server version for comparison.'; first.updatedAt = new Date(Date.now() + 1000).toISOString(); sequence++;
    await desktop.locator('.an-card .an-cact').getByRole('button', { name: 'Edit', exact: true }).click();
    await desktop.getByRole('textbox', { name: 'Edit comment', exact: true }).fill('My conflicting local edit.');
    await desktop.locator('.an-editbox').getByRole('button', { name: 'Save', exact: true }).click();
    await waitFor(desktop, () => (window as any).reviewFixture.syncState().state === 'conflict');
    const writesBefore = requests.filter(r => r.method === 'PUT').length;
    await desktop.evaluate(() => (window as any).reviewFixture.submit().catch(() => {}));
    await desktop.evaluate(() => (window as any).reviewFixture.refresh()); await desktop.waitForTimeout(250);
    assert.equal(requests.filter(r => r.method === 'PUT').length, writesBefore);
    await desktop.reload(); await desktop.getByRole('button', { name: 'Use Rhona fixture' }).click();
    await desktop.getByRole('button', { name: 'Compare / reload shared version' }).waitFor();
    await desktop.waitForTimeout(250); assert.equal(requests.filter(r => r.method === 'PUT').length, writesBefore);
    await desktop.getByRole('button', { name: 'Compare / reload shared version' }).click();
    await desktop.getByText('Current shared text: Live server version for comparison.', { exact: false }).waitFor();
    await desktop.getByRole('button', { name: 'Retry my change against this version' }).click();
    await waitFor(desktop, () => (window as any).reviewFixture.syncState().state === 'idle');
    assert.equal(comments.get(first.id)!.text, 'My conflicting local edit.');
    assert.equal(comments.get(first.id)!.originalContext.description, originalDescription);
    checks.push('held conflict survives submit refresh and reload; live compare; explicit retry; immutable context');
    // Keyboard targeting prevents Enter activation and Escape clears all temporary UI.
    await desktop.getByRole('button', { name: 'Mark this page', exact: true }).first().click();
    await desktop.locator('#nested-target').focus(); await desktop.keyboard.press('Enter');
    await desktop.getByRole('dialog', { name: 'Confirm review target' }).waitFor();
    await desktop.getByRole('button', { name: 'Child: target-child', exact: true }).click();
    await desktop.getByRole('button', { name: 'Parent element', exact: true }).click();
    await desktop.keyboard.press('Escape'); assert.equal(await desktop.locator('#__an_target').count(), 0);
    assert.equal(await desktop.locator('#__an_targetoutline').count(), 0);
    // Private targets and ranges are blocked, including descendants and forms.
    for (const selector of ['#private-button', '#excluded-button', '#form-text', '#editable']) {
      await desktop.evaluate(() => (window as any).reviewFixture.setTool('pin'));
      await desktop.locator(selector).click(); assert.equal(await desktop.locator('#__an_target').count(), 0);
    }
    await desktop.keyboard.press('Escape');
    await desktop.evaluate(() => {
      (window as any).reviewFixture.setTool('highlight');
      const range = document.createRange(); range.setStartBefore(document.querySelector('#public-text')!); range.setEndAfter(document.querySelector('#private-text')!);
      getSelection()!.removeAllRanges(); getSelection()!.addRange(range);
      document.querySelector('#public-text')!.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch' }));
    });
    await desktop.waitForTimeout(100); assert.equal(await desktop.locator('#__an_compose.an-show').count(), 0);
    checks.push('keyboard target and parent/child adjustment, Escape cleanup, private/excluded/form/editable/range capture rejected');
    // Public native selection still offers a description composer.
    await desktop.evaluate(() => {
      getSelection()!.removeAllRanges(); (window as any).reviewFixture.setTool('highlight');
      const n = document.querySelector('#public-text')!; const r = document.createRange(); r.selectNodeContents(n); getSelection()!.addRange(r);
      n.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch' }));
    });
    await desktop.locator('#__an_compose.an-show').waitFor();
    await post(desktop, 'Native selection fallback comment.');
    checks.push('native text-selection fallback');
    const mobile = await pageAt(390, 844, true); await mobile.bringToFront();
    await mobile.getByRole('button', { name: 'Mark this page', exact: true }).first().click();
    await mobile.waitForTimeout(400);
    // CDP sends browser touch events, allowing Chromium to perform native scrolling.
    const cdp = await mobile.context().newCDPSession(mobile); const beforeScroll = await mobile.evaluate(() => scrollY);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 180, y: 580 }] });
    for (let y = 560; y >= 220; y -= 34) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 180, y }] }); await mobile.waitForTimeout(25); }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await mobile.waitForTimeout(300);
    assert(await mobile.evaluate(() => scrollY) > beforeScroll + 40, 'tap-select must preserve swipe scroll');
    assert.equal(await mobile.locator('#__an_target').count(), 0);
    await mobile.waitForTimeout(1000);
    await mobile.locator('#target-child').scrollIntoViewIfNeeded(); await mobile.waitForTimeout(250);
    await mobile.locator('#target-child').tap();
    await mobile.getByRole('dialog', { name: 'Confirm review target' }).waitFor();
    await mobile.getByRole('button', { name: 'Parent element', exact: true }).click();
    await mobile.getByRole('button', { name: 'Use this target', exact: true }).click();
    await mobile.locator('#__an_compose textarea').fill('Phone draft survives keyboard resize and rotation.');
    await mobile.waitForTimeout(250); await mobile.screenshot({ path: path.join(output, 'composer-390x844.png') }); await noOverflow(mobile);
    await mobile.setViewportSize({ width: 390, height: 420 });
    for (const name of ['Comment', 'Cancel', 'Close and keep draft']) {
      const b = mobile.locator('#__an_compose').getByRole('button', { name, exact: true }); await b.scrollIntoViewIfNeeded();
      const r = await b.boundingBox(); assert(r && r.height >= 44 && r.y + r.height <= 420, 'composer button fits reduced visual viewport');
    }
    await mobile.setViewportSize({ width: 844, height: 390 });
    assert.equal(await mobile.locator('#__an_compose textarea').inputValue(), 'Phone draft survives keyboard resize and rotation.');
    await mobile.waitForTimeout(250); await mobile.screenshot({ path: path.join(output, 'composer-844x390.png') }); await noOverflow(mobile);
    await mobile.locator('#__an_compose').getByRole('button', { name: 'Close and keep draft', exact: true }).click();
    await mobile.evaluate(() => (window as any).reviewFixture.open());
    await mobile.getByRole('button', { name: 'Resume draft', exact: true }).click();
    assert.equal(await mobile.locator('#__an_compose textarea').inputValue(), 'Phone draft survives keyboard resize and rotation.');
    await mobile.setViewportSize({ width: 390, height: 844 });
    await mobile.locator('#__an_compose textarea').fill('x'.repeat(5001));
    const countBefore = comments.size;
    await mobile.locator('#__an_compose').getByRole('button', { name: 'Comment', exact: true }).click();
    await mobile.getByText('Write a description of 1 to 5,000 characters before sharing.', { exact: true }).waitFor();
    assert.equal(comments.size, countBefore); assert.equal((await mobile.locator('#__an_compose textarea').inputValue()).length, 5001);
    await post(mobile, 'Phone draft shared after rotation.');
    assert.equal(await mobile.getByRole('button', { name: 'Resume draft', exact: true }).isVisible(), false);
    const storedComposer = await mobile.evaluate(() => Object.entries(localStorage).filter(([key]) => key.endsWith(':composer')).map(([, value]) => JSON.parse(value).value));
    assert(storedComposer.every(value => value === 'null')); // Queued records remain separate from the composer.
    checks.push('rejected composer preserves text and Resume; successful commit clears composer recovery');
    checks.push('390x844 touch swipe scroll, tap and parent confirmation, 44px actions, reduced viewport, 844x390 rotation, close/resume, 5001 character rejection');
    // Drawing is explicit; Escape and pointercancel remove the temporary stroke.
    async function draw(tool: 'pen' | 'rect' | 'circle', cancel?: 'Escape' | 'pointercancel') {
      await mobile.evaluate(t => (window as any).reviewFixture.setTool(t), tool);
      await mobile.locator('#drawing').scrollIntoViewIfNeeded(); const box = await mobile.locator('#drawing').boundingBox(); assert(box);
      await mobile.mouse.move(box.x + 20, box.y + 30); await mobile.mouse.down(); await mobile.mouse.move(box.x + 100, box.y + 90, { steps: 8 });
      if (cancel === 'Escape') await mobile.keyboard.press('Escape');
      if (cancel === 'pointercancel') await mobile.evaluate(() => document.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true })));
      await mobile.mouse.up();
    }
    await draw('pen', 'Escape'); assert.equal(await mobile.locator('#__an_compose.an-show').count(), 0);
    await draw('rect', 'pointercancel'); assert.equal(await mobile.locator('#__an_compose.an-show').count(), 0);
    await draw('pen'); await mobile.locator('#__an_compose.an-show').waitFor();
    await mobile.locator('#__an_compose').getByRole('button', { name: 'Comment', exact: true }).click();
    assert.equal(comments.size, countBefore + 1);
    await post(mobile, 'Original diagram description from the phone.');
    const pen = [...comments.values()].find(c => c.type === 'pen'); assert(pen && pen.originalContext.componentLabel === 'Public diagram');
    await mobile.getByText('Original description only. No snapshot was saved.', { exact: true }).waitFor();
    await desktop.bringToFront(); await desktop.evaluate(() => (window as any).reviewFixture.refresh());
    await desktop.getByText(pen.text, { exact: true }).waitFor();
    const penCard = desktop.locator(`.an-card[data-id="${pen.id}"]`);
    await penCard.getByText('Anchor unavailable.', { exact: false }).waitFor();
    assert.equal(await desktop.locator('#__an_overlay path.an-hit').count(), 0);
    await penCard.scrollIntoViewIfNeeded();
    await penCard.locator('summary').click();
    await penCard.getByText('Original description: ' + pen.text, { exact: true }).waitFor();
    await noOverflow(desktop);
    await desktop.screenshot({ path: path.join(output, 'phone-pen-on-desktop.png') });
    await mobile.bringToFront();
    for (const shape of ['rect', 'circle'] as const) {
      await draw(shape); await post(mobile, 'Synthetic ' + shape + ' description.');
      assert([...comments.values()].some(c => c.type === 'shape' && c.geom.kind === shape && c.originalContext.description === 'Synthetic ' + shape + ' description.'));
    }
    checks.push('rectangle and circle creation with immutable context');
    checks.push('pen requires description, Escape/pointercancel cleanup, immutable pen context, cross-viewport original-description fallback');
    await mobile.waitForTimeout(4000); // Let validation toasts finish before layout evidence.
    for (const [w, h] of [[768, 1024], [844, 390]] as const) {
      await mobile.setViewportSize({ width: w, height: h }); await mobile.waitForTimeout(250); await noOverflow(mobile);
      await mobile.screenshot({ path: path.join(output, `threads-${w}x${h}.png`) });
    }
    await mobile.setViewportSize({ width: 390, height: 844 });
    // Draft TTL: seed an aged queued operation using the same full-scope namespace.
    await mobile.evaluate(() => {
      const entries = Object.keys(localStorage).filter(k => k.endsWith(':annotate:queue:october'));
      for (const k of entries) localStorage.setItem(k, JSON.stringify({ reviewDraft: 1, expiresAt: Date.now() + 86400000, value: JSON.stringify([{ t:'put', id:'expired-fixture', key:'expired', f:['*'], createdAt:Date.now() - 8 * 86400000 }]) }));
    });
    const oldWriteCount = requests.filter(r => r.method === 'PUT').length;
    await mobile.reload(); await mobile.getByRole('button', { name: 'Use Rhona fixture' }).click();
    await mobile.locator('#__an_expiry').waitFor(); await mobile.waitForTimeout(200);
    assert.equal(requests.filter(r => r.method === 'PUT').length, oldWriteCount);
    checks.push('expired queue never replays; visible expiry notice');
    // A server tombstone removes the shared mark while retaining refused local words.
    const doomed = [...comments.values()].find(c => c.type === 'highlight')!;
    const doomedCard = mobile.locator(`.an-card[data-id="${doomed.id}"]`);
    await doomedCard.locator('.an-cact').getByRole('button', { name: 'Reply', exact: true }).click();
    await doomedCard.getByRole('textbox', { name: 'Reply text', exact: true }).fill('Local words on a deleted thread.');
    deleted.add(doomed.id); comments.delete(doomed.id); sequence++;
    await doomedCard.locator('.an-replybox').getByRole('button', { name: 'Reply', exact: true }).click();
    await mobile.getByText('This thread was deleted.', { exact: false }).waitFor();
    assert.equal(await mobile.locator(`.an-card[data-id="${doomed.id}"]`).count(), 0);
    await mobile.reload(); await mobile.getByRole('button', { name: 'Use Rhona fixture' }).click();
    await mobile.getByText('Local words on a deleted thread.', { exact: false }).waitFor();
    await mobile.getByRole('button', { name: 'Discard deleted thread draft', exact: true }).click();
    assert.equal(await mobile.locator('.an-deleted-draft').count(), 0);
    checks.push('410 tombstone never reappears as a thread; refused local words survive reload until explicit discard');
    // An unsent reply survives reload in the original actor scope and never appears for another actor.
    await mobile.waitForTimeout(250);
    const localCard = mobile.locator(`.an-card[data-id="${first.id}"]`);
    await localCard.locator('.an-cact').getByRole('button', { name: 'Reply', exact: true }).click();
    await localCard.getByRole('textbox', { name: 'Reply text', exact: true }).fill('Unsent actor isolated reply draft.');
    await mobile.reload(); await mobile.getByRole('button', { name: 'Use Rhona fixture' }).click();
    await mobile.getByRole('textbox', { name: 'Reply text', exact: true }).waitFor();
    assert.equal(await mobile.getByRole('textbox', { name: 'Reply text', exact: true }).inputValue(), 'Unsent actor isolated reply draft.');
    await mobile.getByRole('button', { name: 'Close comments panel', exact: true }).click();
    await mobile.getByRole('button', { name: 'Sign out', exact: true }).click();
    await mobile.getByRole('button', { name: 'Use Chad fixture' }).click();
    await waitFor(mobile, () => (window as any).reviewFixture.syncState().state === 'idle');
    assert.equal(await mobile.locator('.an-replybox.an-show').count(), 0);
    assert(![...comments.values()].some(c => c.replies.some((r: any) => r.text === 'Unsent actor isolated reply draft.')));
    checks.push('typed unsent reply survives reload and is isolated from another actor');
    await mobile.getByRole('button', { name: 'Close comments panel', exact: true }).click();
    await mobile.locator('#fee-document').tap();
    assert.equal(await mobile.locator('#document-result').textContent(), 'The fixture document opened.');
    assert.equal(await mobile.locator('#__an_compose.an-show').count(), 0);
    checks.push('Browse restores ordinary control activation on phone');
    // Hook runs after native reply UI, survives re-render, and disposes on teardown.
    await other.bringToFront();
    // tsx preserves function names using this helper in serialized nested callbacks.
    await other.evaluate('window.__name = (fn) => fn');
    const hookResult = await other.evaluate(async () => {
      (window as any).reviewFixture.stop();
      const { createController } = await import('/dist/review/vendor/annotate.mjs');
      const session = await fetch('/api/review/session', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({pagePath:'/'}) }).then(r => r.json());
      let cleanups = 0, teardown = 0, native = false;
      const renderer = createController(window);
      renderer.init({ project:'shared-review', page:'/', api:'/api/review', reviewId:'october', startOpen:true,
        integration:{ initialSession:session, storageNamespace:'hook-fixture', getSession:async () => session, request:(url: string, init: RequestInit) => fetch(url,{...init,credentials:'same-origin'}),
          decorateThread: (_c: unknown, card: HTMLElement) => { native = native || !!card.querySelector('.an-replybox textarea'); const extra = document.createElement('p'); extra.textContent='Synthetic sidecar'; card.append(extra); return () => { cleanups++; extra.remove(); }; }, teardown:() => { teardown++; } } });
      renderer.open();
      await new Promise(r => setTimeout(r, 500)); renderer.open();
      const hasExtra = !!document.querySelector('.an-card p:last-child'); renderer.destroy();
      return { cleanups, teardown, native, hasExtra, hosts: document.querySelectorAll('#__an_host').length };
    });
    assert(hookResult.native && hookResult.cleanups > 0 && hookResult.teardown === 1 && hookResult.hosts === 0);
    checks.push('decorateThread retains native replies, rerender cleanup and integration teardown');
    const storage = await desktop.evaluate(() => Object.entries(localStorage));
    assert(!storage.some(([, value]) => [...grants.keys()].some(token => value.includes(token))));
    assert(!storage.some(([, value]) => value.includes('Synthetic private sentinel') || value.includes('synthetic-secret')));
    assert.deepEqual(errors, []); assert.deepEqual(external, []);
    const report = { result: 'passed locally', environment: 'synthetic loopback only; no env file loaded', browser: await browser.version(), headed: process.env.REVIEW_HEADLESS !== '1',
      viewports: ['1440x900', '1280x720', '390x844', '844x390', '768x1024', '390x420 reduced viewport'], checks, visibilityMs, comments: comments.size, requests: requests.length, pageErrors: errors, externalRequests: external,
      physicalDeviceAcceptance: 'Not run. Real iPhone Safari, Android Chrome, tablet, software keyboard and Rhona acceptance remain required.' };
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    if (desktop) await desktop.screenshot({ path: path.join(output, 'failure.png') });
    fs.writeFileSync(path.join(output, 'failure.json'), JSON.stringify({ error: String(error), pageErrors: errors, requests }, null, 2)); throw error;
  } finally { await browser.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
}
main().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
