// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createReviewAdapter, type ReviewAdapterConfig } from '../src/review/adapter.js';
import type { ReviewRenderer, ReviewSession } from '../src/review/types.js';

const scope = { appId: 'app-a', tenantId: null, environment: 'test', campaignId: 'october', pagePath: '/', resourceId: null };
const disposals: Array<() => void> = [];
afterEach(() => { disposals.splice(0).forEach(stop => stop()); });
function setup(actorId = 'rhona', patch: Partial<ReviewAdapterConfig> = {}) {
  const session: ReviewSession = { actor: { id: actorId, name: actorId, role: 'reviewer' }, scope,
    token: 'fixture-session', expiresAt: new Date(Date.now() + 600_000).toISOString(), buildId: 'build-a' };
  const renderer: ReviewRenderer = {
    init: vi.fn().mockReturnThis(), destroy: vi.fn(), open: vi.fn(), close: vi.fn(),
    setTool: vi.fn(), refresh: vi.fn(), comments: vi.fn(() => []),
    syncState: vi.fn(() => ({ state: 'idle', pending: 0 })), submit: vi.fn(async () => ({})),
  };
  const loadRenderer = vi.fn(async () => ({ createController: () => renderer }));
  const config: ReviewAdapterConfig = { actorId, scope, gatewayPath: '/api/review', bootstrapPath: '/api/review/session', buildId: 'build-a',
    fetch: vi.fn(async () => new Response(JSON.stringify(session), { status: 200 })), loadRenderer, ...patch };
  const adapter = createReviewAdapter(config, window); disposals.push(adapter.stop);
  return { adapter, renderer, loadRenderer, config, session };
}

describe('review lifecycle owner', () => {
  it('coalesces mounts and loads the renderer only after verified bootstrap', async () => {
    const { adapter, renderer, loadRenderer } = setup();
    expect(loadRenderer).not.toHaveBeenCalled();
    await Promise.all([adapter.mount(), adapter.mount()]); await adapter.mount();
    expect(loadRenderer).toHaveBeenCalledOnce(); expect(renderer.init).toHaveBeenCalledOnce();
  });
  it('never loads the renderer for an unauthorised session', async () => {
    const { adapter, loadRenderer } = setup('rhona', { fetch: vi.fn(async () => new Response('{}', { status: 401 })) });
    await expect(adapter.mount()).rejects.toThrow(); expect(loadRenderer).not.toHaveBeenCalled();
  });
  it('isolates actor and resource storage while preserving one campaign backend ID', async () => {
    const a = setup('rhona'); await a.adapter.mount();
    const b = setup('chad'); await b.adapter.mount();
    expect(a.renderer.destroy).toHaveBeenCalledOnce();
    const ac = vi.mocked(a.renderer.init).mock.calls[0][0], bc = vi.mocked(b.renderer.init).mock.calls[0][0];
    expect(ac.reviewId).toBe(bc.reviewId);
    expect((ac.integration as { storageNamespace: string }).storageNamespace).not.toBe((bc.integration as { storageNamespace: string }).storageNamespace);
    expect(bc.spa).toBe(false);
  });
  it('a superseded delayed import cannot replace the new actor', async () => {
    let resolve!: (value: { createController: () => ReviewRenderer }) => void;
    const old = setup('rhona', { loadRenderer: () => new Promise(r => { resolve = r; }) });
    const pending = old.adapter.mount();
    await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
    const current = setup('chad'); await current.adapter.mount();
    resolve({ createController: () => old.renderer }); await pending;
    expect(old.renderer.init).not.toHaveBeenCalled(); expect(current.renderer.init).toHaveBeenCalledOnce();
  });
  it('removes event listeners and ignores late sync events after stop', async () => {
    const onSync = vi.fn(); const { adapter, renderer } = setup('rhona', { onSync });
    await adapter.mount(); window.dispatchEvent(new CustomEvent('annotate:sync', { detail: { state: 'pending', pending: 1 } }));
    expect(onSync).toHaveBeenCalledOnce(); adapter.stop(); adapter.stop();
    window.dispatchEvent(new CustomEvent('annotate:sync', { detail: { state: 'idle', pending: 0 } }));
    expect(onSync).toHaveBeenCalledOnce(); expect(renderer.destroy).toHaveBeenCalledOnce();
    await expect(adapter.mount()).rejects.toThrow('stopped');
  });
});


describe('immutable lifecycle context', () => {
  it('does not redirect local drafts when a caller later mutates its scope object', async () => {
    const mutable: ReviewAdapterConfig['scope'] = { ...scope };
    const { adapter, renderer } = setup('rhona', { scope: mutable });
    mutable.pagePath = '/other'; mutable.resourceId = 'different-record';
    await adapter.mount();
    const configured = vi.mocked(renderer.init).mock.calls[0][0];
    expect(configured.page).toBe('/');
    expect((configured.integration as any).storageNamespace).not.toContain('different-record');
    expect(adapter.scope.resourceId).toBeNull();
  });
});
