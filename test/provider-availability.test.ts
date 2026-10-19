// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, hydrateRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { ReportProblemProvider, useReportProblem, type ReportProblemProviderProps } from '../src/client/ReportProblemProvider';

const capture = vi.hoisted(() => vi.fn(async () => ({ toBlob: (cb: (blob: Blob | null) => void) => cb(new Blob(['capture'])) })));
vi.mock('html2canvas', () => ({ default: capture }));
let host: HTMLDivElement; let root: Root;
function Trigger() {
  const { open, enabled, isOpen } = useReportProblem();
  return React.createElement('button', { onClick: open, hidden: !enabled, 'data-open': String(isOpen), 'data-testid': 'trigger' }, 'Report');
}
function tree(props: Partial<ReportProblemProviderProps> = {}, key = 'tenant:actor:profile') {
  return React.createElement(ReportProblemProvider, { ...props, key, children: React.createElement(Trigger) });
}
const query = <T extends HTMLElement = HTMLElement>(id: string) => host.querySelector<T>(`[data-testid="${id}"]`)!;
async function render(props = {}, key?: string) { await act(async () => root.render(tree(props, key))); }
async function open() { await act(async () => query('trigger').click()); }
async function fill() {
  await act(async () => {
    const text = query<HTMLTextAreaElement>('report-text');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(text, 'Retained draft');
    text.dispatchEvent(new Event('input', { bubbles: true }));
    const input = query<HTMLInputElement>('report-file-input');
    Object.defineProperty(input, 'files', { configurable: true, value: [new File(['shot'], 'local.png', { type: 'image/png' })] });
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  capture.mockClear(); vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  URL.createObjectURL = vi.fn(() => 'blob:local'); URL.revokeObjectURL = vi.fn();
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ok: true, filed: true, ref: 'REP-1' })));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('availability and mounted draft lifecycle', () => {
  it('P1 ready/checking/unavailable/ready retains textarea, files, capture and DOM position without network reads', async () => {
    await render(); await open(); await fill();
    const panel = query('report-problem-panel'); const text = query<HTMLTextAreaElement>('report-text'); const shot = host.querySelector('.rap-shot');
    for (const availability of [
      { canSubmit: true, message: 'Checking' }, { canSubmit: false, message: 'Unavailable' }, { canSubmit: true },
    ]) {
      await render({ availability });
      expect(query('report-problem-panel')).toBe(panel); expect(query('report-text')).toBe(text); expect(text.value).toBe('Retained draft');
      expect(host.querySelector('.rap-shot')).toBe(shot); expect(query<HTMLButtonElement>('report-send').disabled).toBe(!availability.canSubmit);
      expect(panel.style.left).toBe('');
    }
    expect(capture).toHaveBeenCalledTimes(1); expect(fetch).not.toHaveBeenCalled();
  });
  it('P2 hides trigger, preserves open disabled draft, and close cannot reopen on re-enable', async () => {
    await render(); await open(); await fill(); await render({ enabled: false });
    expect(query('trigger').hidden).toBe(true); expect(query<HTMLTextAreaElement>('report-text').value).toBe('Retained draft');
    expect(query<HTMLButtonElement>('report-send').disabled).toBe(true); expect(query('report-availability').textContent).toContain('turned off');
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Close"]')!.click());
    await render({ enabled: true }); expect(query('report-problem-panel')).toBeNull();
    await open(); expect(query<HTMLTextAreaElement>('report-text').value).toBe(''); expect(host.querySelector('.rap-shot')).toBeNull();
  });
  it('P3 unknown configured is visible/blocked; missing config hides entry and preserves existing draft', async () => {
    const availability = { canSubmit: false, message: 'Unavailable' };
    await render({ availability }); expect(query('trigger').hidden).toBe(false); await open(); await fill();
    expect(query<HTMLButtonElement>('report-send').disabled).toBe(true);
    await render({ enabled: false, availability }); expect(query('trigger').hidden).toBe(true); expect(query<HTMLTextAreaElement>('report-text').value).toBe('Retained draft');
  });
  it('P4 outside context is inert, initially disabled does not mount/capture, omitted props allow sending', async () => {
    await act(async () => root.render(React.createElement(Trigger))); await open(); expect(query('trigger').dataset.open).toBe('false');
    await render({ enabled: false }); await open(); expect(query('report-problem-panel')).toBeNull(); expect(capture).not.toHaveBeenCalled();
    await render(); await open(); await fill(); expect(query<HTMLButtonElement>('report-send').disabled).toBe(false);
  });
  it('P5 key change clears files, IDs, draft and old success; late POST completion is ignored', async () => {
    let resolve!: (res: Response) => void; let signal!: AbortSignal;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      if (url.includes('attachment')) return Response.json({ ok: true, attachment_id: '22222222-2222-4222-8222-222222222222', upload_url: 'https://storage.test/up' });
      if (init.method === 'PUT') return new Response('');
      signal = init.signal as AbortSignal; return new Promise<Response>((r) => { resolve = r; });
    }));
    await render(); await open(); await fill(); await act(async () => query('report-send').click());
    await render({}, 'new-tenant:new-actor:new-profile'); expect(signal.aborted).toBe(true);
    await act(async () => resolve(Response.json({ ok: true, filed: true, ref: 'OLD' })));
    await open(); expect(query<HTMLTextAreaElement>('report-text').value).toBe(''); expect(host.querySelector('.rap-shot')).toBeNull(); expect(query('report-sent')).toBeNull();
  });
  it('P6 retry is native keyboard-operable button, live region and retrying state are accessible', async () => {
    const retry = vi.fn(); await render({ availability: { canSubmit: false, onRetry: retry, message: 'Unavailable' } }); await open();
    const notice = query('report-availability'); expect(notice.getAttribute('role')).toBe('status'); expect(notice.getAttribute('aria-live')).toBe('polite');
    const button = notice.querySelector<HTMLButtonElement>('button')!; button.focus(); expect(document.activeElement).toBe(button);
    await act(async () => button.click()); expect(retry).toHaveBeenCalledTimes(1);
    await render({ availability: { canSubmit: false, onRetry: retry, retrying: true, message: 'Unavailable' } }); expect(button.disabled).toBe(true);
  });
  it('P7 unknown SSR and hydration match without capture, warning or network poll', async () => {
    await act(async () => root.unmount());
    const props = { availability: { canSubmit: false, message: 'Unavailable' } };
    host.innerHTML = renderToString(tree(props)); const html = host.innerHTML;
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await act(async () => { root = hydrateRoot(host, tree(props)); });
    expect(host.innerHTML).toBe(html); expect(error).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled(); expect(capture).not.toHaveBeenCalled();
  });
  it('P9 Cancel/reopen creates new submission UUID; provider removal and reload boundary clear drafts and URLs', async () => {
    const ids: string[] = []; vi.stubGlobal('fetch', vi.fn(async (_: string, init: RequestInit) => { ids.push(JSON.parse(init.body as string).submission_id); return Response.json({ ok: false, error: 'reporting_disabled' }, { status: 403 }); }));
    await render(); await open();
    await act(async () => {
      const text = query<HTMLTextAreaElement>('report-text'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(text, 'Report'); text.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => query('report-send').click());
    await act(async () => Array.from(host.querySelectorAll('button')).find((b) => b.textContent === 'Cancel')!.click());
    await open(); expect(query<HTMLTextAreaElement>('report-text').value).toBe('');
    await act(async () => { const text = query<HTMLTextAreaElement>('report-text'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(text, 'New'); text.dispatchEvent(new Event('input', { bubbles: true })); });
    await act(async () => query('report-send').click()); expect(ids[0]).not.toBe(ids[1]);
    await act(async () => root.render(null)); await render(); await open(); expect(query<HTMLTextAreaElement>('report-text').value).toBe(''); expect(URL.revokeObjectURL).toHaveBeenCalled();
  });
});
