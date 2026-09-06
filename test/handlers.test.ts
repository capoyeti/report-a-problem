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
