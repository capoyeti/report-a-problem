import { getReviewScopeKey, isReviewIdentifier, parseReviewScope, REVIEW_ROLES } from './contract.js';
export class ReviewAccessError extends Error {
    constructor(kind) {
        super(kind === 'build_changed' ? 'A newer version of this page is available. Reload to continue. Your draft stays on this device.'
            : kind === 'access_lost' ? 'Sign in again or ask the review lead to check your access.'
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
export function createReviewTransport(config) {
    const cfg = { ...config, scope: { ...config.scope } };
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
                method: 'POST', headers: { 'content-type': 'application/json', 'x-review-client-build': cfg.buildId },
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
    async function oneRequest(input, init = {}) {
        const target = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, origin);
        const native = `${gateway}/v1/annotate/reviews/${encodeURIComponent(cfg.scope.campaignId)}/`;
        const sidecar = `${gateway}/v1/reviews/${encodeURIComponent(cfg.scope.campaignId)}/threads/`;
        if ((!target.href.startsWith(native) && !target.href.startsWith(sidecar)) || target.origin !== origin || target.username || target.password || target.hash) {
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
        if (response.status === 409) {
            const error = await response.clone().json().catch(() => null);
            if (error?.error === 'build_mismatch') {
                stop();
                cfg.onBuildChanged?.();
                throw new ReviewAccessError('build_changed');
            }
        }
        if (response.status === 401 || response.status === 403)
            return loseAccess();
        return response;
    }
    async function request(input, init = {}) {
        const target = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, origin);
        const listPath = `${gateway}/v1/annotate/reviews/${encodeURIComponent(cfg.scope.campaignId)}/comments`;
        const findingPath = `${gateway}/v1/reviews/${encodeURIComponent(cfg.scope.campaignId)}/threads/`;
        if ((init.method ?? 'GET').toUpperCase() === 'GET' && target.href.startsWith(findingPath) && target.pathname.endsWith('/finding')) {
            let snapshot = null;
            const retests = [];
            const cursors = new Set();
            for (let page = 0; page <= 100; page++) {
                const response = await oneRequest(target, init);
                if (!response.ok)
                    return response;
                const data = await response.json();
                if (!Array.isArray(data.retests) || !data.finding || snapshot && snapshot.finding.version !== data.finding.version)
                    throw new Error('Finding changed during history load');
                if (!snapshot)
                    snapshot = data;
                retests.push(...data.retests);
                if (retests.length > 10000)
                    throw new Error('Retest history exceeds limit');
                if (data.retestsComplete === true || data.retestsComplete === undefined && data.nextRetestCursor == null)
                    return new Response(JSON.stringify({ ...snapshot, retests, retestsComplete: true, nextRetestCursor: null }), { status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
                if (data.retestsComplete !== false || typeof data.nextRetestCursor !== 'string' || !data.nextRetestCursor || cursors.has(data.nextRetestCursor))
                    throw new Error('Invalid retest history cursor');
                cursors.add(data.nextRetestCursor);
                target.searchParams.set('retestCursor', data.nextRetestCursor);
            }
            throw new Error('Retest history is incomplete');
        }
        if ((init.method ?? 'GET').toUpperCase() !== 'GET' || target.origin + target.pathname !== listPath)
            return oneRequest(input, init);
        // ReviewJS expects one full snapshot. Drain all pages before exposing any,
        // so an interrupted later page cannot erase previously visible threads.
        const headers = new Headers(init.headers);
        headers.delete('if-none-match');
        const comments = [];
        const cursors = new Set();
        for (let page = 0; page <= 100; page++) {
            const response = await oneRequest(target, { ...init, headers });
            if (!response.ok)
                return response;
            const data = await response.json();
            if (!Array.isArray(data.comments))
                throw new Error('Invalid shared comment snapshot');
            comments.push(...data.comments);
            if (comments.length > 10000)
                throw new Error('Shared comment snapshot exceeds campaign limit');
            if (data.complete === true || data.complete === undefined && data.nextCursor == null) {
                return new Response(JSON.stringify({ comments: [...new Map(comments.map(c => [c.id, c])).values()], complete: true, nextCursor: null }), {
                    status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
                });
            }
            if (data.complete !== false || typeof data.nextCursor !== 'string' || !data.nextCursor || cursors.has(data.nextCursor))
                throw new Error('Invalid shared comment cursor');
            cursors.add(data.nextCursor);
            target.searchParams.set('cursor', data.nextCursor);
        }
        throw new Error('Shared comment snapshot is incomplete');
    }
    return { getSession, request, stop, gateway };
}
