// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFindingPanels } from '../src/review/finding.js';

const scope = { appId: 'app', tenantId: null, environment: 'test', campaignId: 'campaign', pagePath: '/', resourceId: null };
let teardown = () => {};
afterEach(() => { teardown(); document.body.replaceChildren(); window.localStorage.clear(); Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value: undefined }); });
function setup(role = 'lead', override: Record<string, unknown> = {}, extra: Record<string, unknown> = {}, actorId = 'chad') {
  const finding = { thread_id: '30000000-0000-4000-8000-000000000001', version: 4, state: 'needs_decision', details: null, owner_id: null, tester_id: null, fix_build: null, target_id: null, ...override };
  const snapshot = { finding, delivery: null, retests: [], members: [{ id: 'rhona', name: 'Rhona', role: 'reviewer' }, { id: 'chad', name: 'Chad', role: 'lead' }], ...extra };
  const request = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(snapshot), { status: 200 }));
  const panels = createFindingPanels({ host: window, scope, actorId, buildId: 'build-a', gateway: 'http://localhost/api/review',
    request, getSession: async () => ({ actor: { id: actorId, name: 'Chad', role: role as any }, scope, buildId: 'build-a', token: 'fixture', expiresAt: new Date(Date.now() + 600000).toISOString() }), returnPath: '/review/return' });
  teardown = panels.teardown;
  const card = document.createElement('article'); document.body.append(card);
  panels.decorateThread({ id: 'c1', authorId: 'rhona', text: 'Broken document control' }, card);
  const details = card.querySelector('details')!; details.open = true; details.dispatchEvent(new Event('toggle'));
  return { card, request, snapshot, panels };
}
async function loaded() { await vi.waitFor(() => expect(document.querySelector('[role="status"]')?.textContent).not.toMatch(/Loading|Open to/)); }
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

describe('durable unconfirmed finding writes', () => {
  it('keeps the operation key after a gateway 503', async () => {
    const { request } = setup('lead', { details: { category: 'bug', expected: 'x', actual: 'y', impact: 'z' } }); await loaded();
    request.mockResolvedValueOnce(new Response('{"error":"unavailable"}', { status: 503 }));
    click('Send finding to Plane'); await vi.waitFor(() => expect(document.body.textContent).toContain('Retry unconfirmed change'));
    const first = request.mock.calls.find(([, init]) => init?.method === 'POST')![1]!;
    click('Retry unconfirmed change'); await vi.waitFor(() => expect(request.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(2));
    const retry = request.mock.calls.filter(([, init]) => init?.method === 'POST')[1][1]!;
    expect(retry.body).toBe(first.body); expect(new Headers(retry.headers).get('idempotency-key')).toBe(new Headers(first.headers).get('idempotency-key'));
  });
  it('restores the exact pending command after the page adapter is recreated', async () => {
    const first = setup('lead', { details: { category: 'bug', expected: 'x', actual: 'y', impact: 'z' } }); await loaded();
    first.request.mockRejectedValueOnce(new Error('acknowledgement lost'));
    click('Send finding to Plane'); await vi.waitFor(() => expect(document.body.textContent).toContain('Retry unconfirmed change'));
    const original = first.request.mock.calls.find(([, init]) => init?.method === 'POST')![1]!;
    first.panels.teardown(); document.body.replaceChildren();
    const next = setup('lead', { version: 8 }); await loaded();
    expect(document.body.textContent).toContain('Retry unconfirmed change'); click('Retry unconfirmed change');
    await vi.waitFor(() => expect(next.request.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true));
    const restored = next.request.mock.calls.find(([, init]) => init?.method === 'POST')![1]!;
    expect(restored.body).toBe(original.body); expect(new Headers(restored.headers).get('idempotency-key')).toBe(new Headers(original.headers).get('idempotency-key'));
  });
});


describe('thread link recovery', () => {
  it('always offers a normal authenticated link and a copy fallback when clipboard is unavailable', async () => {
    setup('viewer'); await loaded();
    expect(document.querySelector<HTMLAnchorElement>('a')?.href).toContain('/review/return?thread=30000000-0000-4000-8000-000000000001');
    click('Copy link to this thread');
    await vi.waitFor(() => expect(document.body.textContent).toContain('Select and copy the thread link below'));
    const fallback = document.querySelector<HTMLInputElement>('input[aria-label="Thread link to copy"]')!;
    expect(fallback.hidden).toBe(false); expect(fallback.readOnly).toBe(true);
  });
});


describe('sidecar drafts and contextual test links', () => {
  const ready = { state: 'ready_for_retest', tester_id: 'chad', fix_build: 'build-a', target_id: 'preview' };
  const target = { testTarget: { id: 'preview', origin: window.location.origin, buildId: 'build-a', reachable: true } };
  it('restores retest observations after renderer decoration is rebuilt', async () => {
    const { card, panels } = setup('reviewer', ready, target); await loaded();
    const observations = card.querySelector<HTMLTextAreaElement>('textarea[aria-label="What did you observe during the retest?"]')!;
    observations.value = 'Observations typed before rotation'; observations.dispatchEvent(new Event('input'));
    card.replaceChildren(); panels.decorateThread({ id: 'c1', authorId: 'rhona', text: 'Thread' }, card);
    await vi.waitFor(() => expect(card.querySelector<HTMLTextAreaElement>('textarea[aria-label="What did you observe during the retest?"]')?.value).toBe('Observations typed before rotation'));
  });
  it('another account never restores the prior tester observations', async () => {
    const first = setup('reviewer', ready, target); await loaded();
    const input = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="What did you observe during the retest?"]')!;
    input.value = 'Chad-only draft'; input.dispatchEvent(new Event('input'));
    first.panels.teardown(); document.body.replaceChildren();
    setup('reviewer', { ...ready, tester_id: 'bob' }, target, 'bob'); await loaded();
    expect(document.querySelector<HTMLTextAreaElement>('textarea[aria-label="What did you observe during the retest?"]')!.value).toBe('');
  });
  it('restores an unsubmitted decision reason after rebuilding a card', async () => {
    const { card, panels } = setup(); await loaded();
    const input = card.querySelector<HTMLTextAreaElement>('textarea[aria-label="Decision reason"]')!;
    input.value = 'Need the source owner to confirm'; input.dispatchEvent(new Event('input'));
    card.replaceChildren(); panels.decorateThread({ id: 'c1', authorId: 'rhona' }, card);
    await vi.waitFor(() => expect(card.querySelector<HTMLTextAreaElement>('textarea[aria-label="Decision reason"]')?.value).toBe('Need the source owner to confirm'));
  });
  it('assigned test target uses an opaque authenticated return rather than a context-free page', async () => {
    setup('reviewer', { ...ready, fix_build: 'new-build' }, { testTarget: { id: 'preview', origin: 'https://preview.school.test', buildId: 'new-build', reachable: true } }); await loaded();
    const link = [...document.querySelectorAll<HTMLAnchorElement>('a')].find(a => a.textContent === 'Open assigned test target')!;
    expect(link.href).toBe('https://preview.school.test/review/return?thread=30000000-0000-4000-8000-000000000001');
    expect(link.href).not.toContain('resourceId');
  });
});


describe('acknowledgement draft boundary', () => {
  it('locks every editable field while a submitted operation is awaiting acknowledgement', async () => {
    const { card, request } = setup(); await loaded();
    let accept!: (response: Response) => void;
    request.mockImplementationOnce(async () => new Promise<Response>(resolve => { accept = resolve; }));
    const form = card.querySelector<HTMLFormElement>('form[aria-label="Finding details"]')!;
    const fields = form.querySelectorAll('textarea'); fields[0].value = 'First version sent'; fields[1].value = 'Actual result'; fields[2].value = 'Impact';
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.waitFor(() => expect(accept).toBeTypeOf('function'));
    expect([...card.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input,textarea,select')].every(input => input.disabled)).toBe(true);
    expect(card.textContent).toContain('Sharing this change');
    accept(new Response(JSON.stringify({ finding: { version: 5 } }), { status: 200 }));
    await vi.waitFor(() => expect([...card.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input,textarea')].every(input => !input.disabled)).toBe(true));
  });
});


describe('copy progress survives responsive redraw', () => {
  it('updates the replacement thread card after a delayed clipboard acknowledgement', async () => {
    let finish!: () => void;
    Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value: { writeText: () => new Promise<void>(resolve => { finish = resolve; }) } });
    const { card, panels } = setup('viewer'); await loaded(); click('Copy link to this thread');
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    card.replaceChildren(); panels.decorateThread({ id: 'c1', authorId: 'rhona' }, card);
    await vi.waitFor(() => expect(card.textContent).toContain('Copying the thread link'));
    finish(); await vi.waitFor(() => expect(card.textContent).toContain('Thread link copied.'));
  });
});
