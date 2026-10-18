/** Real-browser integration proof against a loopback-only synthetic wire server. */
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { chromium, type Page } from 'playwright';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const output = path.join(root, 'docs/review-spike-evidence');
const actors: Record<string, { id: string; name: string; role: string }> = {
  rhona: { id: 'rhona', name: 'Rhona', role: 'reviewer' }, chad: { id: 'chad', name: 'Chad', role: 'lead' },
};
type Comment = Record<string, any>;
const comments = new Map<string, Comment>();
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
      res.writeHead(200, { 'content-type': 'text/html' }).end(fs.readFileSync(path.join(root, 'examples/review-spike/index.html'))); return;
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
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const browser = await chromium.launch({ headless: process.env.REVIEW_HEADLESS === '1', slowMo: process.env.REVIEW_HEADLESS === '1' ? 0 : 300 });
  const a = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const b = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const rhona = await a.newPage(), chad = await b.newPage();
  const errors: string[] = [];
  for (const page of [rhona, chad]) {
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
    await page.goto(base);
  }
  try {
    await rhona.getByRole('button', { name: 'Use Rhona fixture' }).click();
    await chad.getByRole('button', { name: 'Use Chad fixture' }).click();
    await waitFor(rhona, () => (window as any).reviewFixture?.syncState().state === 'idle');
    await waitFor(chad, () => (window as any).reviewFixture?.syncState().state === 'idle');
    await rhona.locator('#__an_bar [data-tool=pin]').click();
    await rhona.locator('#fee-document').click();
    assert.equal(await rhona.locator('#document-result').textContent(), 'The document has not been opened.');
    await rhona.locator('#__an_compose textarea').fill('The next-year fee document should open here.');
    await rhona.locator('#__an_compose').getByRole('button', { name: 'Comment', exact: true }).click();
    await waitFor(rhona, () => (window as any).reviewFixture?.syncState().state === 'idle');
    await chad.bringToFront(); await chad.locator('#refresh-review').click();
    await chad.getByText('The next-year fee document should open here.', { exact: true }).waitFor();
    await chad.locator('.an-card .an-cact').getByRole('button', { name: 'Reply', exact: true }).click();
    await chad.locator('.an-replybox textarea').fill('I can reproduce this.');
    await chad.locator('.an-replybox').getByRole('button', { name: 'Reply', exact: true }).click();
    await waitFor(chad, () => (window as any).reviewFixture?.syncState().state === 'idle');
    await rhona.bringToFront(); await rhona.locator('#refresh-review').click();
    await rhona.getByText('I can reproduce this.', { exact: false }).waitFor();
    assert.equal(comments.size, 1);
    const saved = [...comments.values()][0]; assert.equal(saved.authorId, 'rhona'); assert.equal(saved.replies[0].authorId, 'chad');
    await rhona.screenshot({ path: path.join(output, 'shared-thread-1440.png'), fullPage: true });
    await chad.screenshot({ path: path.join(output, 'shared-thread-1280.png') });
    await a.setOffline(true);
    await rhona.locator('.an-card .an-cact').getByRole('button', { name: 'Reply', exact: true }).click();
    await rhona.locator('.an-replybox textarea').fill('Offline draft belongs to Rhona only.');
    await rhona.locator('.an-replybox').getByRole('button', { name: 'Reply', exact: true }).click();
    await waitFor(rhona, () => (window as any).reviewFixture?.syncState().state === 'offline');
    await rhona.getByRole('button', { name: 'Sign out', exact: true }).click();
    await a.setOffline(false);
    await rhona.getByRole('button', { name: 'Use Chad fixture' }).click();
    await waitFor(rhona, () => (window as any).reviewFixture?.syncState().state === 'idle');
    assert.equal(await rhona.getByText('Offline draft belongs to Rhona only.', { exact: true }).count(), 0);
    assert(![...comments.values()][0].replies.some((r: any) => r.text.includes('Offline draft')));
    const storage = await rhona.evaluate(() => Object.entries(localStorage));
    assert(storage.every(([k]) => k.startsWith('review-draft:v1:')));
    assert(storage.some(([k, v]) => k.includes('rhona') && v.includes('Offline draft')));
    assert(!storage.some(([, v]) => [...grants.keys()].some(token => v.includes(token))));
    await rhona.getByRole('button', { name: 'Sign out', exact: true }).click();
    assert.equal(await rhona.locator('#__an_host').count(), 0);
    assert.deepEqual(errors, []);
    const report = { result: 'passed', checks: ['two verified identities', 'shared create/read/reply', 'pin does not activate target', 'server-stamped authors', 'offline actor isolation', 'no token persistence', 'destroy removes overlay', 'no external requests'], comments: comments.size, requests: requests.length, pageErrors: errors, physicalDeviceAcceptance: 'not run' };
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report));
  } catch (error) {
    await rhona.screenshot({ path: path.join(output, 'failure-rhona.png'), fullPage: true });
    await chad.screenshot({ path: path.join(output, 'failure-chad.png'), fullPage: true });
    fs.writeFileSync(path.join(output, 'failure.json'), JSON.stringify({ error: String(error), pageErrors: errors, requests }, null, 2));
    throw error;
  } finally { await browser.close(); server.close(); }
}
main().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
