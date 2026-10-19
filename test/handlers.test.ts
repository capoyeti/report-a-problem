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
  it('drops malformed submission_id while retaining valid attachments', async () => {
    const { h, calls } = mk();
    await h.report(post('/api/error-report', { userMessage: 'x', submission_id: 'not-a-uuid', attachment_ids: ['3f2a1b40-1111-4222-8333-444455556667'] }));
    expect(JSON.parse(calls[0].init.body as string).submission_id).toBeUndefined();
  });
  it.each([
    { name: 'mixed UUID and invalid ID', ids: ['3f2a1b40-1111-4222-8333-444455556667', 'junk'] },
    { name: 'null entry array', ids: [null] },
    { name: 'non-array', ids: 'junk' },
    { name: 'eleven UUIDs', ids: Array(11).fill('3f2a1b40-1111-4222-8333-444455556667') },
  ])('rejects $name without a reduced service payload', async ({ name, ids }) => {
    const { h, calls } = mk();
    const req = post('/api/error-report', { attachment_ids: ids });
    const input = await req.clone().json();
    expect(input.attachment_ids).toEqual(ids);
    if (name === 'mixed UUID and invalid ID') expect(input.attachment_ids).toHaveLength(2);
    if (name === 'eleven UUIDs') expect(input.attachment_ids).toHaveLength(11);
    const res = await h.report(req);
    expect(res.status).toBe(400); expect(await res.json()).toEqual({ ok: false, error: 'invalid_attachment_ids' }); expect(calls).toHaveLength(0);
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
    const { h, calls } = mk({}, () => new Response(JSON.stringify({ ok: true, attachment_id: '11111111-1111-4111-8111-111111111111', upload_url: 'https://sb/up' }), { status: 200 }));
    const res = await h.attachment(post('/api/error-report/attachment', { filename: 'shot.png', mime: 'image/png', size_bytes: 10 }));
    expect(await res.json()).toMatchObject({ ok: true, attachment_id: '11111111-1111-4111-8111-111111111111', upload_url: 'https://sb/up' });
    expect(calls[0].url).toBe('https://svc.test/api/v1/attachments/sign');
    expect(JSON.parse(calls[0].init.body as string)).toMatchObject({ reporter: { id: 'u1' }, tenant_id: 't1', filename: 'shot.png', mime: 'image/png', size_bytes: 10 });
  });
  it('415 status from the service is passed through', async () => {
    const { h } = mk({}, () => new Response('{"ok":false,"error":"unsupported_type"}', { status: 415 }));
    expect((await h.attachment(post('/api/error-report/attachment', { filename: 'x.exe', mime: 'application/x-msdownload', size_bytes: 1 }))).status).toBe(415);
  });
});

describe('reliability authority and filing proof', () => {
  it.each([['legacy', undefined, 401, 'unauthorized'], ['disabled', 403, 403, 'reporting_disabled'], ['unavailable', 503, 503, 'service_unavailable'], ['invalid', 500, 401, 'unauthorized']] as const)('G1 %s failure has only controlled fields on both routes', async (_, status, expected, error) => {
    const { h, calls } = mk({ verifySession: async () => ({ error: { secret: 'private' }, status } as any) });
    for (const route of [h.report, h.attachment]) {
      const res = await route(post('/api/test', {}));
      expect(res.status).toBe(expected);
      expect(await res.json()).toEqual({ ok: false, error });
    }
    expect(calls).toHaveLength(0);
  });
  it('G2 origin precedes session, thrown session is safe, invalid identity/body never forwards', async () => {
    const verifySession = vi.fn(async () => { throw new Error('secret'); });
    const { h, calls } = mk({ verifySession });
    for (const route of [h.report, h.attachment]) {
      expect((await route(post('/api/test', {}, { origin: 'https://evil.test' }))).status).toBe(403);
      expect(verifySession).not.toHaveBeenCalled();
    }
    for (const route of [h.report, h.attachment]) {
      const res = await route(post('/api/test', {}));
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ ok: false, error: 'service_unavailable' });
    }
    expect(calls).toHaveLength(0);
    const bad = mk({ verifySession: async () => ({ user: { id: 4 } } as any) });
    expect((await bad.h.report(post('/api/test', {}))).status).toBe(401);
    for (const route of [mk().h.report, mk().h.attachment]) {
      expect((await route(new Request('https://app.test/api/test', { method: 'POST', headers: { origin: 'https://app.test' }, body: '{' }))).status).toBe(400);
    }
  });
  it.each([{ ok: true, filed: true, ref: 'REP-1' }, { ok: true, filed: true, report_id: 'r1', duplicate: true }])('G3 explicit durable proof succeeds: %j', async (body) => {
    const { h, calls } = mk({}, () => Response.json(body));
    const res = await h.report(post('/api/test', {}));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, filed: true, duplicate: body.duplicate === true });
    expect(calls).toHaveLength(1);
  });
  it.each(['app_disabled', 'tenant_disabled', 'tenant_not_allowed', 'tenant_denied', 'noop', 'secret'])('G4 no-op reason %s never succeeds', async (reason) => {
    const { h } = mk({}, () => Response.json({ ok: true, filed: false, reason, ref: 'REP-1' }));
    const res = await h.report(post('/api/test', {}));
    expect(res.status).toBe(['noop', 'secret'].includes(reason) ? 502 : 403);
    expect(await res.json()).toEqual({ ok: false, error: res.status === 403 ? 'reporting_disabled' : 'service_error' });
  });
  it.each([null, {}, { ok: true, ref: 'REP-1' }, { ok: true, filed: true }, { ok: true, filed: true, ref: '' }, { ok: true, filed: true, ref: 5 }, { ok: 1, filed: true, ref: 'REP-1' }, { ok: true, filed: 'true', ref: 'REP-1' }, { ok: false, filed: true, ref: 'REP-1' }, { ok: true, filed: true, ref: 'REP-1', report_id: {} }])('G5 malformed proof %j is 502', async (body) => {
    const { h } = mk({}, () => Response.json(body));
    expect((await h.report(post('/api/test', {}))).status).toBe(502);
  });
  it('G5 invalid JSON and G6 transport/5xx stay non-success', async () => {
    for (const svc of [() => new Response('{'), () => new Response('{}', { status: 500 }), () => { throw new Error('secret'); }]) {
      const { h } = mk({}, svc);
      const res = await h.report(post('/api/test', {}));
      expect(res.status).toBe(502);
      expect(await res.text()).not.toContain('secret');
    }
  });
  it('G7 sanitises delivered values instead of forwarding arbitrary strings', async () => {
    const { h } = mk({}, () => Response.json({ ok: true, filed: true, ref: 'REP-1', delivered: { reporter_copy: 'true', secret: 'hidden' } }));
    const body = await (await h.report(post('/api/test', {}))).json();
    expect(body.delivered.reporter_copy).toBe(false);
    expect(body.delivered.secret).toBeUndefined();
  });
  it.each([[401, 'unauthorized'], [403, 'reporting_disabled'], [413, 'file_too_large'], [415, 'unsupported_type'], [429, 'rate_limited'], [503, 'service_unavailable'], [500, 'service_error']])('G12 signing %s preserves controlled status and strips private body', async (status, error) => {
    const { h } = mk({}, () => Response.json({ error: 'private-key-url' }, { status: status as number }));
    const res = await h.attachment(post('/api/test', { filename: 'x', mime: 'image/png', size_bytes: 1 }));
    expect(res.status).toBe(status === 500 ? 502 : status);
    expect(await res.json()).toEqual({ ok: false, error });
  });
  it('G12 malformed signing success is rejected and only required success fields escape', async () => {
    for (const body of [null, { ok: true }, { ok: true, attachment_id: {}, upload_url: 'https://storage.test' }, { ok: true, attachment_id: 'malformed', upload_url: 'https://storage.test' }]) {
      const { h } = mk({}, () => Response.json(body));
      expect((await h.attachment(post('/api/test', { mime: 'image/png', size_bytes: 1 }))).status).toBe(502);
    }
    const { h } = mk({}, () => Response.json({ ok: true, attachment_id: '11111111-1111-4111-8111-111111111111', upload_url: 'https://storage.test', secret: 'hidden' }));
    expect(await (await h.attachment(post('/api/test', { mime: 'image/png', size_bytes: 1 }))).json()).toEqual({ ok: true, attachment_id: '11111111-1111-4111-8111-111111111111', upload_url: 'https://storage.test' });
  });
});
