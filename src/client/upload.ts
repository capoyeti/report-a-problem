// src/client/upload.ts

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const SIGN_TIMEOUT_MS = 15_000;
export const PUT_TIMEOUT_MS = 60_000;
export const REPORT_TIMEOUT_MS = 20_000;

export type AttachmentUploadOutcome =
  | { ok: true; attachmentId: string }
  | { ok: false; phase: 'sign' | 'put'; status?: number; error: 'unauthorized' | 'reporting_disabled' | 'service_unavailable' | 'unsupported_type' | 'file_too_large' | 'rate_limited' | 'upload_failed' };

// Bound the entire operation, including reading the response body. The race
// also handles custom fetch implementations that ignore abort signals.
export async function withRequestDeadline<T>(timeoutMs: number, parent: AbortSignal | undefined, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  let abort: () => void = () => {};
  const stopped = new Promise<never>((_, reject) => {
    abort = () => { controller.abort(); reject(new Error('Request aborted')); };
    timer = setTimeout(abort, timeoutMs);
    if (parent?.aborted) abort();
    else parent?.addEventListener('abort', abort, { once: true });
  });
  try {
    if (parent?.aborted) return await stopped;
    return await Promise.race([run(controller.signal), stopped]);
  } finally {
    clearTimeout(timer!);
    parent?.removeEventListener('abort', abort);
  }
}

export async function uploadAttachmentDetailed(endpoint: string, file: File, fetchImpl: typeof fetch = fetch, signal?: AbortSignal): Promise<AttachmentUploadOutcome> {
  let phase: 'sign' | 'put' = 'sign';
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
      || typeof body.upload_url !== 'string' || !body.upload_url.trim()) return { ok: false, phase, error: 'upload_failed' };
    phase = 'put';
    const put = await withRequestDeadline(PUT_TIMEOUT_MS, signal, (requestSignal) => fetchImpl(body.upload_url, {
      method: 'PUT', headers: { 'content-type': file.type, 'x-upsert': 'false' }, body: file, signal: requestSignal,
    }));
    return put.ok ? { ok: true, attachmentId: body.attachment_id } : { ok: false, phase, status: put.status, error: 'upload_failed' };
  } catch {
    return { ok: false, phase, error: 'service_unavailable' };
  }
}

// Kept for existing consumers. The panel uses the detailed result instead.
export async function uploadAttachment(endpoint: string, file: File, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  const outcome = await uploadAttachmentDetailed(endpoint, file, fetchImpl);
  return outcome.ok ? outcome.attachmentId : null;
}
