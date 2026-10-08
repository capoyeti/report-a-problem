// src/client/upload.ts
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const SIGN_TIMEOUT_MS = 15000;
export const PUT_TIMEOUT_MS = 60000;
export const REPORT_TIMEOUT_MS = 20000;
// Bound the entire operation, including reading the response body. The race
// also handles custom fetch implementations that ignore abort signals.
export async function withRequestDeadline(timeoutMs, parent, run) {
    const controller = new AbortController();
    let timer;
    let abort = () => { };
    const stopped = new Promise((_, reject) => {
        abort = () => { controller.abort(); reject(new Error('Request aborted')); };
        timer = setTimeout(abort, timeoutMs);
        if (parent?.aborted)
            abort();
        else
            parent?.addEventListener('abort', abort, { once: true });
    });
    try {
        if (parent?.aborted)
            return await stopped;
        return await Promise.race([run(controller.signal), stopped]);
    }
    finally {
        clearTimeout(timer);
        parent?.removeEventListener('abort', abort);
    }
}
export async function uploadAttachmentDetailed(endpoint, file, fetchImpl = fetch, signal) {
    let phase = 'sign';
    try {
        const signed = await withRequestDeadline(SIGN_TIMEOUT_MS, signal, async (requestSignal) => {
            const response = await fetchImpl(endpoint, {
                method: 'POST', credentials: 'same-origin',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ filename: file.name, mime: file.type, size_bytes: file.size }),
                signal: requestSignal,
            });
            const body = await response.json().catch(() => null);
            return { response, body };
        });
        const { response, body } = signed;
        if (!response.ok) {
            const error = response.status === 401 ? 'unauthorized' : response.status === 403 ? 'reporting_disabled'
                : response.status === 413 ? 'file_too_large' : response.status === 415 ? 'unsupported_type'
                    : response.status === 429 ? 'rate_limited' : 'service_unavailable';
            return { ok: false, phase, status: response.status, error };
        }
        if (body?.ok !== true || typeof body.attachment_id !== 'string' || !UUID_RE.test(body.attachment_id)
            || typeof body.upload_url !== 'string' || !body.upload_url.trim())
            return { ok: false, phase, error: 'upload_failed' };
        phase = 'put';
        const put = await withRequestDeadline(PUT_TIMEOUT_MS, signal, (requestSignal) => fetchImpl(body.upload_url, {
            method: 'PUT', headers: { 'content-type': file.type, 'x-upsert': 'false' }, body: file, signal: requestSignal,
        }));
        return put.ok ? { ok: true, attachmentId: body.attachment_id } : { ok: false, phase, status: put.status, error: 'upload_failed' };
    }
    catch {
        return { ok: false, phase, error: 'service_unavailable' };
    }
}
// Kept for existing consumers. The panel uses the detailed result instead.
export async function uploadAttachment(endpoint, file, fetchImpl = fetch) {
    const outcome = await uploadAttachmentDetailed(endpoint, file, fetchImpl);
    return outcome.ok ? outcome.attachmentId : null;
}
