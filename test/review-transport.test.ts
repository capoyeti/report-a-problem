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
  it('keeps a cached snapshot when Chromium exposes an empty stream on a 304 response', async () => {
    const snapshot = { comments: [{ id: 'shared-mark' }], complete: true, nextCursor: null };
    const first = json(snapshot);
    first.headers.set('etag', '"snapshot-1"');
    const unchanged = new Response(null, { status: 304, headers: { etag: '"snapshot-1"' } });
    // Actual Chromium production fetch exposed body !== null and zero bytes.
    // Response's constructor still forbids a non-null body for status 304.
    Object.defineProperty(unchanged, 'body', { value: new ReadableStream({ start(c) { c.close(); } }) });
    const f = vi.fn<typeof fetch>().mockResolvedValueOnce(json(session()))
      .mockResolvedValueOnce(first).mockResolvedValueOnce(unchanged);
    const t = createReviewTransport(config(f));
    expect(await (await t.request(target)).json()).toMatchObject(snapshot);
    expect(await (await t.request(target)).json()).toMatchObject(snapshot);
    expect(new Headers(f.mock.calls[2][1]!.headers).get('if-none-match')).toBe('"snapshot-1"');
    t.stop();
  });
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

describe('complete shared snapshots', () => {
  it('drains paginated comments atomically with one verified session', async () => {
    const f = vi.fn<typeof fetch>().mockResolvedValueOnce(json(session()))
      .mockResolvedValueOnce(json({ comments: [{ id: 'one' }], complete: false, nextCursor: 'cursor-a' }))
      .mockResolvedValueOnce(json({ comments: [{ id: 'two' }], complete: true, nextCursor: null }));
    const t = createReviewTransport(config(f));
    const result = await t.request(target + '?page=%2Fdocuments', { headers: { 'if-none-match': 'old-page-etag' } });
    expect(await result.json()).toEqual({ comments: [{ id: 'one' }, { id: 'two' }], complete: true, nextCursor: null });
    expect(String(f.mock.calls[2][0])).toContain('cursor=cursor-a');
    expect(new Headers(f.mock.calls[1][1]!.headers).has('if-none-match')).toBe(false);
    t.stop();
  });
  it('does not expose a successful partial list when a later page fails', async () => {
    const f = vi.fn<typeof fetch>().mockResolvedValueOnce(json(session()))
      .mockResolvedValueOnce(json({ comments: [{ id: 'one' }], complete: false, nextCursor: 'cursor-a' }))
      .mockResolvedValueOnce(json({ error: 'unavailable' }, 503));
    const t = createReviewTransport(config(f));
    const result = await t.request(target); expect(result.status).toBe(503);
    expect(await result.json()).toEqual({ error: 'unavailable' }); t.stop();
  });
  it('rejects cyclic cursors rather than replacing the shared list', async () => {
    const f = vi.fn<typeof fetch>().mockResolvedValueOnce(json(session()))
      .mockImplementation(async () => json({ comments: [], complete: false, nextCursor: 'same' }));
    const t = createReviewTransport(config(f)); await expect(t.request(target)).rejects.toThrow('cursor'); t.stop();
  });
  it('allows sidecar commands only inside the current campaign', async () => {
    const f = vi.fn<typeof fetch>().mockResolvedValueOnce(json(session())).mockResolvedValue(json({}));
    const t = createReviewTransport(config(f));
    expect((await t.request(origin + '/api/review/v1/reviews/october/threads/c1/finding', { method: 'POST', body: '{}' })).status).toBe(200);
    await expect(t.request(origin + '/api/review/v1/reviews/other/threads/c1/finding')).rejects.toThrow('outside'); t.stop();
  });
  it('snapshots configuration instead of letting a mutable scope change a grant', async () => {
    const cfg = config(vi.fn<typeof fetch>().mockResolvedValue(json(session()))); cfg.scope = { ...scope };
    const t = createReviewTransport(cfg); cfg.scope.pagePath = '/private';
    expect((await t.getSession()).scope.pagePath).toBe('/documents'); t.stop();
  });
});

describe('complete retest history', () => {
  it('drains attempts without presenting a partial history', async () => {
    const f = vi.fn<typeof fetch>().mockResolvedValueOnce(json(session()))
      .mockResolvedValueOnce(json({ finding: { version: 2 }, retests: [{ result: 'fail' }], retestsComplete: false, nextRetestCursor: 'cursor-r' }))
      .mockResolvedValueOnce(json({ finding: { version: 2 }, retests: [{ result: 'pass' }], retestsComplete: true, nextRetestCursor: null }));
    const t = createReviewTransport(config(f));
    const data = await (await t.request(origin + '/api/review/v1/reviews/october/threads/c1/finding')).json();
    expect(data.retests).toEqual([{ result: 'fail' }, { result: 'pass' }]);
    expect(String(f.mock.calls[2][0])).toContain('retestCursor=cursor-r'); t.stop();
  });
  it('rejects changed finding versions between history pages', async () => {
    const f = vi.fn<typeof fetch>().mockResolvedValueOnce(json(session()))
      .mockResolvedValueOnce(json({ finding: { version: 2 }, retests: [], retestsComplete: false, nextRetestCursor: 'cursor-r' }))
      .mockResolvedValueOnce(json({ finding: { version: 3 }, retests: [], retestsComplete: true }));
    const t = createReviewTransport(config(f));
    await expect(t.request(origin + '/api/review/v1/reviews/october/threads/c1/finding')).rejects.toThrow('changed'); t.stop();
  });
});


describe('deployment changes after bootstrap', () => {
  it('stops requests and asks for reload rather than treating stale UI as a comment conflict', async () => {
    const f = vi.fn<typeof fetch>().mockResolvedValueOnce(json(session())).mockResolvedValue(json({ error: 'build_mismatch' }, 409));
    const onBuildChanged = vi.fn(), onAccessLost = vi.fn();
    const t = createReviewTransport(config(f, { onBuildChanged, onAccessLost }));
    await expect(t.request(target)).rejects.toThrow('Reload');
    expect(onBuildChanged).toHaveBeenCalledOnce(); expect(onAccessLost).not.toHaveBeenCalled();
    await expect(t.request(target)).rejects.toThrow('stopped');
  });
});


describe('conditional paginated reads', () => {
  it('validates every cached page and combines unchanged plus changed pages', async () => {
    const page = (data: unknown, etag: string) => new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json', etag } });
    const f = vi.fn<typeof fetch>().mockResolvedValueOnce(json(session()))
      .mockResolvedValueOnce(page({ comments: [{ id: 'one' }], complete: false, nextCursor: 'next' }, 'page-one'))
      .mockResolvedValueOnce(page({ comments: [{ id: 'two', text: 'old' }], complete: true }, 'page-two'))
      .mockResolvedValueOnce(new Response(null, { status: 304, headers: { etag: 'page-one' } }))
      .mockResolvedValueOnce(page({ comments: [{ id: 'two', text: 'new' }], complete: true }, 'page-two-new'));
    const t = createReviewTransport(config(f)); await t.request(target);
    const next = await (await t.request(target)).json();
    expect(next.comments).toEqual([{ id: 'one' }, { id: 'two', text: 'new' }]);
    expect(new Headers(f.mock.calls[3][1]!.headers).get('if-none-match')).toBe('page-one');
    expect(new Headers(f.mock.calls[4][1]!.headers).get('if-none-match')).toBe('page-two'); t.stop();
  });
});

describe('response bodies share the request deadline', () => {
  it('cancels a stalled bootstrap body on teardown after headers arrived', async () => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream<Uint8Array>({ cancel }));
    const f = vi.fn<typeof fetch>().mockResolvedValue(response);
    const t = createReviewTransport(config(f));
    const result = t.getSession().then(() => 'unexpected success', e => e.message);
    await new Promise(r => setTimeout(r, 0)); t.stop();
    expect(await result).toContain('stopped'); expect(cancel).toHaveBeenCalledOnce();
    expect((f.mock.calls[0][1]!.signal as AbortSignal).aborted).toBe(true);
  });
  it('times out a stalled body even though response headers succeeded', async () => {
    vi.useFakeTimers();
    try {
      const cancel = vi.fn(); const response = new Response(new ReadableStream<Uint8Array>({ cancel }));
      const t = createReviewTransport(config(vi.fn<typeof fetch>().mockResolvedValue(response)));
      const result = t.getSession().then(() => 'unexpected success', e => e.message);
      await vi.advanceTimersByTimeAsync(10_001);
      expect(await result).toContain('timed out'); expect(cancel).toHaveBeenCalledOnce(); t.stop();
    } finally { vi.useRealTimers(); }
  });
});

describe('server-aligned grant clock', () => {
  it.each([-60 * 60_000, 60 * 60_000])('uses server time for validity and renewal with device skew %s', async skew => {
    let deviceNow = 1000 + skew;
    const reply = (value: ReviewSession, serverNow: number) => new Response(JSON.stringify(value), {
      headers: { 'content-type': 'application/json', date: new Date(serverNow).toUTCString() },
    });
    const f = vi.fn<typeof fetch>().mockResolvedValueOnce(reply(session(), 1000))
      .mockResolvedValueOnce(reply({ ...session('renewed'), expiresAt: new Date(1_171_000).toISOString() }, 571_000));
    const t = createReviewTransport(config(f, { now: () => deviceNow }));
    expect((await t.getSession()).token).toBe('fixture-token-1');
    deviceNow += 569_999;
    expect((await t.getSession()).token).toBe('fixture-token-1');
    expect(f).toHaveBeenCalledTimes(1);
    deviceNow += 2;
    expect((await t.getSession()).token).toBe('renewed');
    expect(f).toHaveBeenCalledTimes(2);
    t.stop();
  });
  it.each([1000, 1000 + 60 * 60_000])('still refuses a server-expired or unbounded grant %s', async expires => {
    const f = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ ...session(), expiresAt: new Date(expires).toISOString() }), {
      headers: { 'content-type': 'application/json', date: new Date(1000).toUTCString() },
    }));
    const t = createReviewTransport(config(f, { now: () => -3_600_000 }));
    await expect(t.getSession()).rejects.toMatchObject({ kind: 'access_lost' });
  });
  it('falls back to local validation when a test or legacy gateway has no valid Date', async () => {
    const f = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(session()), { headers: { date: 'invalid' } }));
    const t = createReviewTransport(config(f));
    expect((await t.getSession()).token).toBe('fixture-token-1'); t.stop();
  });
});
