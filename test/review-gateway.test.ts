import { describe, expect, it, vi } from 'vitest';
import { createReviewGatewayHandlers, type ReviewGatewayConfig } from '../src/review/server.js';
import type { ReviewScope } from '../src/review/contract.js';

const scope: ReviewScope = { appId: 'app-a', tenantId: null, environment: 'test', campaignId: 'october', pagePath: '/documents', resourceId: 'record-a' };
const origin = 'https://school.test';
const wire = '/api/v1/annotate/reviews/october/comments?page=%2Fdocuments';
const bearer = 'Bearer fixture_opaque_grant_value';
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
function setup(extra: Partial<ReviewGatewayConfig> = {}, introspection: unknown = { scope, actor: { id: 'rhona' }, buildId: 'build-a' }) {
  const f = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => init?.method === 'GET' && String(_url).endsWith('/session')
    ? response(introspection) : response({ comments: [] }));
  const authorizeResource = vi.fn(async () => true);
  const config: ReviewGatewayConfig = { enabled: true, serviceUrl: 'https://triage.test', serviceKey: 'fixture_server_key', appId: 'app-a', environment: 'test', buildId: 'build-a',
    verifySession: async () => ({ user: { id: 'rhona', name: 'Rhona' }, tenantId: null }), authorizeResource, fetch: f, ...extra };
  return { handlers: createReviewGatewayHandlers(config), f, authorizeResource };
}
function req(method = 'GET', body?: unknown, extra: Record<string, string> = {}) {
  return new Request(origin + '/api/review', { method, headers: { origin, authorization: bearer, 'content-type': 'application/json', ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
}

describe('host review gateway', () => {
  it('binds bootstrap identity and app context on the server', async () => {
    const { handlers, f, authorizeResource } = setup();
    const r = await handlers.session(req('POST', { campaignId: 'october', pagePath: '/documents', resourceId: 'record-a' }));
    expect(r.status).toBe(200);
    expect(authorizeResource).toHaveBeenCalledWith(expect.objectContaining({ user: { id: 'rhona', name: 'Rhona' } }), scope);
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('https://triage.test/api/v1/reviews/session');
    expect(JSON.parse(init!.body as string)).toEqual({ actorId: 'rhona', actorName: 'Rhona', tenantId: null, environment: 'test', campaignId: 'october', pagePath: '/documents', resourceId: 'record-a', buildId: 'build-a' });
    expect(new Headers(init!.headers).get('x-triage-key')).toBe('fixture_server_key');
    expect(r.headers.get('x-triage-key')).toBeNull();
  });
  it('rejects browser-supplied roles, actor and tenant during bootstrap', async () => {
    const { handlers, f } = setup();
    expect((await handlers.session(req('POST', { campaignId: 'october', pagePath: '/documents', resourceId: 'record-a', actorId: 'chad', role: 'lead' }))).status).toBe(400);
    expect(f).not.toHaveBeenCalled();
  });
  it('introspects the grant and checks its actual protected resource before forwarding', async () => {
    const { handlers, f, authorizeResource } = setup();
    const r = await handlers.forward(req('GET', undefined, { 'x-review-actor-id': 'chad', 'x-review-resource-id': 'record-b' }), wire);
    expect(r.status).toBe(200); expect(f).toHaveBeenCalledTimes(2);
    expect(authorizeResource).toHaveBeenCalledWith(expect.anything(), scope);
    for (const [, init] of f.mock.calls) {
      const h = new Headers(init!.headers);
      expect(h.get('x-review-actor-id')).toBe('rhona'); expect(h.get('x-review-build-id')).toBe('build-a');
      expect(h.get('x-review-resource-id')).toBeNull(); expect(h.get('authorization')).toBe(bearer);
    }
    expect(r.headers.get('cache-control')).toBe('private, no-store');
  });
  it('denies revoked product access even when the grant introspection succeeds', async () => {
    const { handlers, f } = setup({ authorizeResource: async (_session, actualScope) => actualScope.resourceId !== 'record-a' });
    expect((await handlers.forward(req(), wire)).status).toBe(403);
    expect(f).toHaveBeenCalledTimes(1);
  });
  it.each([
    { scope: { ...scope, appId: 'app-b' }, actor: { id: 'rhona' }, buildId: 'build-a' },
    { scope: { ...scope, tenantId: 'tenant-b' }, actor: { id: 'rhona' }, buildId: 'build-a' },
    { scope: { ...scope, environment: 'production' }, actor: { id: 'rhona' }, buildId: 'build-a' },
    { scope: { ...scope, campaignId: 'other' }, actor: { id: 'rhona' }, buildId: 'build-a' },
    { scope, actor: { id: 'chad' }, buildId: 'build-a' },
    { scope, actor: { id: 'rhona' }, buildId: 'old-build' },
  ])('rejects substituted grant context %#', async identity => {
    const { handlers, f } = setup({}, identity);
    expect((await handlers.forward(req(), wire)).status).toBe(403); expect(f).toHaveBeenCalledTimes(1);
  });
  it('rejects a page query different from the stored scope', async () => {
    const { handlers, f } = setup();
    expect((await handlers.forward(req(), wire.replace('%2Fdocuments', '%2Finbox'))).status).toBe(403);
    expect(f).toHaveBeenCalledTimes(1);
  });
  it('passes an unchanged mutation body and operation key with trusted headers', async () => {
    const { handlers, f } = setup();
    const input = { text: 'Updated wording' };
    expect((await handlers.forward(req('PUT', input, { 'idempotency-key': 'operation-1', 'x-triage-key': 'spoofed' }), '/api/v1/annotate/reviews/october/comments/c1')).status).toBe(200);
    const init = f.mock.calls[1][1]!;
    expect(init.body).toBe(JSON.stringify(input));
    expect(new Headers(init.headers).get('idempotency-key')).toBe('operation-1');
    expect(new Headers(init.headers).get('x-triage-key')).toBe('fixture_server_key');
    expect(init.redirect).toBe('error');
  });
  it.each([false, 'unauthorised', 'foreign-origin'])('does not call service for failed host guard %s', async variant => {
    const { handlers, f } = setup(variant === false ? { enabled: false } : variant === 'unauthorised' ? { verifySession: async () => ({ error: 'no_session' }) } : {});
    const r = await handlers.forward(req('GET', undefined, variant === 'foreign-origin' ? { origin: 'https://outside.test' } : {}), wire);
    expect([401, 403, 503]).toContain(r.status); expect(f).not.toHaveBeenCalled();
  });
  it.each(['https://outside.test/api/v1/annotate/reviews/october/comments', '/api/v1/admin/bootstrap', '/api/v1/annotate/reviews/october/comments/../comments',
    '/api/v1/annotate/reviews/october/comments?page=%2Fdocuments&actorId=chad', '/api/v1/annotate/reviews/october/comments%2Fc1'])('rejects invalid service path before network %s', async path => {
    const { handlers, f } = setup(); expect((await handlers.forward(req(), path)).status).toBe(400); expect(f).not.toHaveBeenCalled();
  });
  it('bounds chunked input using actual UTF-8 bytes', async () => {
    const { handlers, f } = setup();
    const r = await handlers.session(req('POST', { campaignId: 'october', pagePath: '/documents', resourceId: '😀'.repeat(70_000) }));
    expect(r.status).toBe(413); expect(f).not.toHaveBeenCalled();
  });
});
