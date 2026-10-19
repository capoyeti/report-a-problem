/** Browser -> same-origin gateway -> real Next routes -> disposable PostgreSQL.
 * Start service with npm run dev:reviews:local, then pass its loopback URL only.
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright';
import { createReviewGatewayHandlers } from '../src/review/server.js';

const service = new URL(process.env.REVIEW_LOCAL_SERVICE_URL ?? 'http://invalid');
if (service.protocol !== 'http:' || service.hostname !== '127.0.0.1' || !service.port || service.username || service.password) throw new Error('An explicit disposable loopback service URL is required');
const root = path.resolve(new URL('..', import.meta.url).pathname);
const output = path.join(root, 'docs/review-service-evidence');
const campaignId = '30000000-0000-4000-8000-000000000001';
const scope = { appId: '10000000-0000-4000-8000-000000000001', tenantId: null, environment: 'test', campaignId, pagePath: '/page', resourceId: null };
const actors: Record<string, string> = { alice: 'Rhona Fixture', chad: 'Chad Fixture', bob: 'Bob Fixture', viewer: 'Viewer Fixture' };
let deniedActor: string | null = null;
let currentBuild = 'build-old';
const traces: Array<{ method: string; path: string; status: number }> = [];
const server = http.createServer(async (req, res) => {
  const address = server.address(); if (!address || typeof address === 'string') return res.end();
  const origin = `http://127.0.0.1:${address.port}`;
  const url = new URL(req.url ?? '/', origin);
  const actor = /(?:^|;\s*)fixture_actor=([a-z]+)/.exec(req.headers.cookie ?? '')?.[1] ?? null;
  function json(status: number, value: unknown, headers: Record<string, string> = {}) { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers }).end(JSON.stringify(value)); }
  try {
    if (url.pathname === '/fixture/login') {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const input = JSON.parse(Buffer.concat(chunks).toString()); if (!actors[input.actor]) return json(403, {});
      return json(200, {}, { 'set-cookie': `fixture_actor=${input.actor}; HttpOnly; SameSite=Strict; Path=/` });
    }
    if (url.pathname === '/fixture/logout') return json(200, {}, { 'set-cookie': 'fixture_actor=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
    if (url.pathname.startsWith('/api/review/')) {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const headers = new Headers(); for (const [k, value] of Object.entries(req.headers)) if (value && !['content-length', 'connection'].includes(k)) headers.set(k, String(value));
      const request = new Request(url, { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method!) ? undefined : Buffer.concat(chunks) });
      // Compare fields rather than object insertion order across JSON boundaries.
      const scopedGateway = createReviewGatewayHandlers({ enabled: true, serviceUrl: service.origin, serviceKey: 'spr-local-only', appId: scope.appId, environment: 'test', buildId: currentBuild,
        verifySession: async () => actor && actors[actor] ? { user: { id: actor, name: actors[actor] }, tenantId: null } : { error: 'no_session' },
        authorizeResource: async (_current, actual) => actor !== deniedActor && Object.entries(scope).every(([k, v]) => actual[k as keyof typeof actual] === v),
      });
      const response = url.pathname === '/api/review/session' ? await scopedGateway.session(request)
        : url.pathname.startsWith('/api/review/return/') ? await scopedGateway.resolveReturn(request, url.pathname.split('/').at(-1)!)
        : await scopedGateway.forward(request, url.pathname.replace('/api/review/v1/', '/api/v1/') + url.search);
      traces.push({ method: req.method!, path: url.pathname, status: response.status });
      res.writeHead(response.status, Object.fromEntries(response.headers)).end(Buffer.from(await response.arrayBuffer())); return;
    }
    if (url.pathname === '/page' || url.pathname === '/') { res.writeHead(200, { 'content-type': 'text/html' }).end(fs.readFileSync(path.join(root, 'examples/review-service/index.html'), 'utf8').replaceAll('build-old', currentBuild)); return; }
    if (url.pathname.startsWith('/dist/')) {
      const file = path.resolve(root, '.' + url.pathname); if (!file.startsWith(root + '/dist/') || !fs.existsSync(file)) return json(404, {});
      res.writeHead(200, { 'content-type': 'text/javascript' }).end(fs.readFileSync(file)); return;
    }
    res.writeHead(url.pathname === '/favicon.ico' ? 204 : 404).end();
  } catch (error) { console.error('Fixture request failed', String(error)); json(500, { error: 'fixture_error' }); }
});
async function main() {
  fs.mkdirSync(output, { recursive: true });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r)); const address = server.address(); assert(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  const fixtureContainer = process.env.REVIEW_LOCAL_DB_CONTAINER;
  if (fixtureContainer) {
    if (!/^spr-test-[a-f0-9]{8}$/.test(fixtureContainer)) throw new Error('Only an explicit disposable review fixture container is allowed');
    const inspect = spawnSync('docker', ['inspect', fixtureContainer], { encoding: 'utf8' });
    if (inspect.status !== 0) throw new Error('Disposable fixture container not found');
    const actual = JSON.parse(inspect.stdout)[0];
    if (actual.Config.Image !== 'postgres:17' || !actual.Config.Labels?.['spr.checkout']?.includes('error-triage-service')
      || !actual.Config.Env.includes('POSTGRES_DB=review_test')
      || !actual.NetworkSettings.Ports['5432/tcp']?.every((p: any) => p.HostIp === '127.0.0.1')) throw new Error('Refusing non-fixture database');
    const probe = spawnSync('docker', ['exec', fixtureContainer, 'psql', '-U', 'postgres', '-d', 'review_test', '-Atq', '-c', "SELECT slug FROM public.apps WHERE id='10000000-0000-4000-8000-000000000001'"], { encoding: 'utf8' });
    if (probe.status !== 0 || probe.stdout.trim() !== 'spr-fixture') throw new Error('Refusing database without synthetic app');
    // This is test setup, equivalent to the release owner registering a target.
    const update = spawnSync('docker', ['exec', fixtureContainer, 'psql', '-U', 'postgres', '-d', 'review_test', '-v', 'ON_ERROR_STOP=1', '-c', `UPDATE public.review_targets SET origin='${origin}',reachable_at=clock_timestamp() WHERE app_id='10000000-0000-4000-8000-000000000001' AND id='local-test'`], { encoding: 'utf8' });
    if (update.status !== 0) throw new Error('Could not register the disposable target: ' + update.stderr);
  }
  const browser = await chromium.launch({ headless: process.env.REVIEW_HEADLESS === '1', slowMo: process.env.REVIEW_HEADLESS === '1' ? 0 : 300 });
  const a = await browser.newContext({ viewport: { width: 1440, height: 900 } }), b = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const alice = await a.newPage(), chad = await b.newPage(); const errors: string[] = [];
  for (const p of [alice, chad]) { p.on('pageerror', e => errors.push(e.message)); await p.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort()); await p.goto(origin + '/page'); }
  const idle = (p: typeof alice) => p.waitForFunction(() => (window as any).reviewFixture?.syncState().state === 'idle', undefined, { timeout: 30000 });
  try {
    await alice.getByRole('button', { name: 'Use Rhona fixture' }).click(); await chad.getByRole('button', { name: 'Use Chad fixture' }).click(); await idle(alice); await idle(chad);
    const text = 'Local service review ' + Date.now();
    await alice.locator('#__an_bar [data-tool=pin]').click(); await alice.locator('#fee-document').click();
    const confirm = alice.getByRole('button', { name: /Confirm target|Use this component|Use this target/ }); if (await confirm.count()) await confirm.click();
    await alice.locator('#__an_compose textarea').fill(text); await alice.locator('#__an_compose').getByRole('button', { name: 'Comment', exact: true }).click(); await idle(alice);
    assert.equal(await alice.locator('#document-result').textContent(), 'The document has not been opened.');
    await chad.locator('#refresh-review').click(); await chad.getByText(text, { exact: true }).waitFor();
    const card = chad.locator('.an-card').filter({ hasText: text });
    await card.locator('.an-cact').getByRole('button', { name: 'Reply', exact: true }).click(); await card.locator('.an-replybox textarea').fill('Confirmed against real local storage.'); await card.locator('.an-replybox').getByRole('button', { name: 'Reply', exact: true }).click(); await idle(chad);
    await alice.locator('#refresh-review').click(); await alice.locator('.an-card').filter({ hasText: text }).getByText('Confirmed against real local storage.', { exact: false }).waitFor();
    const saved = await alice.evaluate((text) => (window as any).reviewFixture.comments().find((c: any) => c.text === text), text);
    assert.equal(saved.authorId, 'alice'); assert.equal(saved.author, 'Rhona Fixture'); assert.equal(saved.replies[0].authorId, 'chad');
    await alice.screenshot({ path: path.join(output, 'two-reviewers-real-service.png'), fullPage: true });
    // Full finding UI only exists after the renderer hook is integrated.
    await card.locator('.an-finding summary').click();
    const form = card.getByRole('form', { name: 'Finding details' }); await form.waitFor();
    await form.getByLabel('What should happen?').fill('The approved document opens.');
    await form.getByLabel('What actually happens?').fill(text);
    await form.getByLabel('Who is affected, and how?').fill('Parents cannot read the document.');
    await form.getByRole('button', { name: 'Save finding details' }).click();
    await card.getByRole('button', { name: 'Send finding to Plane' }).waitFor(); await card.getByRole('button', { name: 'Send finding to Plane' }).click();
    await card.getByText('Waiting to file in Plane', { exact: true }).waitFor();
    await chad.screenshot({ path: path.join(output, 'promoted-finding.png'), fullPage: true });
    await card.getByRole('button', { name: 'Copy link to this thread' }).waitFor();
    await card.getByRole('button', { name: 'Copy link to this thread' }).click();
    await chad.setViewportSize({ width: 390, height: 844 });
    await card.getByText(/Thread link copied|Select and copy the thread link below/).waitFor();
    await chad.screenshot({ path: path.join(output, 'copy-status-after-redraw-390.png') });
    await chad.setViewportSize({ width: 1280, height: 900 });
    await card.getByText(/Thread link copied|Select and copy the thread link below/).waitFor();

    if (fixtureContainer) {
      const assignment = card.getByRole('form', { name: 'Assign follow-up' });
      await assignment.getByLabel('Who will follow up?').selectOption('chad');
      await assignment.getByLabel('Who will retest?').selectOption('alice');
      await assignment.getByRole('button', { name: 'Save assignment' }).click();
      await card.getByRole('button', { name: 'Start follow-up' }).click();
      await card.getByLabel('GitHub pull request link').fill('https://github.com/example/fixture/pull/1');
      await card.getByRole('button', { name: 'Record proposed fix' }).click();
      await card.getByRole('button', { name: 'Ready for retest', exact: true }).click();
      const aliceCard = alice.locator('.an-card').filter({ hasText: text });
      await aliceCard.locator('.an-finding summary').click();
      await aliceCard.getByText('This is not the confirmed test build.', { exact: false }).waitFor();
      assert.equal(await aliceCard.getByRole('button', { name: 'Retest passed', exact: true }).count(), 0);
      currentBuild = 'build-new';
      await alice.reload(); await alice.getByRole('button', { name: 'Use Rhona fixture' }).click(); await idle(alice);
      const retestCard = alice.locator('.an-card').filter({ hasText: text }); await retestCard.locator('.an-finding summary').click();
      const retest = retestCard.getByRole('form', { name: 'Retest result' });
      await retest.getByLabel('What did you observe during the retest?').fill('The document still fails in this registered build.');
      await retest.getByRole('button', { name: 'Retest failed', exact: true }).click();
      await retestCard.getByText('Retest failed', { exact: true }).waitFor();
      await alice.screenshot({ path: path.join(output, 'failed-retest-reopened.png'), fullPage: true });
      await chad.reload(); await chad.getByRole('button', { name: 'Use Chad fixture' }).click(); await idle(chad);
      const leadCard = chad.locator('.an-card').filter({ hasText: text }); await leadCard.locator('.an-finding summary').click();
      await leadCard.getByRole('button', { name: 'Ready for retest', exact: true }).click();
      await retestCard.getByRole('button', { name: 'Reload shared details', exact: true }).click();
      await retest.getByLabel('What did you observe during the retest?').fill('Confirmed the approved document opens on this registered build.');
      await retest.getByRole('button', { name: 'Retest passed', exact: true }).click();
      await retestCard.getByText('Verified by a tester', { exact: true }).waitFor();
      await retestCard.getByText('The document still fails in this registered build.', { exact: false }).waitFor();
      await retestCard.getByText('Confirmed the approved document opens on this registered build.', { exact: false }).waitFor();
      await alice.screenshot({ path: path.join(output, 'verified-retest.png'), fullPage: true });
      // Update the other browser too before the access-revocation check.
      await chad.reload(); await chad.getByRole('button', { name: 'Use Chad fixture' }).click(); await idle(chad);
    }

    const thread = await chad.evaluate(async ({ campaign, id }) => {
      const prefix = Object.keys(localStorage).find(k => k.includes('an-session'));
      return { prefix, id, campaign };
    }, { campaign: campaignId, id: saved.id });
    assert(!thread.prefix, 'No grant stored on device');
    deniedActor = 'alice'; await alice.locator('#refresh-review').click(); await alice.locator('#__an_host').waitFor({ state: 'detached', timeout: 15000 });
    assert.deepEqual(errors, []);
    const result = { result: 'passed', testedAt: new Date().toISOString(), browser: browser.version(), headed: process.env.REVIEW_HEADLESS !== '1', service: 'disposable loopback Next/PostgREST/PostgreSQL17', checks: ['two cookie-authenticated reviewers', 'real create/read/reply', 'server identity stamps', 'component does not activate', 'structured finding saved', 'canonical report reserved', 'copy confirmation survives responsive redraw', 'Plane delivery off', 'host access revocation destroys overlay', ...(fixtureContainer ? ['verified assignment', 'proposed fix recorded', 'stale-build retest blocked', 'failed retest reopens with history', 'registered new-build retest passed without erasing failure'] : []), 'no browser external requests', 'no page errors'], traces };
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(result, null, 2) + '\n'); console.log(JSON.stringify({ ...result, traces: traces.length }));
  } catch (e) {
    await alice.screenshot({ path: path.join(output, 'failure-alice.png'), fullPage: true }); await chad.screenshot({ path: path.join(output, 'failure-chad.png'), fullPage: true });
    fs.writeFileSync(path.join(output, 'failure.json'), JSON.stringify({ error: String(e), errors, traces }, null, 2)); throw e;
  } finally { await browser.close(); server.close(); }
}
main().catch(e => { console.error(e); server.close(); process.exitCode = 1; });
