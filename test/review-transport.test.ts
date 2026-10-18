import { describe, expect, it, vi } from 'vitest';
import { createReviewTransport, type ReviewTransportConfig } from '../src/review/transport.js';
import type { ReviewSession } from '../src/review/types.js';

const scope = { appId: 'app-a', tenantId: null, environment: 'test', campaignId: 'october', pagePath: '/documents', resourceId: null };
const origin = 'http://127.0.0.1';
const target = `${origin}/api/review/v1/annotate/reviews/october/comments`;
function session(token = 'fixture-token-1'): ReviewSession {
  return { token, expiresAt: new Date(601_000).toISOString(), actor: { id: 'rhona', name: 'Rhona', role: 'reviewer' }, scope: { ...scope }, buildId: 'build-a' };
}
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
function config(f: typeof fetch, extra: Partial<ReviewTransportConfig> = {}): ReviewTransportConfig {
  return { origin, gatewayPath: '/api/review', bootstrapPath: '/api/review/session', actorId: 'rhona', scope, buildId: 'build-a', fetch: f, now: () => 1000, ...extra };
}

describe('explicit authenticated review transport', () => {
  it('bootstraps once with no browser identity claims and current-origin cookies', async () => {
    const f = vi.fn<typeof fetch>().mockResolvedValue(json(session()));
    const t = createReviewTransport(config(f));
    await Promise.all([t.getSession(), t.getSession(), t.getSession()]);
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0];
    expect(url).toBe(`${origin}/api/review/session`);
    expect(init).toMatchObject({ method: 'POST', credentials: 'same-origin', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer' });
    expect(JSON.parse(init!.body as string)).toEqual({ campaignId: 'october', pagePath: '/documents', resourceId: null });
    t.stop();
  });
  it('sends the verified bearer and only whitelisted request headers', async () => {
    const f = vi.fn<typeof fetch>().mockResolvedValueOnce(json(session())).mockResolvedValue(json({ comments: [] }));
    const t = createReviewTransport(config(f));
    await t.request(target, { headers: { authorization: 'Bearer spoofed', 'x-triage-key': 'must-not-forward', 'x-review-actor-id': 'chad', 'Idempotency-Key': 'operation-1' } });
    const init = f.mock.calls[1][1]!;
    const headers = new Headers(init.headers);
    expect(headers.get('authorization')).toBe('Bearer fixture-token-1');
    expect(headers.get('x-triage-key')).toBeNull();
    expect(headers.get('x-review-actor-id')).toBeNull();
    expect(headers.get('idempotency-key')).toBe('operation-1');
    expect(init.credentials).toBe('same-origin');
    t.stop();
  });
  it('renews once after 401 and preserves the body and operation identity', async () => {
    const f = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json(session()))
      .mockResolvedValueOnce(json({}, 401))
      .mockResolvedValueOnce(json(session('fixture-token-2')))
      .mockResolvedValueOnce(json({ comment: { id: 'c1' } }));
    const t = createReviewTransport(config(f));
    const init = { method: 'PUT', body: '{"id":"c1"}', headers: { 'idempotency-key': 'stable-operation' } };
    expect((await t.request(target + '/c1', init)).status).toBe(200);
    expect(f).toHaveBeenCalledTimes(4);
    const first = f.mock.calls[1][1]!, second = f.mock.calls[3][1]!;
    expect(first.body).toBe(second.body);
    expect(new Headers(first.headers).get('idempotency-key')).toBe(new Headers(second.headers).get('idempotency-key'));
    expect(new Headers(second.headers).get('authorization')).toBe('Bearer fixture-token-2');
    t.stop();
  });
  it('coalesces concurrent forced renewal requests', async () => {
    const f = vi.fn<typeof fetch>().mockImplementation(async () => json(session()));
    const t = createReviewTransport(config(f));
    await t.getSession();
    await Promise.all([t.getSession(true), t.getSession(true)]);
    expect(f).toHaveBeenCalledTimes(2); t.stop();
  });
  it('stops after a second 401 without a renewal loop', async () => {
    const lost = vi.fn();
    const f = vi.fn<typeof fetch>().mockImplementation(async url => String(url).endsWith('/session') ? json(session()) : json({}, 401));
    const t = createReviewTransport(config(f, { onAccessLost: lost }));
    await expect(t.request(target)).rejects.toMatchObject({ kind: 'access_lost' });
    expect(f).toHaveBeenCalledTimes(4); expect(lost).toHaveBeenCalledOnce();
    await expect(t.getSession()).rejects.toMatchObject({ kind: 'stopped' });
  });
  it.each([401, 403, 410])('never falls back to open/name-based review after bootstrap %s', async status => {
    const lost = vi.fn(); const f = vi.fn<typeof fetch>().mockResolvedValue(json({}, status));
    const t = createReviewTransport(config(f, { onAccessLost: lost }));
    await expect(t.getSession()).rejects.toMatchObject({ kind: 'access_lost' });
    expect(f).toHaveBeenCalledOnce(); expect(lost).toHaveBeenCalledOnce();
  });
  it.each([
    { ...session(), actor: { ...session().actor, id: 'chad' } },
    { ...session(), actor: { ...session().actor, role: 'admin' } },
    { ...session(), scope: { ...scope, resourceId: 'private-other' } },
    { ...session(), buildId: 'wrong-build' },
    { ...session(), token: 'bad token' },
    { ...session(), expiresAt: new Date(1000).toISOString() },
    { ...session(), expiresAt: new Date(1000 + 60 * 60_000).toISOString() },
    { ...session(), actor: { ...session().actor, name: '' } },
  ])('rejects malformed or substituted verified session %#', async value => {
    const f = vi.fn<typeof fetch>().mockResolvedValue(json(value));
    const t = createReviewTransport(config(f));
    await expect(t.getSession()).rejects.toMatchObject({ kind: 'access_lost' });
  });
  it.each(['https://outside.test/api', '//outside.test/api', '/api?token=hidden', '/api#part', '/api%2freview', '/api\\review'])(
    'rejects unsafe gateway %s before network', gatewayPath => {
      const f = vi.fn<typeof fetch>();
      expect(() => createReviewTransport(config(f, { gatewayPath }))).toThrow(TypeError);
      expect(f).not.toHaveBeenCalled();
    },
  );
  it.each(['https://outside.test/api/review/v1/annotate/reviews/october/comments',
    `${origin}/api/review/v1/annotate/reviews/other/comments`, `${origin}/api/reviewish/v1/annotate/reviews/october/comments`])(
    'rejects requests outside this campaign gateway', async url => {
      const f = vi.fn<typeof fetch>(); const t = createReviewTransport(config(f));
      await expect(t.request(url)).rejects.toThrow(TypeError); expect(f).not.toHaveBeenCalled(); t.stop();
    },
  );
  it('aborts pending fetch on logout/route teardown', async () => {
    let signal: AbortSignal | null = null;
    const f = vi.fn<typeof fetch>().mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      signal = init!.signal!;
      signal.addEventListener('abort', () => reject(new DOMException('Stopped', 'AbortError')));
    }));
    const t = createReviewTransport(config(f));
    const pending = t.getSession(); t.stop();
    await expect(pending).rejects.toThrow();
    expect((signal as unknown as AbortSignal).aborted).toBe(true);
  });
});
