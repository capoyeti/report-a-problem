// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Exercise the actual generated closure through upstream's reserved test point.
const source = readFileSync('src/review/vendor/annotate.mjs', 'utf8');
const instrumented = source.replace('// ANNOTATE TEST INJECTION POINT', `CFG.__test = {
  cssPath, resolveAnchorEl, quoteFromRange, privateRange, createComment, patchComment,
  normalizeComment, readQueue, writeQueue, store, handleResponse, dbRead, dbWrite,
  flushAll, mergeServerPage, fromWire, state, sync, sendOp, remoteEnqueue, openComposer, commitDraft, hasComposerDraft, renderPanel, statusSelect, STATUSES, SYNC_TEXT, UNSAVED_MSG, applyPollAfter, poll
};`).replace(/export \{[^}]+\};/, '').replace('export default Annotate;', 'return createController;');
let controller: any, api: any;
const context = { componentLabel: 'Public component', description: 'Original words', viewport: { vw: 390, vh: 844 }, snapshotAttachmentId: null };
beforeEach(() => {
  // Vitest 2 on Node 25 can inherit Node webstorage instead of DOM Storage.
  Object.defineProperty(window, 'localStorage', { configurable: true, value: new JSDOM('', { url: 'http://localhost/' }).window.localStorage });
  window.localStorage.clear(); document.body.innerHTML = '<section data-review-id="section"><button id="old" data-review-id="button">Public words</button></section><div data-review-private><span id="private">Never capture me</span></div><p id="after">After text</p>';
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) });
  (window as any).CSS = { escape: (v: string) => v.replace(/["\\]/g, '\\$&') };
  controller = new Function('window', instrumented)(window)(window);
  controller.init({ project: 'fixture', page: '/', startOpen: true, integration: {
    storageNamespace: 'actor-full-scope', initialSession: { actor: { id: 'actor', name: 'Tester', role: 'reviewer' } },
  } });
  document.dispatchEvent(new Event('DOMContentLoaded'));
  // The factory controller delegates only public methods. A tiny second source hook
  // exposes test functions on config, leaving the shipped module unchanged.
  api = (controller.config as any).__test;
});
afterEach(() => { controller?.destroy(); vi.useRealTimers(); vi.restoreAllMocks(); });

function record(type = 'pin') {
  return { schema: 2, id: 'cfixture', page: 'fixture:/', url: 'http://localhost/', type, author: 'Tester', authorId: 'actor', text: 'Current words', color: '#f59e0b',
    anchor: type === 'highlight' ? { exact: 'Public words', prefix: '', suffix: '' } : null,
    geom: type === 'pin' ? { kind: 'pin', selector: '[data-review-id="button"]', x: .5, y: .5, vw: 390, vh: 844 } : null,
    replies: [], createdAt: '2026-10-18T10:00:00Z', updatedAt: '2026-10-18T10:00:00Z', originalContext: context };
}
describe('maintained renderer contract', () => {
  it('prefers unique stable identities and refuses duplicates and private ancestry', () => {
    const target = document.querySelector('#old')!;
    expect(api.cssPath(target)).toBe('[data-review-id="button"]');
    target.id = 'changed'; expect(api.resolveAnchorEl('[data-review-id="button"]')).toBe(target);
    document.body.appendChild(target.cloneNode(true));
    expect(api.cssPath(target)).toBeNull(); expect(api.resolveAnchorEl('[data-review-id="button"]')).toBeNull();
    expect(api.cssPath(document.querySelector('#private'))).toBeNull();
    expect(api.resolveAnchorEl('section')).toBe(document.querySelector('section'));
    document.querySelector('section')!.setAttribute('data-review-exclude', '');
    expect(api.resolveAnchorEl('[data-review-id="section"]')).toBeNull();
  });
  it('rejects a range spanning a private descendant, including element boundaries', () => {
    const range = document.createRange(); range.selectNodeContents(document.body);
    expect(api.privateRange(range)).toBe(true); expect(api.quoteFromRange(range)).toBeNull();
    range.selectNodeContents(document.querySelector('button')!);
    expect(api.privateRange(range)).toBe(false); expect(api.quoteFromRange(range).exact).toBe('Public words');
    for (const html of ['<form><p>Form text</p></form>', '<div contenteditable="true">Editable</div>', '<div data-review-exclude>Excluded</div>', '<input type="password" value="secret">']) {
      document.body.insertAdjacentHTML('beforeend', html); range.selectNodeContents(document.body);
      expect(api.quoteFromRange(range)).toBeNull();
    }
  });
  it('preserves immutable context through normalization and later edits', () => {
    for (const type of ['pin', 'highlight', 'note', 'pen', 'shape', 'block']) expect(api.normalizeComment(record(type)).originalContext).toEqual(context);
    const c = record(); api.dbWrite({ comments: [c] });
    const updated = api.patchComment(c.id, { text: 'Edited words', originalContext: { ...context, description: 'Spoof' } });
    expect(updated.text).toBe('Edited words'); expect(updated.originalContext).toEqual(context);
  });
  it('rejects long and blank text without modifying the saved record', () => {
    expect(api.createComment({ type: 'note', text: '' })).toBeNull();
    expect(api.createComment({ type: 'note', text: 'x'.repeat(5001) })).toBeNull();
    const c = record(); api.dbWrite({ comments: [c] });
    for (const changes of [{ text: 'x'.repeat(5001) }, { text: '' }, { reply: { text: 'x'.repeat(5001) } }]) expect(api.patchComment(c.id, changes)).toBeNull();
    expect(api.dbRead().comments[0].text).toBe(c.text);
  });
  it('strips query and hash and preserves original description on new notes', () => {
    window.history.replaceState({}, '', '/?private=value#secret');
    const c = api.createComment({ type: 'note', text: 'New note' });
    expect(c.url).not.toContain('?'); expect(c.url).not.toContain('#'); expect(c.originalContext.description).toBe('New note');
  });
  it('expires each queued operation even if the queue envelope was recently rewritten', () => {
    api.writeQueue([{ t: 'put', id: 'old', key: 'a', createdAt: Date.now() - 8 * 86400000 }, { t: 'put', id: 'new', key: 'b', createdAt: Date.now() }]);
    expect(api.readQueue().map((o: any) => o.id)).toEqual(['new']);
    api.store.set('composer', 'draft');
    const key = 'actor-full-scope:composer'; const saved = JSON.parse(window.localStorage.getItem(key)!); saved.expiresAt = Date.now() - 1; window.localStorage.setItem(key, JSON.stringify(saved));
    expect(api.store.get('composer')).toBeNull();
    window.localStorage.setItem(key, 'legacy queue without TTL'); expect(api.store.get('composer')).toBeNull();
  });
  it('retains held writes across reload, submit and polling without advancing their base', async () => {
    // REMOTE is needed to exercise flushAll. A second controller gets the same test hook.
    controller.destroy();
    controller.init({ project: 'fixture', page: '/', api: 'http://localhost/api', reviewId: 'october', startOpen: true, integration: {
      storageNamespace: 'actor-full-scope', initialSession: { actor: { id: 'actor', name: 'Tester', role: 'reviewer' } }, getSession: async () => null,
    } });
    api = controller.config.__test;
    const c = record(); api.dbWrite({ comments: [c], stamps: { [c.id]: c.updatedAt } });
    const op = { t: 'put', id: c.id, key: 'fixed', f: ['text'], held: true, createdAt: Date.now() };
    api.writeQueue([op]); await expect(api.flushAll()).rejects.toThrow('Compare');
    api.mergeServerPage([{ ...c, page: '/', text: 'Server words', updatedAt: '2026-10-18T12:00:00Z' }]);
    expect(api.dbRead().comments[0].text).toBe('Current words'); expect(api.dbRead().stamps[c.id]).toBe(c.updatedAt);
    expect(api.readQueue()[0].held).toBe(true); expect(api.readQueue()[0].key).toBe('fixed');
  });
  it('freezes the first PUT payload through a lost acknowledgement and later edit', async () => {
    controller.destroy();
    const sent: Array<{ key: string; body: string }> = [];
    controller.init({ project: 'fixture', page: '/', api: 'http://localhost/api', reviewId: 'october', startOpen: true, integration: {
      storageNamespace: 'actor-full-scope', initialSession: { actor: { id: 'actor', name: 'Tester', role: 'reviewer' } }, getSession: async () => null,
      request: async (_url: string, init: any) => { sent.push({ key: init.headers['Idempotency-Key'], body: init.body }); throw new Error('lost acknowledgement'); },
    } }); api = controller.config.__test;
    const c = record(); api.dbWrite({ comments: [c] });
    const op = { t: 'put', id: c.id, key: 'same-operation', f: ['*'], createdAt: Date.now() }; api.writeQueue([op]);
    await expect(api.sendOp(op)).rejects.toThrow('lost acknowledgement');
    const d = api.dbRead(); d.comments[0].text = 'Later local edit'; api.dbWrite(d);
    api.remoteEnqueue({ t: 'put', id: c.id, f: ['text'] });
    const queue = api.readQueue(); expect(queue).toHaveLength(2); expect(queue[1].key).not.toBe(op.key);
    await expect(api.sendOp(queue[0])).rejects.toThrow('lost acknowledgement');
    expect(sent[0]).toEqual(sent[1]); expect(JSON.parse(sent[1].body).text).toBe('Current words');
    expect(api.dbRead().comments[0].text).toBe('Later local edit');
    expect(api.patchComment(c.id, { editReply: { id: 'r', text: 'Unsupported reply edit' } })).toBeNull();
  });
  it('scopes discussion wording and preserves the nonintegrated labels', () => {
    const c = record(); api.state.comments = [c]; api.renderPanel();
    expect(document.querySelector('.an-cact')!.textContent).toContain('Resolve discussion');
    expect(document.querySelector('#__an_panel')!.textContent).toContain('Closing a discussion does not verify a fix.');
    expect(api.statusSelect(c).getAttribute('aria-label')).toBe('Discussion status');
    expect(Array.from(api.statusSelect(c).options).map((o: any) => o.text)).toEqual(['Open discussion', 'Discussion in progress', 'Discussion closed', 'Discussion declined']);
    expect(api.SYNC_TEXT.error).toMatch(/^Could not share/); expect(api.UNSAVED_MSG).toContain('Keep this page open'); expect(api.UNSAVED_MSG).not.toContain('JSON');
    c.resolved = true; c.status = 'resolved'; api.state.filter = 'all'; api.renderPanel();
    expect(document.querySelector('.an-cact')!.textContent).toContain('Reopen discussion');
    expect(document.querySelector('.an-rbadge')!.textContent).toBe('Discussion closed');
    controller.destroy(); controller.init({ project: 'fixture', page: '/', startOpen: true }); api = controller.config.__test;
    expect(api.STATUSES).toEqual({ open: 'Open', in_progress: 'In progress', resolved: 'Resolved', wont_fix: 'Won’t fix' });
    expect(api.statusSelect(c).getAttribute('aria-label')).toBe('Status'); expect(api.UNSAVED_MSG).toContain('JSON');
    expect(api.SYNC_TEXT.error).toContain('Not signed in');
  });
  it('offers Resume only for a kept composer draft and clears it after a nonnull commit while retaining queued words', () => {
    controller.destroy(); controller.init({ project: 'fixture', page: '/', api: 'http://localhost/api', reviewId: 'october', startOpen: true, integration: {
      storageNamespace: 'actor-full-scope', initialSession: { actor: { id: 'actor', name: 'Tester', role: 'reviewer' } }, getSession: async () => null,
    } }); api = controller.config.__test;
    const resume = document.querySelector('#__an_resume') as HTMLButtonElement;
    expect(resume.hidden).toBe(true);
    const draft = { type: 'note', text: '' }; api.openComposer(10, 10, draft);
    const ta = document.querySelector('#__an_compose textarea') as HTMLTextAreaElement;
    ta.value = 'Words that must survive'; ta.dispatchEvent(new Event('input'));
    expect(resume.hidden).toBe(false); expect(api.hasComposerDraft()).toBe(true);
    api.commitDraft(draft); // The blank description is rejected without clearing typed recovery.
    expect(api.hasComposerDraft()).toBe(true); expect(JSON.parse(api.store.get('composer')).text).toBe('Words that must survive');
    expect(ta.value).toBe('Words that must survive'); expect(api.readQueue()).toHaveLength(0);
    draft.text = ta.value; api.commitDraft(draft);
    expect(api.store.get('composer')).toBe('null'); expect(api.hasComposerDraft()).toBe(false); expect(resume.hidden).toBe(true);
    const queued = api.readQueue(); expect(queued).toHaveLength(1);
    expect(api.dbRead().comments.find((c: any) => c.id === queued[0].id).text).toBe('Words that must survive');
    controller.destroy(); expect(api.store.get('composer')).toBe('null'); // Teardown cannot resurrect a posted draft.
  });
  it('reconciles a reply replay 410 without tombstoning its live parent or discarding other work', async () => {
    controller.destroy();
    const oldReply = { id: 'reply-deleted', author: 'Tester', authorId: 'actor', text: 'Kept deleted reply words', createdAt: '2026-10-18T10:01:00Z', editedAt: null };
    const laterReply = { ...oldReply, id: 'reply-pending', text: 'A different pending reply' };
    const current = { ...record(), page: '/', text: 'Server parent', replies: [] };
    const requests: string[] = [];
    controller.init({ project: 'fixture', page: '/', api: 'http://localhost/api', reviewId: 'october', startOpen: true, integration: {
      storageNamespace: 'actor-full-scope', initialSession: { actor: { id: 'actor', name: 'Tester', role: 'reviewer' } }, getSession: async () => null,
      request: async (_url: string, init: any) => {
        requests.push(init.method);
        if (init.method === 'POST') { current.replies.push(JSON.parse(init.body) as never); throw new Error('reply committed but acknowledgement lost'); }
        return new Response(JSON.stringify({ comments: [current] }), { status: 200 });
      },
    } }); api = controller.config.__test; api.sync.inflight = {};
    const local = { ...record(), text: 'Other pending parent edit', replies: [oldReply, laterReply] };
    api.dbWrite({ comments: [local], stamps: { [local.id]: local.updatedAt } });
    const gone = { t: 'reply', id: local.id, key: 'reply-operation', r: oldReply, createdAt: Date.now() };
    const otherPut = { t: 'put', id: local.id, key: 'later-edit', f: ['text'], createdAt: Date.now() };
    const otherReply = { t: 'reply', id: local.id, key: 'later-reply', r: laterReply, createdAt: Date.now() };
    api.writeQueue([gone, otherPut, otherReply]);
    await expect(api.sendOp(gone)).rejects.toThrow('acknowledgement lost');
    current.replies = []; current.updatedAt = '2026-10-18T12:00:00Z'; // The reply is deleted in another tab.
    await api.handleResponse(gone, { res: { status: 410 }, data: {} });
    expect(requests).toEqual(['POST', 'GET']); expect(api.readQueue()).toEqual([otherPut, otherReply]);
    expect(api.dbRead().comments).toHaveLength(1); expect(api.dbRead().comments[0].text).toBe(local.text);
    expect(api.dbRead().comments[0].replies.map((r: any) => r.id)).toEqual([laterReply.id]);
    expect(api.dbRead().stamps[local.id]).toBe(local.updatedAt); // A reread cannot silently rebase the pending edit.
    expect(api.store.get('tombstones')).toBeNull(); expect(api.fromWire(current)).not.toBeNull();
    expect(api.fromWire({ ...current, replies: [oldReply] }).replies).toEqual([]);
    expect(JSON.parse(api.store.get('deleted-reply-drafts'))[0].text).toBe(oldReply.text);
    expect(api.sync.held).toBe(false); api.state.comments = api.dbRead().comments; api.renderPanel();
    expect(document.querySelector('[aria-label="Deleted reply recovery"]')!.textContent).toContain(oldReply.text);
    (Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Discard kept reply words') as HTMLButtonElement).click();
    expect(JSON.parse(api.store.get('deleted-reply-drafts'))).toEqual([]); expect(api.readQueue()).toEqual([otherPut, otherReply]);
  });
  it('holds an ambiguous reply 410 on reread failure and tombstones the parent only after authoritative absence', async () => {
    controller.destroy(); let available = false;
    controller.init({ project: 'fixture', page: '/', api: 'http://localhost/api', reviewId: 'october', startOpen: true, integration: {
      storageNamespace: 'actor-full-scope', initialSession: { actor: { id: 'actor', name: 'Tester', role: 'reviewer' } }, getSession: async () => null,
      request: async () => new Response(JSON.stringify(available ? { comments: [] } : {}), { status: available ? 200 : 503 }),
    } }); api = controller.config.__test; api.sync.inflight = {};
    const c = record(); api.dbWrite({ comments: [c] });
    const op = { t: 'reply', id: c.id, key: 'reply-key', r: { id: 'r', text: 'Keep these words' }, createdAt: Date.now() };
    api.writeQueue([op]); await api.handleResponse(op, { res: { status: 410 }, data: {} });
    expect(api.readQueue()[0]).toMatchObject({ key: op.key, held: true, replyGone: true }); expect(api.dbRead().comments).toHaveLength(1);
    expect(api.store.get('tombstones')).toBeNull(); expect(api.sync.held).toBe(true);
    available = true; await api.handleResponse(api.readQueue()[0], { res: { status: 410 }, data: {} });
    expect(api.readQueue()).toEqual([]); expect(api.dbRead().comments).toEqual([]); expect(api.fromWire({ ...c, page: '/' })).toBeNull();
  });
  it('honors successful polling hints without accelerating the five-second baseline', async () => {
    controller.destroy(); vi.useFakeTimers(); vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    let hint: string | null = '15000'; let requests = 0;
    controller.init({ project: 'fixture', page: '/', api: 'http://localhost/api', reviewId: 'october', pollInterval: 5000, startOpen: true, integration: {
      storageNamespace: 'actor-full-scope', initialSession: { actor: { id: 'actor', name: 'Tester', role: 'reviewer' } }, getSession: async () => null,
      request: async () => { requests++; return new Response(JSON.stringify({ comments: [] }), { status: 200, headers: hint ? { 'X-Review-Poll-After': hint } : {} }); },
    } }); api = controller.config.__test; api.sync.token = 'fixture'; api.poll();
    await vi.advanceTimersByTimeAsync(0); expect(requests).toBe(1); expect(api.sync.pollAfter).toBe(15000);
    await vi.advanceTimersByTimeAsync(14999); expect(requests).toBe(1);
    hint = '5000'; await vi.advanceTimersByTimeAsync(1); expect(requests).toBe(2); expect(api.sync.pollAfter).toBe(5000);
    hint = '1'; await vi.advanceTimersByTimeAsync(5000); expect(requests).toBe(3); expect(api.sync.pollAfter).toBe(5000);
    hint = null; await vi.advanceTimersByTimeAsync(5000); expect(requests).toBe(4); expect(api.sync.pollAfter).toBe(5000);
    api.applyPollAfter(new Response(null, { status: 304, headers: { 'X-Review-Poll-After': '20000' } })); expect(api.sync.pollAfter).toBe(20000);
    api.applyPollAfter(new Response(null, { status: 304, headers: { 'X-Review-Poll-After': 'invalid' } })); expect(api.sync.pollAfter).toBe(5000);
    controller.destroy(); vi.useRealTimers();
  });
  it('keeps tap selection active when native scrolling cancels a pointer', () => {
    controller.setTool('pin');
    document.dispatchEvent(new Event('pointercancel', { bubbles: true }));
    expect(document.body.classList.contains('an-review-selecting')).toBe(true);
    controller.setTool('cursor');
    expect(document.body.classList.contains('an-review-selecting')).toBe(false);
  });
  it('does not resurrect a cached tombstone from a stale server response', () => {
    api.store.set('tombstones', JSON.stringify({ cfixture: true }));
    expect(api.fromWire({ ...record(), page: '/' })).toBeNull();
  });
});
