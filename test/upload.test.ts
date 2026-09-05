import { describe, it, expect, vi } from 'vitest';
import { uploadAttachment } from '../src/client/upload';

const file = new File([new Uint8Array([1, 2, 3])], 'shot.png', { type: 'image/png' });
describe('uploadAttachment', () => {
  it('signs via the app endpoint, PUTs bytes to upload_url, returns the attachment id', async () => {
    const calls: any[] = [];
    const f = vi.fn(async (url: string, init: any) => {
      calls.push({ url, init });
      if (url === '/api/error-report/attachment') return new Response(JSON.stringify({ ok: true, attachment_id: 'a1', upload_url: 'https://sb.test/up?token=t' }), { status: 200 });
      return new Response('{}', { status: 200 });
    });
    expect(await uploadAttachment('/api/error-report/attachment', file, f as any)).toBe('a1');
    expect(JSON.parse(calls[0].init.body)).toEqual({ filename: 'shot.png', mime: 'image/png', size_bytes: 3 });
    expect(calls[1]).toMatchObject({ url: 'https://sb.test/up?token=t', init: { method: 'PUT' } });
    expect(calls[1].init.headers['content-type']).toBe('image/png');
  });
  it('returns null when signing is refused or the PUT fails', async () => {
    const refuse = vi.fn(async () => new Response('{"ok":false}', { status: 415 }));
    expect(await uploadAttachment('/api/error-report/attachment', file, refuse as any)).toBeNull();
    const putFails = vi.fn(async (url: string) => url.startsWith('https://') ? new Response('', { status: 400 }) : new Response(JSON.stringify({ ok: true, attachment_id: 'a1', upload_url: 'https://sb.test/up' }), { status: 200 }));
    expect(await uploadAttachment('/api/error-report/attachment', file, putFails as any)).toBeNull();
  });
});
