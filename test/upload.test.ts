import { describe, it, expect, vi } from 'vitest';
import { uploadAttachment } from '../src/client/upload';

const file = new File([new Uint8Array([1, 2, 3])], 'shot.png', { type: 'image/png' });
describe('uploadAttachment', () => {
  it('signs via the app endpoint, PUTs bytes to upload_url, returns the attachment id', async () => {
    const calls: any[] = [];
    const f = vi.fn(async (url: string, init: any) => {
      calls.push({ url, init });
      if (url === '/api/error-report/attachment') return new Response(JSON.stringify({ ok: true, attachment_id: '11111111-1111-4111-8111-111111111111', upload_url: 'https://sb.test/up?token=t' }), { status: 200 });
      return new Response('{}', { status: 200 });
    });
    expect(await uploadAttachment('/api/error-report/attachment', file, f as any)).toBe('11111111-1111-4111-8111-111111111111');
    expect(JSON.parse(calls[0].init.body)).toEqual({ filename: 'shot.png', mime: 'image/png', size_bytes: 3 });
    expect(calls[1]).toMatchObject({ url: 'https://sb.test/up?token=t', init: { method: 'PUT' } });
    expect(calls[1].init.headers['content-type']).toBe('image/png');
  });
  it('returns null when signing is refused or the PUT fails', async () => {
    const refuse = vi.fn(async () => new Response('{"ok":false}', { status: 415 }));
    expect(await uploadAttachment('/api/error-report/attachment', file, refuse as any)).toBeNull();
    const putFails = vi.fn(async (url: string) => url.startsWith('https://') ? new Response('', { status: 400 }) : new Response(JSON.stringify({ ok: true, attachment_id: '11111111-1111-4111-8111-111111111111', upload_url: 'https://sb.test/up' }), { status: 200 }));
    expect(await uploadAttachment('/api/error-report/attachment', file, putFails as any)).toBeNull();
  });
});

import { uploadAttachmentDetailed, SIGN_TIMEOUT_MS, PUT_TIMEOUT_MS } from '../src/client/upload';

describe('detailed upload bounds', () => {
  it.each([[401, 'unauthorized'], [403, 'reporting_disabled'], [413, 'file_too_large'], [415, 'unsupported_type'], [429, 'rate_limited'], [503, 'service_unavailable']])('G12 controlled sign refusal %s', async (status, error) => {
    const f = vi.fn(async () => Response.json({ error: 'private' }, { status: status as number }));
    expect(await uploadAttachmentDetailed('/sign', file, f as any)).toEqual({ ok: false, phase: 'sign', status, error });
    expect(f).toHaveBeenCalledTimes(1);
  });
  it.each(['headers', 'body', 'put'])('U4 bounds stalled %s', async (phase) => {
    vi.useFakeTimers();
    try {
      let signal: AbortSignal | undefined;
      const f = vi.fn(async (url: string, init: RequestInit) => {
        signal = init.signal as AbortSignal;
        if (phase === 'headers' || (phase === 'put' && url.startsWith('https'))) return await new Promise<Response>(() => {});
        if (phase === 'body') return { ok: true, json: () => new Promise(() => {}) } as Response;
        return Response.json({ ok: true, attachment_id: '11111111-1111-4111-8111-111111111111', upload_url: 'https://storage.test/up' });
      });
      const outcome = uploadAttachmentDetailed('/sign', file, f as any);
      await vi.advanceTimersByTimeAsync(phase === 'put' ? PUT_TIMEOUT_MS : SIGN_TIMEOUT_MS);
      expect(await outcome).toMatchObject({ ok: false, phase: phase === 'put' ? 'put' : 'sign', error: 'service_unavailable' });
      expect(signal?.aborted).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
  it('U5 parent abort stops pending sign and does not start PUT', async () => {
    const controller = new AbortController();
    const f = vi.fn(async () => await new Promise<Response>(() => {}));
    const result = uploadAttachmentDetailed('/sign', file, f as any, controller.signal);
    controller.abort();
    expect(await result).toMatchObject({ ok: false, phase: 'sign' });
    expect(f).toHaveBeenCalledTimes(1);
  });
});

  it.each(['not-a-uuid', '', null, 42])('U1 malformed sign ID %j prevents PUT', async (attachment_id) => {
    const f = vi.fn(async () => Response.json({ ok: true, attachment_id, upload_url: 'https://storage.test/up' }));
    expect(await uploadAttachmentDetailed('/sign', file, f as any)).toMatchObject({ ok: false, phase: 'sign', error: 'upload_failed' });
    expect(f).toHaveBeenCalledTimes(1);
  });
