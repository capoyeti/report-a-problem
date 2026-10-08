// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ReportProblemPanel } from '../src/client/ReportProblemPanel';
import { REPORT_TIMEOUT_MS, SIGN_TIMEOUT_MS, PUT_TIMEOUT_MS } from '../src/client/upload';

vi.mock('html2canvas', () => ({ default: vi.fn(async () => ({ toBlob: (cb: (v: Blob | null) => void) => cb(new Blob(['capture'], { type: 'image/png' })) })) }));
let root: Root;
let host: HTMLDivElement;
let onClose: ReturnType<typeof vi.fn>;
const query = <T extends HTMLElement = HTMLElement>(id: string) => host.querySelector<T>(`[data-testid="${id}"]`)!;
const button = () => query<HTMLButtonElement>('report-send');
const tick = async () => { await act(async () => { await Promise.resolve(); }); };
async function mount(props = {}) {
  await act(async () => root.render(React.createElement(ReportProblemPanel, { open: true, onClose, ...props })));
}
async function fill(value = 'The export is broken') {
  await act(async () => {
    const input = query<HTMLTextAreaElement>('report-text');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function files(names: string[]) {
  await act(async () => {
    const input = query<HTMLInputElement>('report-file-input');
    Object.defineProperty(input, 'files', { configurable: true, value: names.map((name) => new File(['data'], name, { type: 'image/png' })) });
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
async function send() { await act(async () => button().click()); }
const idFor = (name: string) => `00000000-0000-4000-8000-${Array.from(name).reduce((n,c) => n + c.charCodeAt(0), 0).toString().padStart(12, '0')}`;
const success = (copy: unknown = false) => Response.json({ ok: true, filed: true, ref: 'REP-1', delivered: { reporter_copy: copy } });
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host); onClose = vi.fn();
  vi.stubGlobal('fetch', vi.fn(async () => success()));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  URL.createObjectURL = vi.fn(() => 'blob:local'); URL.revokeObjectURL = vi.fn();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('truthful panel delivery', () => {
  it.each([{}, { ok: true, ref: 'REP-1' }, { ok: true, filed: false, ref: 'REP-1' }, { ok: true, filed: true, ref: 4 }, { ok: true, filed: true, ref: 'REP-1', reportId: {} }, null])('G8 rejects consumer proof %j and preserves text', async (body) => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(body)));
    await mount(); await fill(); await send();
    expect(query('report-sent')).toBeNull(); expect(query('report-error')).not.toBeNull();
    expect(query<HTMLTextAreaElement>('report-text').value).toBe('The export is broken');
    expect(query<HTMLTextAreaElement>('report-text').disabled).toBe(true);
  });
  it.each([true, false, 'true', 1, null])('G7 email claim only for exact true: %j', async (copy) => {
    vi.stubGlobal('fetch', vi.fn(async () => success(copy)));
    await mount(); await fill(); await send();
    expect(query('report-sent').textContent?.includes("We've emailed")).toBe(copy === true);
  });
  it('G9/G10/U6 ambiguous retry preserves exact body, route, UUID and IDs; duplicate files once', async () => {
    let posts = 0; const bodies: string[] = []; const durable = new Map<string, string>();
    const f = vi.fn(async (url: string, init: RequestInit) => {
      if (url.includes('attachment')) return Response.json({ ok: true, attachment_id: '11111111-1111-4111-8111-111111111111', upload_url: 'https://storage.test/up' });
      if (init.method === 'PUT') return new Response('');
      bodies.push(init.body as string); posts++;
      const id = JSON.parse(init.body as string).submission_id;
      durable.set(id, 'REP-1');
      if (posts === 1) throw new Error('reply lost after filing');
      return Response.json({ ok: true, filed: true, duplicate: true, ref: durable.get(id) });
    });
    vi.stubGlobal('fetch', f); await mount(); await fill(); await files(['one.png']); await send();
    expect(query<HTMLTextAreaElement>('report-text').disabled).toBe(true);
    expect(host.querySelector<HTMLButtonElement>('[aria-label="Remove one.png"]')?.disabled).toBe(true);
    history.pushState({}, '', '/new-route');
    await send(); expect(bodies[1]).toBe(bodies[0]); expect(durable.size).toBe(1);
    expect(JSON.parse(bodies[0]).attachment_ids).toEqual(['11111111-1111-4111-8111-111111111111']);
    expect(f.mock.calls.filter(([, init]) => init.method === 'PUT')).toHaveLength(1);
    expect(query('report-sent').textContent).toContain('REP-1');
    history.replaceState({}, '', '/');
  });
  it.each([[401, 'unauthorized'], [403, 'reporting_disabled'], [503, 'service_unavailable'], [429, 'rate_limited']])('G9/U6 prior lost reply stays locked across later %s refusal until original duplicate is proven', async (status, error) => {
    const requests: { endpoint: string; body: string }[] = [];
    const f = vi.fn(async (endpoint: string, init: RequestInit) => {
      requests.push({ endpoint, body: init.body as string });
      if (requests.length === 1) throw new Error('lost reply after filing');
      if (requests.length === 2) return Response.json({ ok: false, error }, { status: status as number });
      return Response.json({ ok: true, filed: true, duplicate: true, ref: 'ORIGINAL-1' });
    });
    vi.stubGlobal('fetch', f); await mount({ endpoints: { report: '/original-report' } }); await fill('Original content'); await send();
    history.pushState({}, '', '/changed-page');
    await mount({ endpoints: { report: '/changed-report' } }); await send();
    expect(query<HTMLTextAreaElement>('report-text').disabled).toBe(true);
    expect(button().textContent).toContain('Retry same report');
    expect(requests[1]).toEqual(requests[0]);
    expect(JSON.parse(requests[1].body).userMessage).toContain('Original content');
    await send(); expect(requests[2]).toEqual(requests[0]); expect(query('report-sent').textContent).toContain('ORIGINAL-1');
    history.replaceState({}, '', '/');
  });
  it('G11 ref excludes synchronous double click while signing and POST are pending', async () => {
    let resolve!: (r: Response) => void;
    const f = vi.fn(() => new Promise<Response>((r) => { resolve = r; })); vi.stubGlobal('fetch', f);
    await mount(); await fill();
    await act(async () => { button().click(); button().click(); });
    expect(f).toHaveBeenCalledTimes(1);
    await act(async () => resolve(success()));
    expect(query('report-sent')).not.toBeNull();
  });
  it('G11 synchronous double submission starts one sign/PUT pipeline and one POST', async () => {
    let resolve!: (res: Response) => void;
    const f = vi.fn(async (url: string, init: RequestInit) => {
      if (url.includes('attachment')) return await new Promise<Response>((r) => { resolve = r; });
      return init.method === 'PUT' ? new Response('') : success();
    });
    vi.stubGlobal('fetch', f); await mount(); await fill(); await files(['one.png']);
    await act(async () => { button().click(); button().click(); }); expect(f).toHaveBeenCalledTimes(1);
    await act(async () => resolve(Response.json({ ok: true, attachment_id: '11111111-1111-4111-8111-111111111111', upload_url: 'https://storage.test/up' })));
    expect(f).toHaveBeenCalledTimes(3); expect(query('report-sent')).not.toBeNull();
  });
  it.each([[401, 'unauthorized', 'sign in'], [403, 'reporting_disabled', 'not enabled'], [503, 'service_unavailable', 'still here'], [429, 'rate_limited', 'minute']])('G6/U6 definitive %s permits edits and retains text', async (status, error, text) => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ok: false, error }, { status: status as number })));
    await mount(); await fill(); await send();
    expect(query<HTMLTextAreaElement>('report-text').disabled).toBe(false);
    expect(query('report-error').textContent).toContain(text);
  });
  it('U1/U2 failed attachment prevents POST; retry reuses successful ID; remove excludes ID', async () => {
    let fail = true; const posted: any[] = []; const signed: string[] = [];
    const f = vi.fn(async (url: string, init: RequestInit) => {
      if (init.method === 'PUT') return new Response('');
      const body = JSON.parse(init.body as string);
      if (url.includes('attachment')) {
        signed.push(body.filename);
        if (body.filename === 'bad.png' && fail) return new Response('{}', { status: 503 });
        return Response.json({ ok: true, attachment_id: idFor(body.filename), upload_url: 'https://storage.test/up' });
      }
      posted.push(body); return success();
    });
    vi.stubGlobal('fetch', f); await mount(); await fill(); await files(['good.png', 'bad.png']); await send();
    expect(posted).toHaveLength(0); expect(host.querySelectorAll('.rap-shot')).toHaveLength(2);
    expect(host.textContent).toContain("Some attachments couldn't be uploaded");
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Remove good.png"]')!.click());
    fail = false; await send();
    expect(signed).toEqual(['good.png', 'bad.png', 'bad.png']); expect(posted[0].attachment_ids).toEqual([idFor('bad.png')]);
  });
  it('U2 retains successful IDs and runs at most three pipelines', async () => {
    let active = 0; let max = 0; let fail = true; const signed: string[] = []; const posted: any[] = [];
    const f = vi.fn(async (url: string, init: RequestInit) => {
      if (init.method === 'PUT') { await Promise.resolve(); active--; return new Response(''); }
      const body = JSON.parse(init.body as string);
      if (url.includes('attachment')) {
        signed.push(body.filename); active++; max = Math.max(max, active);
        await Promise.resolve();
        if (body.filename === '6.png' && fail) { active--; return new Response('{}', { status: 503 }); }
        return Response.json({ ok: true, attachment_id: idFor(body.filename), upload_url: 'https://storage.test/up' });
      }
      posted.push(body); return success();
    });
    vi.stubGlobal('fetch', f); await mount(); await fill(); await files(['1.png', '2.png', '3.png', '4.png', '5.png', '6.png']); await send();
    expect(max).toBe(3); expect(posted).toHaveLength(0);
    fail = false; await send(); expect(signed.filter((n) => n !== '6.png')).toHaveLength(5);
    expect(signed.filter((n) => n === '6.png')).toHaveLength(2); expect(posted[0].attachment_ids).toHaveLength(6);
  });
  it('U3 rejects unsupported and oversized files with unchanged six-file cap', async () => {
    await mount(); await fill();
    await act(async () => {
      const input = query<HTMLInputElement>('report-file-input');
      Object.defineProperty(input, 'files', { configurable: true, value: [new File(['x'], 'x.exe', { type: 'application/x-exe' })] });
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(host.textContent).toContain('not supported');
    await act(async () => {
      const file = new File(['x'], 'big.png', { type: 'image/png' }); Object.defineProperty(file, 'size', { value: 8 * 1024 * 1024 + 1 });
      Object.defineProperty(query('report-file-input'), 'files', { configurable: true, value: [file] }); query('report-file-input').dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(host.textContent).toContain('over 8.0MB');
    await files(['1.png','2.png','3.png','4.png','5.png','6.png','7.png']);
    expect(host.querySelectorAll('.rap-shot')).toHaveLength(6); expect(host.textContent).toContain('up to 6 files');
  });
  it.each(['headers', 'body'])('U4 report %s timeout removes spinner and keeps attempted body', async (phase) => {
    await mount(); await fill(); vi.useFakeTimers();
    let signal!: AbortSignal;
    vi.stubGlobal('fetch', vi.fn(async (_: string, init: RequestInit) => {
      signal = init.signal as AbortSignal;
      if (phase === 'body') return { ok: true, json: () => new Promise(() => {}) } as Response;
      return await new Promise<Response>(() => {});
    }));
    await send(); await act(async () => vi.advanceTimersByTimeAsync(REPORT_TIMEOUT_MS));
    expect(button().disabled).toBe(false); expect(button().textContent).toContain('Retry same report'); expect(signal.aborted).toBe(true);
  });
  it.each(['sign', 'put'])('U4 stalled %s exits spinner without discarding the selected file or freezing edits', async (phase) => {
    await mount(); await fill(); await files(['one.png']); vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async (_: string, init: RequestInit) => {
      if (phase === 'sign' || init.method === 'PUT') return await new Promise<Response>(() => {});
      return Response.json({ ok: true, attachment_id: '11111111-1111-4111-8111-111111111111', upload_url: 'https://storage.test/up' });
    }));
    await send(); await act(async () => vi.advanceTimersByTimeAsync(phase === 'sign' ? SIGN_TIMEOUT_MS : PUT_TIMEOUT_MS));
    expect(button().disabled).toBe(false); expect(host.querySelectorAll('.rap-shot')).toHaveLength(1);
    expect(query<HTMLTextAreaElement>('report-text').disabled).toBe(false); expect(query('report-sent')).toBeNull();
  });
  it('U5/P5 unmount aborts upload, ignores late ID and revokes selected/consent URLs', async () => {
    let resolve!: (r: Response) => void; let signal!: AbortSignal;
    const f = vi.fn((_: string, init: RequestInit) => { signal = init.signal as AbortSignal; return new Promise<Response>((r) => { resolve = r; }); });
    vi.stubGlobal('fetch', f); await mount(); await fill(); await files(['one.png']); await send();
    await act(async () => root.render(null)); expect(signal.aborted).toBe(true);
    await act(async () => resolve(Response.json({ ok: true, attachment_id: '22222222-2222-4222-8222-222222222222', upload_url: 'https://storage.test/up' })));
    expect(f).toHaveBeenCalledTimes(1); expect(URL.revokeObjectURL).toHaveBeenCalled();
    await mount(); expect(query<HTMLTextAreaElement>('report-text').value).toBe('');
  });
  it('U7 no auto capture upload without explicit Include consent', async () => {
    const f = vi.fn(async () => success()); vi.stubGlobal('fetch', f);
    await mount(); await tick(); expect(query('report-auto-shot')).not.toBeNull();
    await fill(); await send(); expect(f).toHaveBeenCalledTimes(1);
    expect(JSON.parse(f.mock.calls[0][1]?.body as string).attachment_ids).toEqual([]);
  });
  it('U8 close unresolved warns, declined close preserves and accepted close never auto-resends', async () => {
    const f = vi.fn(async () => { throw new Error('lost'); }); vi.stubGlobal('fetch', f);
    await mount(); await fill(); await send();
    vi.mocked(window.confirm).mockReturnValue(false);
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Close"]')!.click()); expect(onClose).not.toHaveBeenCalled();
    expect(query<HTMLTextAreaElement>('report-text').value).not.toBe('');
    vi.mocked(window.confirm).mockReturnValue(true);
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Close"]')!.click());
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('may already have been received')); expect(onClose).toHaveBeenCalledTimes(1); expect(f).toHaveBeenCalledTimes(1);
  });
  it('P8 availability during a dispatched POST preserves successful completion', async () => {
    let resolve!: (r: Response) => void; vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((r) => { resolve = r; })));
    await mount(); await fill(); await send();
    await mount({ availability: { canSubmit: false, message: 'Unavailable' } });
    await act(async () => resolve(success())); expect(query('report-sent')).not.toBeNull();
  });
});
