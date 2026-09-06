// src/server/handlers.ts
import { isSameOrigin } from './same-origin.js';
const MAX_BODY_BYTES = 32 * 1024;
const MAX_ATTACHMENTS = 10;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : undefined);
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
// An `error` key that is present but undefined still counts as a session, so a
// consumer spreading a result object does not accidentally lock its users out.
function hasSession(s) {
    return !('error' in s) || s.error === undefined;
}
async function readJson(req) {
    const raw = await req.text();
    // Measure the bytes we actually read; Content-Length is caller-supplied and a
    // body can be chunked without one at all.
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES)
        return { ok: false, res: json(413, { ok: false, error: 'payload_too_large' }) };
    try {
        return { ok: true, body: obj(JSON.parse(raw || '{}')) };
    }
    catch {
        return { ok: false, res: json(400, { ok: false, error: 'invalid_json' }) };
    }
}
async function callService(cfg, path, payload, timeoutMs) {
    const f = cfg.fetch ?? fetch;
    try {
        return await f(`${cfg.serviceUrl.replace(/\/$/, '')}${path}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-triage-key': cfg.serviceKey },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(timeoutMs),
        });
    }
    catch {
        return 'unavailable';
    }
}
/**
 * Builds the two routes an app needs: `report` forwards a filed report to
 * error-triage-service, `attachment` swaps a filename for a signed upload URL.
 * Both are plain `(Request) => Promise<Response>`, so a Next.js App Router file
 * is a single `export const POST`, and any other framework is a one-line adapter.
 *
 * The service key lives here and never reaches the browser, which is the reason
 * these exist at all rather than the panel calling the service directly.
 *
 * `report` awaits the service instead of firing and forgetting, unlike an
 * automatic error-boundary capture: a person is sitting in front of the panel
 * waiting for a reference number. Awaiting means a slow service becomes a
 * timeout, which is why the panel sends a stable `submission_id` and the service
 * settles the retry as a duplicate rather than filing the report twice.
 */
export function createReportProblemHandlers(cfg) {
    const timeoutMs = cfg.timeoutMs ?? 8000;
    async function guard(req) {
        if (!isSameOrigin(req))
            return { ok: false, res: json(403, { ok: false, error: 'bad_origin' }) };
        const s = await cfg.verifySession();
        if (!hasSession(s) || !s.user?.id)
            return { ok: false, res: json(401, { ok: false, error: 'unauthorized' }) };
        return { ok: true, session: s };
    }
    const identity = (s) => ({
        tenant_id: s.tenantId ?? null,
        tenant_name: s.tenantName ?? null,
        reporter: { id: s.user.id, email: s.user.email ?? null, name: s.user.name ?? null },
    });
    return {
        async report(req) {
            const g = await guard(req);
            if (!g.ok)
                return g.res;
            const r = await readJson(req);
            if (!r.ok)
                return r.res;
            const b = r.body;
            const submissionId = str(b.submission_id, 64);
            const attachmentIds = (Array.isArray(b.attachment_ids) ? b.attachment_ids : [])
                .filter((x) => typeof x === 'string' && UUID_RE.test(x))
                .slice(0, MAX_ATTACHMENTS);
            // Whitelist client diagnostics FIRST, then bind identity from the session.
            // Never spread client input over identity.
            const payload = {
                code: str(b.code, 200),
                route: str(b.route, 200),
                user_message: str(b.userMessage, 2000),
                technical_message: str(b.technicalMessage, 8192),
                stack: str(b.stack, 8192),
                context: obj(b.context),
                occurred_at: new Date().toISOString(),
                submission_id: submissionId && UUID_RE.test(submissionId) ? submissionId : undefined,
                attachment_ids: attachmentIds,
                ...identity(g.session),
            };
            const res = await callService(cfg, '/api/v1/report', payload, timeoutMs);
            if (res === 'unavailable')
                return json(502, { ok: false, error: 'service_unavailable' });
            if (res.status === 429)
                return json(429, { ok: false, error: 'rate_limited' });
            if (!res.ok)
                return json(502, { ok: false, error: 'service_error' });
            const svc = (await res.json().catch(() => ({})));
            if (!svc.ok)
                return json(502, { ok: false, error: 'service_error' });
            return json(200, {
                ok: true,
                ref: svc.ref ?? svc.report_id ?? null,
                reportId: svc.report_id ?? null,
                delivered: svc.delivered ?? {},
                duplicate: svc.duplicate === true,
                filed: svc.filed !== false,
            });
        },
        async attachment(req) {
            const g = await guard(req);
            if (!g.ok)
                return g.res;
            const r = await readJson(req);
            if (!r.ok)
                return r.res;
            const b = r.body;
            const size = typeof b.size_bytes === 'number' ? b.size_bytes : Number.NaN;
            if (!Number.isFinite(size) || typeof b.mime !== 'string')
                return json(400, { ok: false, error: 'invalid_body' });
            const id = identity(g.session);
            const res = await callService(cfg, '/api/v1/attachments/sign', { reporter: { id: id.reporter.id }, tenant_id: id.tenant_id, filename: str(b.filename, 255), mime: b.mime, size_bytes: size }, 5000);
            if (res === 'unavailable')
                return json(502, { ok: false, error: 'service_unavailable' });
            // Pass the service's own status and body straight back. The service owns
            // the mime allowlist and size cap, so its 413 or 415 is the message the
            // panel should show; re-wrapping it here would only lose the reason.
            const text = await res.text();
            return new Response(text, { status: res.status, headers: { 'content-type': 'application/json' } });
        },
    };
}
