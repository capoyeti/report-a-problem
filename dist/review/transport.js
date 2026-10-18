import { getReviewScopeKey, isReviewIdentifier, parseReviewScope, REVIEW_ROLES } from './contract.js';
export class ReviewAccessError extends Error {
    constructor(kind) {
        super(kind === 'access_lost' ? 'Sign in again or ask the review lead to check your access.'
            : kind === 'stopped' ? 'Review stopped.' : 'Could not open the review. Your draft stays on this device.');
        this.kind = kind;
        this.name = 'ReviewAccessError';
    }
}
function sameOriginPath(value, origin) {
    const u = new URL(value, origin);
    if (u.origin !== origin || u.username || u.password || u.search || u.hash
        || !/^https?:$/.test(u.protocol) || !value.startsWith('/') || value.startsWith('//')
        || /[\\%\u0000-\u001f]/.test(value))
        throw new TypeError('Review gateway must be a same-origin path');
    return u;
}
function validateSession(value, cfg, now) {
    if (!value || typeof value !== 'object')
        throw new ReviewAccessError('invalid_session');
    const s = value;
    const scope = parseReviewScope(s.scope);
    if (!scope || !s.actor || !isReviewIdentifier(s.actor.id) || s.actor.id !== cfg.actorId
        || typeof s.actor.name !== 'string' || !s.actor.name.trim() || s.actor.name.length > 80
        || /[\u0000-\u001f\u007f-\u009f]/.test(s.actor.name)
        || !REVIEW_ROLES.includes(s.actor.role) || getReviewScopeKey(scope) !== getReviewScopeKey(cfg.scope)
        || typeof s.token !== 'string' || !s.token || s.token.length > 4096 || /\s/.test(s.token)
        || typeof s.expiresAt !== 'string' || !Number.isFinite(Date.parse(s.expiresAt))
        || Date.parse(s.expiresAt) <= now || Date.parse(s.expiresAt) > now + 15 * 60000
        || s.buildId !== cfg.buildId)
        throw new ReviewAccessError('invalid_session');
    return { token: s.token, expiresAt: s.expiresAt, actor: { ...s.actor }, scope, buildId: s.buildId };
}
/** Explicit per-review transport. It never patches global fetch or browser storage. */
export function createReviewTransport(cfg) {
    if (!isReviewIdentifier(cfg.actorId) || !parseReviewScope(cfg.scope) || !isReviewIdentifier(cfg.buildId)) {
        throw new TypeError('Invalid review transport context');
    }
    const origin = new URL(cfg.origin).origin;
    if (origin !== cfg.origin)
        throw new TypeError('Expected an origin without a path');
    const bootstrap = sameOriginPath(cfg.bootstrapPath, origin);
    const gateway = sameOriginPath(cfg.gatewayPath, origin).href.replace(/\/$/, '');
    const f = cfg.fetch ?? fetch;
    const now = cfg.now ?? Date.now;
    let stopped = false;
    let session = null;
    let pendingSession = null;
    const controllers = new Set();
    function stop() {
        stopped = true;
        session = null;
        controllers.forEach(c => c.abort());
        controllers.clear();
    }
    function loseAccess() {
        stop();
        cfg.onAccessLost?.();
        throw new ReviewAccessError('access_lost');
    }
    async function send(url, init) {
        if (stopped)
            throw new ReviewAccessError('stopped');
        const controller = new AbortController();
        controllers.add(controller);
        const abort = () => controller.abort();
        if (init.signal?.aborted)
            controller.abort();
        init.signal?.addEventListener('abort', abort, { once: true });
        const timeout = setTimeout(abort, 10000);
        try {
            const result = await f(url, { ...init, credentials: 'same-origin', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer', signal: controller.signal });
            if (stopped)
                throw new ReviewAccessError('stopped');
            return result;
        }
        finally {
            clearTimeout(timeout);
            controllers.delete(controller);
            init.signal?.removeEventListener('abort', abort);
        }
    }
    async function getSession(force = false) {
        if (stopped)
            throw new ReviewAccessError('stopped');
        if (pendingSession)
            return pendingSession;
        if (!force && session && Date.parse(session.expiresAt) > now() + 30000)
            return session;
        pendingSession = (async () => {
            const response = await send(bootstrap.href, {
                method: 'POST', headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ campaignId: cfg.scope.campaignId, pagePath: cfg.scope.pagePath, resourceId: cfg.scope.resourceId }),
            });
            if (response.status === 401 || response.status === 403 || response.status === 410)
                return loseAccess();
            if (!response.ok)
                throw new ReviewAccessError('unavailable');
            let checked;
            try {
                checked = validateSession(await response.json(), cfg, now());
            }
            catch {
                return loseAccess();
            }
            if (stopped)
                throw new ReviewAccessError('stopped');
            session = checked;
            return checked;
        })().finally(() => { pendingSession = null; });
        return pendingSession;
    }
    async function request(input, init = {}) {
        const target = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, origin);
        const expected = `${gateway}/v1/annotate/reviews/${encodeURIComponent(cfg.scope.campaignId)}/`;
        if (!target.href.startsWith(expected) || target.origin !== origin || target.username || target.password || target.hash) {
            throw new TypeError('Review request outside its gateway');
        }
        const incoming = new Headers(init.headers);
        const headers = new Headers();
        for (const name of ['content-type', 'idempotency-key', 'if-none-match']) {
            const value = incoming.get(name);
            if (value)
                headers.set(name, value);
        }
        const attempt = async (s) => {
            headers.set('authorization', `Bearer ${s.token}`);
            return send(target.href, { ...init, headers });
        };
        const firstSession = await getSession();
        let response = await attempt(firstSession);
        if (response.status === 401) {
            // Another request may already have renewed the same rejected token.
            const renewed = session && session.token !== firstSession.token ? session : await getSession(true);
            response = await attempt(renewed);
        }
        if (response.status === 401 || response.status === 403)
            return loseAccess();
        return response;
    }
    return { getSession, request, stop, gateway };
}
