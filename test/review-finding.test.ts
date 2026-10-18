// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFindingPanels } from '../src/review/finding.js';

const scope = { appId: 'app', tenantId: null, environment: 'test', campaignId: 'campaign', pagePath: '/', resourceId: null };
let teardown = () => {};
afterEach(() => { teardown(); document.body.replaceChildren(); window.localStorage.clear(); });
function setup(role = 'lead', override: Record<string, unknown> = {}) {
  const finding = { thread_id: '30000000-0000-4000-8000-000000000001', version: 4, state: 'needs_decision', details: null, owner_id: null, tester_id: null, fix_build: null, target_id: null, ...override };
  const snapshot = { finding, delivery: null, retests: [], members: [{ id: 'rhona', name: 'Rhona', role: 'reviewer' }, { id: 'chad', name: 'Chad', role: 'lead' }] };
  const request = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(snapshot), { status: 200 }));
  const panels = createFindingPanels({ host: window, scope, actorId: 'chad', buildId: 'build-a', gateway: 'http://localhost/api/review',
    request, getSession: async () => ({ actor: { id: 'chad', name: 'Chad', role: role as any }, scope, buildId: 'build-a', token: 'fixture', expiresAt: new Date(Date.now() + 600000).toISOString() }), returnPath: '/review/return' });
  teardown = panels.teardown;
  const card = document.createElement('article'); document.body.append(card);
  panels.decorateThread({ id: 'c1', authorId: 'rhona', text: 'Broken document control' }, card);
  const details = card.querySelector('details')!; details.open = true; details.dispatchEvent(new Event('toggle'));
  return { card, request, snapshot, panels };
}
async function loaded() { await vi.waitFor(() => expect(document.body.textContent).toContain('Reload shared details')); }
function click(text: string) { const b = [...document.querySelectorAll('button')].find(b => b.textContent === text); expect(b).toBeDefined(); b!.click(); }

describe('finding decisions and retest UI', () => {
  it('viewers see progress but no finding mutations', async () => {
    setup('viewer'); await loaded();
    expect(document.querySelector('form')).toBeNull();
    expect(document.body.textContent).not.toContain('Send finding to Plane');
    expect(document.body.textContent).not.toContain('Retest passed');
  });
  it('sends structured details with current version and an operation identity', async () => {
    const { card, request } = setup(); await loaded();
    const form = card.querySelector<HTMLFormElement>('form[aria-label="Finding details"]')!;
    const fields = form.querySelectorAll('textarea'); fields[0].value = 'Open correct document'; fields[1].value = 'Nothing opens'; fields[2].value = 'Parents cannot read fees';
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.waitFor(() => expect(request.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true));
    const [url, init] = request.mock.calls.find(([, init]) => init?.method === 'POST')!;
    expect(url).toContain('/threads/c1/finding');
    expect(JSON.parse(init!.body as string)).toMatchObject({ expectedVersion: 4, command: 'describe', details: { category: 'bug', expected: 'Open correct document', actual: 'Nothing opens', impact: 'Parents cannot read fees' } });
    expect(new Headers(init!.headers).get('idempotency-key')).toBeTruthy();
  });
  it('retains an unconfirmed operation and retries identical bytes and key', async () => {
    const { request } = setup('lead', { details: { category: 'bug', expected: 'x', actual: 'y', impact: 'z' } }); await loaded();
    request.mockRejectedValueOnce(new Error('lost response')); click('Send finding to Plane');
    await vi.waitFor(() => expect(document.body.textContent).toContain('Retry unconfirmed change'));
    const first = request.mock.calls.find(([, init]) => init?.method === 'POST')![1]!;
    click('Retry unconfirmed change');
    await vi.waitFor(() => expect(request.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(2));
    const last = request.mock.calls.filter(([, init]) => init?.method === 'POST')[1][1]!;
    expect(last.body).toBe(first.body); expect(new Headers(last.headers).get('idempotency-key')).toBe(new Headers(first.headers).get('idempotency-key'));
  });
  it('hides pass/fail on a stale build even for assigned tester', async () => {
    setup('reviewer', { state: 'ready_for_retest', tester_id: 'chad', fix_build: 'new-build', target_id: 'preview' }); await loaded();
    expect(document.body.textContent).toContain('not the confirmed test build');
    expect([...document.querySelectorAll('button')].some(b => b.textContent === 'Retest passed')).toBe(false);
  });
  it('only verified names appear as assignment choices', async () => {
    setup(); await loaded();
    const labels = [...document.querySelectorAll('option')].map(o => o.textContent);
    expect(labels).toContain('Rhona'); expect(labels).toContain('Chad'); expect(labels).not.toContain('rhona');
  });
  it('uses text nodes for untrusted comments and reasons', async () => {
    setup('viewer', { reason: '<img src=x onerror=alert(1)>' }); await loaded();
    expect(document.querySelector('img')).toBeNull(); expect(document.body.textContent).toContain('<img src=x');
  });
  it('teardown ignores late shared responses', async () => {
    const { panels } = setup(); panels.teardown(); await new Promise(r => setTimeout(r, 10));
    expect(document.body.textContent).not.toContain('Save finding details');
  });
});
