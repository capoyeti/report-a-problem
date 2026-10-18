import { isSameOrigin } from '../server/same-origin.js';
import type { ReportProblemSession } from '../server/types.js';
import { isReviewIdentifier, parseReviewScope, type ReviewScope } from './contract.js';

export interface ReviewGatewayConfig {
  enabled: boolean;
  serviceUrl: string;
  serviceKey: string;
  appId: string;
  environment: string;
  buildId: string;
  verifySession: () => Promise<ReportProblemSession | { error: unknown }>;
  /** Current product access plus permitted campaign/page/resource, checked server-side. */
  authorizeResource: (session: ReportProblemSession, scope: ReviewScope) => Promise<boolean>;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

const json = (status: number, value: unknown) => new Response(JSON.stringify(value), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store' },
});
const nativePath = /^\/api\/v1\/annotate\/reviews\/([A-Za-z0-9_-]+)\/comments(?:\/[A-Za-z0-9_-]+(?:\/(?:activity|replies(?:\/[A-Za-z0-9_-]+)?))?)?$/;
const sidecarPath = /^\/api\/v1\/reviews\/([A-Za-z0-9_-]+)\/threads\/[A-Za-z0-9_-]+\/(?:finding|promotion|retest)$/;

async function readBody(req: Request): Promise<string> {
  if (Number(req.headers.get('content-length')) > 256 * 1024) throw new RangeError('too_large');
  const reader = req.body?.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  if (reader) for (;;) {
    const { value, done } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > 256 * 1024) { await reader.cancel(); throw new RangeError('too_large'); }
    chunks.push(value);
  }
  const result = new Uint8Array(size); let at = 0;
  for (const chunk of chunks) { result.set(chunk, at); at += chunk.byteLength; }
  return new TextDecoder('utf-8', { fatal: true }).decode(result);
}

/** Server-only forwarder. Never export this entry from a client component. */
export function createReviewGatewayHandlers(cfg: ReviewGatewayConfig) {
  const service = new URL(cfg.serviceUrl);
  if (!/^https?:$/.test(service.protocol) || service.username || service.password || service.search || service.hash) {
    throw new TypeError('Invalid review service URL');
  }
  const base = cfg.serviceUrl.replace(/\/$/, '');
  const f = cfg.fetch ?? fetch;
  async function guard(req: Request): Promise<ReportProblemSession | Response> {
    if (!cfg.enabled) return json(503, { error: 'review_disabled' });
    if (!isSameOrigin(req)) return json(403, { error: 'bad_origin' });
    const browserOrigin = req.headers.get('origin') || req.headers.get('referer');
    if (browserOrigin && !req.headers.get('host')) {
      try { if (new URL(browserOrigin).origin !== new URL(req.url).origin) return json(403, { error: 'bad_origin' }); }
      catch { return json(403, { error: 'bad_origin' }); }
    }
    const session = await cfg.verifySession();
    if ('error' in session && session.error !== undefined) return json(401, { error: 'unauthorized' });
    if (!('user' in session) || !isReviewIdentifier(session.user?.id)) return json(401, { error: 'unauthorized' });
    return session;
  }
  async function call(path: string, init: RequestInit): Promise<Response> {
    return f(base + path, { ...init, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(cfg.timeoutMs ?? 8000) });
  }
  const trustedHeaders = (session: ReportProblemSession, token?: string) => {
    const headers = new Headers({ 'x-triage-key': cfg.serviceKey,
      'x-review-actor-id': session.user.id, 'x-review-build-id': cfg.buildId });
    if (token) headers.set('authorization', token);
    return headers;
  };
  function matchesHost(scope: ReviewScope, session: ReportProblemSession): boolean {
    return scope.appId === cfg.appId && scope.environment === cfg.environment && scope.tenantId === (session.tenantId ?? null);
  }
  function forwardResponse(response: Response): Response {
    const headers = new Headers({ 'cache-control': 'private, no-store', vary: 'Cookie, Authorization' });
    for (const name of ['content-type', 'etag', 'retry-after']) {
      const value = response.headers.get(name); if (value) headers.set(name, value);
    }
    return new Response(response.body, { status: response.status, headers });
  }
  function failure(error: unknown): Response {
    return json(error instanceof RangeError ? 413 : 503, { error: error instanceof RangeError ? 'too_large' : 'review_unavailable' });
  }
  return {
    async session(req: Request): Promise<Response> {
      try {
        if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
        const current = await guard(req); if (current instanceof Response) return current;
        if (!req.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return json(415, { error: 'json_required' });
        let input: Record<string, unknown>;
        try { input = JSON.parse(await readBody(req)); } catch (error) {
          if (error instanceof RangeError) throw error;
          return json(400, { error: 'invalid_input' });
        }
        if (!input || typeof input !== 'object' || Array.isArray(input)
          || Object.keys(input).some(k => !['campaignId', 'pagePath', 'resourceId'].includes(k))) return json(400, { error: 'invalid_input' });
        const scope = parseReviewScope({ appId: cfg.appId, tenantId: current.tenantId ?? null,
          environment: cfg.environment, campaignId: input.campaignId, pagePath: input.pagePath, resourceId: input.resourceId });
        if (!scope) return json(400, { error: 'invalid_input' });
        if (!await cfg.authorizeResource(current, scope)) return json(403, { error: 'resource_forbidden' });
        const headers = trustedHeaders(current); headers.set('content-type', 'application/json');
        const response = await call('/api/v1/reviews/session', { method: 'POST', headers,
          body: JSON.stringify({ actorId: current.user.id, actorName: current.user.name || 'School reviewer',
            tenantId: scope.tenantId, environment: scope.environment, campaignId: scope.campaignId,
            pagePath: scope.pagePath, resourceId: scope.resourceId, buildId: cfg.buildId }) });
        return forwardResponse(response);
      } catch (error) { return failure(error); }
    },
    async forward(req: Request, servicePath: string): Promise<Response> {
      try {
        const current = await guard(req); if (current instanceof Response) return current;
        if (!['GET', 'PUT', 'POST', 'DELETE'].includes(req.method)) return json(405, { error: 'method_not_allowed' });
        const parsed = new URL(servicePath, 'https://review.invalid');
        const rawPath = servicePath.split('?')[0];
        const match = nativePath.exec(parsed.pathname) ?? sidecarPath.exec(parsed.pathname);
        if (!match || !rawPath.startsWith('/') || rawPath.startsWith('//')
          || rawPath.split('/').some(part => part === '.' || part === '..')
          || parsed.origin !== 'https://review.invalid' || parsed.hash || /[%\\]/.test(rawPath)
          || [...parsed.searchParams.keys()].some(k => !['page', 'cursor', 'limit', 'include'].includes(k))) {
          return json(400, { error: 'invalid_path' });
        }
        const bearer = req.headers.get('authorization');
        if (!bearer || !/^Bearer [A-Za-z0-9_-]{16,4096}$/.test(bearer)) return json(401, { error: 'unauthorized' });
        const headers = trustedHeaders(current, bearer);
        // Introspect the actual grant. A browser-declared resource cannot stand
        // in for the protected record bound to an opaque bearer token.
        const introspection = await call('/api/v1/reviews/session', { method: 'GET', headers });
        if (!introspection.ok) return forwardResponse(introspection);
        let identity: { scope?: unknown; actor?: { id?: unknown }; buildId?: unknown };
        try { identity = await introspection.json(); } catch { return json(503, { error: 'review_unavailable' }); }
        const scope = parseReviewScope(identity?.scope);
        if (!scope || !matchesHost(scope, current) || scope.campaignId !== match[1]
          || identity.actor?.id !== current.user.id || identity.buildId !== cfg.buildId
          || (parsed.searchParams.has('page') && parsed.searchParams.get('page') !== scope.pagePath)) {
          return json(403, { error: 'resource_forbidden' });
        }
        if (!await cfg.authorizeResource(current, scope)) return json(403, { error: 'resource_forbidden' });
        let raw: string | undefined;
        if (req.method !== 'GET' && req.method !== 'DELETE') {
          if (!req.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return json(415, { error: 'json_required' });
          raw = await readBody(req); headers.set('content-type', 'application/json');
        }
        for (const name of ['idempotency-key', 'if-none-match']) {
          const value = req.headers.get(name); if (value) headers.set(name, value);
        }
        return forwardResponse(await call(parsed.pathname + parsed.search, { method: req.method, headers, body: raw }));
      } catch (error) { return failure(error); }
    },
  };
}
