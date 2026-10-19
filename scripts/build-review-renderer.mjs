import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const source = readFileSync(path.join(root, 'vendor/reviewjs/annotate.mjs'), 'utf8');
const expected = '05b9e4a546626810b7e04da1d466b1ba03feb0d685fd6427eea95805653999da';
if (createHash('sha256').update(source).digest('hex') !== expected) throw new Error('ReviewJS source drift: review the pinned upstream before rebuilding');
let code = source;
function patch(before, after) {
  if (code.split(before).length !== 2) throw new Error(`ReviewJS patch anchor drift: ${before.slice(0, 90)}`);
  code = code.replace(before, after);
}
patch('  var globalConfig = config || window.AnnotateConfig || {};',
  '  var globalConfig = config || window.AnnotateConfig || {};');
patch('  var explicitPage = scriptData.page || globalConfig.page || "";',
  '  var integration = globalConfig.integration || null;\n  var explicitPage = scriptData.page || globalConfig.page || "";');
patch('return localStorage.getItem(k);', 'return window.localStorage.getItem(integration ? integration.storageNamespace + ":" + k : k);');
patch('localStorage.setItem(k, v);', 'window.localStorage.setItem(integration ? integration.storageNamespace + ":" + k : k, v);');
patch('      if (e.key === STORE_KEY) backgroundLoad();\n      else if (REMOTE && e.key === QUEUE_KEY) syncChanged();',
  '      var changedKey = e.key;\n      if (integration) { var prefix = integration.storageNamespace + ":"; if (!changedKey || changedKey.indexOf(prefix) !== 0) return; changedKey = changedKey.slice(prefix.length); }\n      if (changedKey === STORE_KEY) backgroundLoad();\n      else if (REMOTE && changedKey === QUEUE_KEY) syncChanged();');
patch('    author: store.get("an-author") || "",', '    author: integration ? integration.initialSession.actor.name : store.get("an-author") || "",');
patch('    authorId: null,', '    authorId: integration ? integration.initialSession.actor.id : null,');
patch('  function isMine(c) {', '  function isMine(c) {\n    if (integration) return !!state.authorId && c.authorId === state.authorId;');
patch('  function canDelete(c) { return !REMOTE || isMine(c) || isReviewAuthor(); }',
  '  function isReadOnly() { return !!integration && (sync.reviewer ? sync.reviewer.role : integration.initialSession.actor.role) === "viewer"; }\n  function canDelete(c) { return !isReadOnly() && (!REMOTE || isMine(c) || isReviewAuthor()); }');
patch('  function isReviewAuthor() { return REMOTE && !!sync.reviewer && sync.reviewer.role === "author"; }',
  '  function isReviewAuthor() { return REMOTE && !!sync.reviewer && (sync.reviewer.role === "author" || sync.reviewer.role === "lead"); }');
patch('  function createComment(draft) {',
  '  function createComment(draft) {\n    if (isReadOnly()) { toast("This review is read only."); return null; }');
patch('    c = normalizeComment(serialize(c));', `    if (integration) {
      if (isReadOnly()) return null;
      var editingWords = changes.text !== undefined || changes.color !== undefined || changes.anchor !== undefined || changes.geom !== undefined;
      if (editingWords && !isMine(c)) return null;
      if ((changes.status !== undefined || changes.resolved !== undefined) && !isMine(c) && !isReviewAuthor()) return null;
      if (changes.assignee !== undefined && !isReviewAuthor()) return null;
      var replyId = changes.deleteReply || (changes.editReply && changes.editReply.id);
      if (replyId && !c.replies.some(function (r) { return r.id === replyId && isMine(r); })) return null;
    }
    c = normalizeComment(serialize(c));`);
patch('    baselined: {},', '    baselined: {}, loaded: false, conflict: false,');
patch('    var s = sync.held ? "error" : sync.offline ? "offline" : pending ? "pending" : "idle";',
  '    var s = sync.conflict ? "conflict" : sync.held ? "error" : sync.offline ? "offline" : pending ? "pending" : integration && !sync.loaded ? "loading" : "idle";');
patch('  var SYNC_TEXT = {', '  var SYNC_TEXT = {\n    loading: "Loading shared comments...",\n    conflict: "Someone changed this comment. Your draft is kept on this device for comparison.",');
patch('    idle: "Sent to the review. The author sees your comments as you post them; there is nothing to submit.",',
  '    idle: "Shared with the review team.",');
patch('return window.fetch(API_BASE + path, {', 'return (integration ? integration.request : window.fetch.bind(window))(API_BASE + path, {');
patch('  function captureInvite() {', '  function captureInvite() {\n    if (integration) return;');
patch('    if (authHook) {\n      p = Promise.resolve()', `    if (integration) {
      p = Promise.resolve().then(function () { return integration.getSession(!!force); }).then(function (session) {
        if (destroyed || !session) return null;
        acceptSession({ token: session.token, expiresAt: session.expiresAt,
          reviewer: { id: session.actor.id, name: session.actor.name, role: session.actor.role } });
        return sync.token;
      });
    } else if (authHook) {
      p = Promise.resolve()`);
patch('  function acceptSession(data) {', '  function acceptSession(data) {\n    if (destroyed) return;');
patch('    dispatch("annotate:auth", { reviewer: sync.reviewer });',
  '    if (integration) ensureHost().classList.toggle("an-readonly", isReadOnly());\n    dispatch("annotate:auth", { reviewer: sync.reviewer });');
patch('        role: data.reviewer.role === "author" ? "author" : "reviewer" };',
  '        role: integration ? data.reviewer.role : data.reviewer.role === "author" ? "author" : "reviewer" };');
patch('  function goLocal() {', '  function goLocal() {\n    if (integration) { sync.held = true; syncChanged(); return; }');
patch('    if (status === 409 && data.comment) {', `    if (integration && status === 409) {
      sync.held = true; sync.conflict = true; syncChanged();
      settleWaiters(new Error("A newer comment needs your review. Your draft is kept here."));
      dispatch("annotate:conflict", { id: op.id });
      return;
    }
    if (integration && !res.ok && status !== 410) {
      sync.held = true; syncChanged();
      settleWaiters(new Error("Could not share this change. Your draft is kept here."));
      return;
    }
    if (status === 409 && data.comment) {`);
patch('        if (status !== 200 || !r.data || !Array.isArray(r.data.comments)) return;',
  '        if (status !== 200 || !r.data || !Array.isArray(r.data.comments)) { if (integration) { sync.offline = true; syncChanged(); } return; }\n        sync.loaded = true;');
patch('  function askName(onDone) {', '  function askName(onDone) {\n    if (integration) { toast("Your name comes from your signed-in account."); return; }');
patch('  function pickImportFile() {', '  function pickImportFile() {\n    if (integration) return;');
patch('      el("button", { class: "an-hbtn", html: ICONS.upload, title: "Import comments from a JSON file",',
  '      integration ? null : el("button", { class: "an-hbtn", html: ICONS.upload, title: "Import comments from a JSON file",');
patch('      el("button", { class: "an-hbtn", html: ICONS.download, title: "Download comments as JSON",',
  '      integration ? null : el("button", { class: "an-hbtn", html: ICONS.download, title: "Download comments as JSON",');
patch('    if (REMOTE) footEl.appendChild(el("div", { class: "an-exportlbl", text: "Keep a copy" }));',
  '    if (integration) return;\n    if (REMOTE) footEl.appendChild(el("div", { class: "an-exportlbl", text: "Keep a copy" }));');
// Renderer behavior stays here, applied to the pinned source with fail-closed anchors.
function replaceSection(start, end, replacement) {
  const a = code.indexOf(start), b = code.indexOf(end, a + start.length);
  if (a < 0 || b < 0 || code.indexOf(start, a + 1) >= 0) throw new Error('Renderer section drift: ' + start);
  patch(code.slice(a, b), replacement);
}
patch('  function cssPath(node) {', `  var PRIVATE_TARGET = '[data-review-private],[data-review-exclude],form,input,textarea,select,option,[contenteditable]:not([contenteditable="false"])';
  function privateTarget(node) {
    var n = node && (node.nodeType === 1 ? node : node.parentElement);
    return !n || !!n.closest(PRIVATE_TARGET);
  }
  function safeTarget(node) {
    return node && !isOurs(node) && !privateTarget(node) && !node.querySelector(PRIVATE_TARGET);
  }
  function privateRange(range) {
    if (privateTarget(range.startContainer) || privateTarget(range.endContainer)) return true;
    return Array.prototype.some.call(document.querySelectorAll(PRIVATE_TARGET), function (n) {
      return !isOurs(n) && range.intersectsNode(n);
    });
  }
  function componentLabel(node) {
    return String(node && (node.getAttribute('data-review-label') || node.getAttribute('aria-label') || node.getAttribute('data-review-id') || node.nodeName.toLowerCase()) || 'Page note').trim().slice(0, 200) || 'Page note';
  }
  function originalContext(draft) {
    var node = draft.geom && resolveAnchorEl(draft.geom.selector);
    return { componentLabel: draft.componentLabel || componentLabel(node), description: draft.text,
      viewport: { vw: window.innerWidth, vh: window.innerHeight }, snapshotAttachmentId: null };
  }
  function normalizeOriginalContext(c) {
    if (!c || typeof c.componentLabel !== 'string' || !c.componentLabel.trim() || c.componentLabel.length > 200 ||
        typeof c.description !== 'string' || !c.description.trim() || c.description.length > 5000 ||
        !c.viewport || !(c.viewport.vw > 0) || !(c.viewport.vh > 0)) return null;
    return { componentLabel: c.componentLabel, description: c.description,
      viewport: { vw: c.viewport.vw, vh: c.viewport.vh }, snapshotAttachmentId: c.snapshotAttachmentId || null };
  }
  function cssPath(node) {
    if (integration) {
      if (!safeTarget(node)) return null;
      var stable = node.getAttribute('data-review-id');
      if (stable) {
        var selector = '[data-review-id="' + CSS.escape(stable) + '"]';
        return document.querySelectorAll(selector).length === 1 ? selector : null;
      }
    }`);
replaceSection('  function resolveAnchorEl(selector) {', '\n  // Trap Tab focus', `  function resolveAnchorEl(selector) {
    try {
      var nodes = document.querySelectorAll(selector);
      return nodes.length === 1 && (!integration || safeTarget(nodes[0])) ? nodes[0] : null;
    } catch (e) { return null; }
  }
`);
patch('      geom: normalizeGeom(c.geom),', '      geom: normalizeGeom(c.geom),\n      originalContext: normalizeOriginalContext(c.originalContext),');
patch('      url: location.href,\n      type: draft.type', '      url: integration ? location.origin + location.pathname : location.href,\n      type: draft.type');
patch('      geom: draft.geom || null,', '      geom: draft.geom || null,\n      originalContext: integration ? originalContext(draft) : null,');
patch('    if (isReadOnly()) { toast("This review is read only."); return null; }', `    if (isReadOnly()) { toast("This review is read only."); return null; }
    if (integration && (!String(draft.text || '').trim() || String(draft.text).length > MAX_COMMENT_TEXT)) {
      toast('Write a description of 1 to 5,000 characters before sharing.', { kind: 'error' }); return null;
    }
    if (integration && draft.anchor && (!rangeFromQuote(draft.anchor) || resolveHighlightAnchor(draft.anchor).status !== 'ok')) {
      toast('The selected text is private, ambiguous or unavailable. Select public text again.', { kind: 'error' }); return null;
    }
    if (integration && draft.geom && (!resolveAnchorEl(draft.geom.selector) || (draft.geom.points && draft.geom.points.length > 2000))) {
      toast('This target is private, ambiguous or unavailable, or the drawing is too long. Choose another target.', { kind: 'error' }); return null;
    }`);
patch('  function patchComment(id, changes) {', `  function patchComment(id, changes) {
    if (integration) {
      var words = changes.reply ? changes.reply.text : changes.editReply ? changes.editReply.text : changes.text;
      if (words !== undefined && (typeof words !== 'string' || !words.trim() || words.length > 5000)) {
        toast('Use 1 to 5,000 characters. Your draft is kept.', { kind: 'error' }); return null;
      }
    }`);
patch('        if (isOurs(n.parentNode)) return NodeFilter.FILTER_REJECT;', '        if (isOurs(n.parentNode) || integration && privateTarget(n)) return NodeFilter.FILTER_REJECT;');
patch('  function quoteFromRange(range) {', '  function quoteFromRange(range) {\n    if (integration && privateRange(range)) return null;');
patch('    return r;\n  }\n  function locate(map, globalOff)', '    return integration && privateRange(r) ? null : r;\n  }\n  function locate(map, globalOff)');
patch('  function paintRange(range, color, id) {', '  function paintRange(range, color, id) {\n    if (integration && privateRange(range)) return [];');
patch('  function renderMissingAnchor(c, missingSlot) {', '  function renderMissingAnchor(c, missingSlot) {\n    if (integration) return;');
patch('  function unanchoredPill(c, slot) {', '  function unanchoredPill(c, slot) {\n    if (integration) return;');
patch('    if (!anchorVisible(anchorEl)) return;\n    var box = docBox(anchorEl);\n    rememberAnchor(c, box);\n    var g = c.geom;', `    if (!anchorVisible(anchorEl) || integration && viewportMismatch(c.geom)) { c.__anchorMissing = true; return; }
    var box = docBox(anchorEl);
    rememberAnchor(c, box);
    var g = c.geom;`);
patch('    if (!anchorEl && c.geom.selector !== "body")', '    if ((!anchorEl || integration && !anchorVisible(anchorEl)) && (integration || c.geom.selector !== "body"))');
patch('    if (!anchorVisible(anchorEl)) return;\n    var box = docBox(anchorEl);\n    rememberAnchor(c, box);\n    var idx = state.comments.indexOf(c) + 1;\n    var tab', '    if (!anchorVisible(anchorEl)) { c.__anchorMissing = true; return; }\n    c.__anchorMissing = false;\n    var box = docBox(anchorEl);\n    rememberAnchor(c, box);\n    var idx = state.comments.indexOf(c) + 1;\n    var tab');
patch('        if (r) {\n          var marks = paintRange', '        if (!r) c.__unanchored = "unavailable";\n        if (r) {\n          var marks = paintRange');
patch('      card.appendChild(meta);', `      card.appendChild(meta);
      if (integration) {
        var context = c.originalContext;
        var unavailable = c.__anchorMissing || c.__unanchored;
        if (unavailable) card.appendChild(el('p', { class: 'an-context', role: 'status', text: 'Anchor unavailable. The original target is missing, hidden, private, ambiguous or from an earlier layout.' }));
        if (context) {
          var original = el('details', { class: 'an-context an-original-context' });
          original.appendChild(el('summary', { text: 'Original target: ' + context.componentLabel + ' (' + context.viewport.vw + ' × ' + context.viewport.vh + ')' }));
          original.appendChild(el('p', { text: 'Original description: ' + context.description }));
          listen(original, 'click', function (e) { e.stopPropagation(); });
          card.appendChild(original);
        }
        if (c.type === 'pen') card.appendChild(el('p', { class: 'an-context', text: 'Original description only. No snapshot was saved.' }));
        decorateConflict(c, card);
      }`);
patch('      card.appendChild(hbox);', `      card.appendChild(hbox);
      if (integration && typeof integration.decorateThread === 'function') {
        var cleanup = integration.decorateThread(serialize(c), card);
        if (typeof cleanup === 'function') threadCleanups.push(cleanup);
      }`);
patch('  function renderPanel() {', `  var threadCleanups = [];
  function cleanThreads() { threadCleanups.splice(0).forEach(function (fn) { try { fn(); } catch (e) {} }); }
  function renderPanel() {
    cleanThreads();`);
patch('      destroyed = true;', `      if (integration) { saveComposerDraft(); cleanThreads(); if (typeof integration.teardown === 'function') integration.teardown(); }
      destroyed = true;`);
patch('      characterData: true, attributes: true, attributeFilter: ["class", "style", "hidden", "open"]', '      characterData: true, attributes: true, attributeFilter: ["class", "style", "hidden", "open", "data-review-id", "data-review-private", "data-review-exclude", "contenteditable"]');
// Layout refresh must update the thread explanation as well as the overlay.
patch('    ensureHost(); renderAll();', '    ensureHost(); renderAll(); if (integration) renderPanel();');
patch('rt = setTimeout(renderAll, 150);', 'rt = setTimeout(function () { renderAll(); if (integration) renderPanel(); }, 150);');
// Full key isolation is supplied by the adapter. Each local value has a fixed TTL.
patch('  var store = {', `  function expiredDraftWork(key, raw) {
    var value; try { value = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { return false; }
    function words(text) { return typeof text === 'string' && !!text.trim(); }
    if (key === 'composer') return !!(value && value.draft && (words(value.text) || words(value.draft.text) || value.draft.geom || value.draft.anchor));
    if (key === 'thread-drafts') return !!(value && typeof value === 'object' && Object.keys(value).some(function (id) {
      var draft = value[id]; return draft && (draft.reply && words(draft.reply.value) || draft.edit && words(draft.edit.value));
    }));
    if (key === 'deleted-drafts' || key === 'deleted-reply-drafts') return Array.isArray(value) && value.some(function (draft) {
      return draft && (words(draft.text) || Array.isArray(draft.replies) && draft.replies.some(function (reply) { return reply && words(reply.text); }));
    });
    if (key.indexOf('annotate:queue:') === 0) return Array.isArray(value) && value.some(function (op) {
      return op && ['put', 'del', 'reply', 'unreply'].indexOf(op.t) >= 0 && typeof op.id === 'string' && typeof op.key === 'string';
    });
    return false;
  }
  var store = {`);

patch('return window.localStorage.getItem(integration ? integration.storageNamespace + ":" + k : k);', `var fullKey = integration ? integration.storageNamespace + ':' + k : k;
      var raw = window.localStorage.getItem(fullKey);
      if (!integration || raw === null) return raw;
      var saved; try { saved = JSON.parse(raw); } catch (e) {}
      if (!saved || saved.reviewDraft !== 1 || !Number.isFinite(saved.expiresAt) || Date.now() >= saved.expiresAt) {
        try { window.localStorage.removeItem(fullKey); } catch (e) {}
        if (expiredDraftWork(k, saved && saved.reviewDraft === 1 ? saved.value : raw)) expiryNotice();
        return null;
      }
      return saved.value;`);
patch('window.localStorage.setItem(integration ? integration.storageNamespace + ":" + k : k, v);', `window.localStorage.setItem(integration ? integration.storageNamespace + ':' + k : k,
        integration ? JSON.stringify({ reviewDraft: 1, expiresAt: Date.now() + 7 * 86400000, value: v }) : v);`);
patch('  var UNSAVED_MSG =', `  var expiryShown = false;
  function expiryNotice() {
    if (expiryShown) return; expiryShown = true;
    setTimeout(function () { ensureHost().appendChild(el('p', { id: '__an_expiry', role: 'alert', text: 'A saved draft expired after seven days or has an older format. It will not be shared. Start a new comment.' })); }, 0);
  }
  var UNSAVED_MSG =`);
patch('    op.key = idemKey();', '    op.key = idemKey(); if (integration) op.createdAt = Date.now();');
patch('key: idemKey(), nb: Date.now() + (holdMs || 0)', 'key: idemKey(), createdAt: Date.now(), nb: Date.now() + (holdMs || 0)');
patch('      return o && OP_TYPES[o.t] === 1', `      if (integration && o && OP_TYPES[o.t] === 1 && typeof o.id === 'string' && typeof o.key === 'string' && (!o.createdAt || Date.now() - o.createdAt > 7 * 86400000)) { expiryNotice(); return false; }
      return o && OP_TYPES[o.t] === 1`);
// A held operation persists through reload, refresh, submit and edits.
patch('    sync.held = false;\n    return new Promise', `    if (integration && (sync.held || readQueue().some(function (o) { return o.held; }))) return Promise.reject(new Error('Compare the saved draft before retrying.'));
    sync.held = false;
    return new Promise`);
patch('    if (!REMOTE || destroyed || sync.inflight || sync.held) return;', '    if (!REMOTE || destroyed || sync.inflight || sync.held || integration && readQueue().some(function (o) { return o.held; })) return;');
patch('    var s = sync.conflict ?', '    if (integration && readQueue().some(function (o) { return o.held; })) sync.held = true;\n    var s = sync.conflict ?');
patch('      sync.held = true; sync.conflict = true; syncChanged();', `      markOp(op, { held: true, conflict: true });
      sync.held = true; sync.conflict = true; syncChanged();
      renderPanel();`);
patch('      sync.held = true; syncChanged();\n      settleWaiters(new Error("Could not share this change. Your draft is kept here."));', `      markOp(op, { held: true });
      sync.held = true; syncChanged(); renderPanel();
      settleWaiters(new Error("Could not share this change. Your draft is kept here."));`);
// Polling may observe newer stamps, but cannot change the base of a queued write.
patch('      stamps[c.id] = w.updatedAt;', '      if (!integration || !pending[c.id]) stamps[c.id] = w.updatedAt;');
patch('  function flushAll() {', `  function decorateConflict(c, card) {
    var held = readQueue().filter(function (o) { return o.id === c.id && o.held; });
    if (!held.length) return;
    var box = el('section', { class: 'an-conflict', 'aria-label': 'Compare saved draft' });
    box.appendChild(el('p', { text: 'Could not share. Your local draft is kept. Reload the current shared version to compare before deciding.' }));
    var local = el('p', { text: 'Your draft: ' + c.text + (c.replies.length ? ' Replies: ' + c.replies.map(function (r) { return r.text; }).join('; ') : '') });
    box.appendChild(local);
    var reload = el('button', { class: 'an-ghost', text: 'Compare / reload shared version' });
    box.appendChild(reload);
    listen(reload, 'click', function (e) {
      e.stopPropagation(); reload.disabled = true;
      apiFetch('GET', '/comments?page=' + encodeURIComponent(wirePage(PAGE))).then(function (r) {
        reload.disabled = false;
        if (!r.res.ok || !r.data || !Array.isArray(r.data.comments)) { toast('Could not load the current version. Your draft is kept.'); return; }
        var current = r.data.comments.find(function (w) { return w.id === c.id; });
        box.querySelectorAll('.an-current,.an-decision').forEach(function (n) { n.remove(); });
        box.appendChild(el('p', { class: 'an-current', text: current ? 'Current shared text: ' + current.text + ' Replies: ' + current.replies.map(function (v) { return v.text; }).join('; ') : 'This comment is no longer available on the server.' }));
        var discard = el('button', { class: 'an-ghost an-decision', text: 'Discard my local change' });
        box.appendChild(discard);
        listen(discard, 'click', function (ev) {
          ev.stopPropagation(); dropOps(function (o) { return o.id === c.id; });
          if (current) applyServer(current, null); else forgetRecord(c.id);
          releaseHold(); loadData();
        });
        if (current) {
          var retry = el('button', { class: 'an-primary an-decision', text: 'Retry my change against this version' });
          box.appendChild(retry);
          listen(retry, 'click', function (ev) {
            ev.stopPropagation(); var d = dbRead(); serverStamps(d)[c.id] = current.updatedAt; dbWrite(d);
            writeQueue(readQueue().map(function (o) { return o.id === c.id ? Object.assign({}, o, { held: false, conflict: false, key: idemKey() }) : o; }));
            releaseHold(); scheduleFlush(0); renderPanel();
          });
        }
      }, function () { reload.disabled = false; toast('Could not load the current version. Your draft is kept.'); });
    });
    card.appendChild(box);
  }
  function releaseHold() {
    sync.held = readQueue().some(function (o) { return o.held; });
    sync.conflict = readQueue().some(function (o) { return o.conflict; }); syncChanged();
  }
  function flushAll() {`);
// Tombstones are also cached locally to prevent stale reads restoring a deleted mark.
patch('  function forgetRecord(id) {', `  function forgetRecord(id) {
    if (integration) { var tombs = JSON.parse(store.get('tombstones') || '{}'); tombs[id] = true; store.set('tombstones', JSON.stringify(tombs)); }`);
patch('  function fromWire(w) {', `  function fromWire(w) {
    if (integration && JSON.parse(store.get('tombstones') || '{}')[w && w.id]) return null;`);

const integrationStyles = readFileSync(path.join(root, 'src/review/integration.css'), 'utf8');
patch('  var ICONS = {', `  if (integration) CSS_TEXT += ${JSON.stringify(integrationStyles)};\n  var ICONS = {`);
patch('  function setTool(t) {', '  function setTool(t) {\n    if (isReadOnly()) t = "cursor";');
patch('  function onDown(e) {', '  function onDown(e) {\n    if (isReadOnly()) return;');
patch('    if (t === "pin") {\n      var anchorEl',
  '    if (t === "pin") {\n      if (integration) { e.preventDefault(); e.stopPropagation(); }\n      var anchorEl');
patch('  listen(document, "pointerdown", onDown, true);', `  listen(document, "pointerdown", onDown, true);
  listen(document, "click", function (e) {
    if (integration && state.enabled && state.tool !== "cursor" && !isOurs(e.target)) {
      e.preventDefault(); e.stopImmediatePropagation();
    }
  }, true);`);
patch('        el("button", { class: "an-mini", html: (c.resolved ? "" : ICONS.check)',
  '        (!integration || !isReadOnly() && (isMine(c) || isReviewAuthor())) ? el("button", { class: "an-mini", html: (c.resolved ? "" : ICONS.check)');
patch('        !REMOTE || isReviewAuthor() ? statusSelect(c) : null,',
  '        !REMOTE || isReviewAuthor() ? statusSelect(c) : null,');
patch('        } }),\n        !REMOTE || isReviewAuthor() ? statusSelect(c) : null,',
  '        } }) : null,\n        !REMOTE || isReviewAuthor() ? statusSelect(c) : null,');
patch('    import: function () { pickImportFile(); },',
  '    import: function () { if (!integration) pickImportFile(); },');
patch('      if (REMOTE) { sync.held = false; sync.etag = "";',
  '      if (REMOTE) { if (!integration) sync.held = false; sync.etag = "";');
// Target selection is a tap-up operation. Pointerdown never turns a swipe into a pin.
replaceSection('  function onDown(e) {', '  function onMove(e) {', `  var tapStart = null, targetChoice = null, targetBox = null, targetOutline = null, focusBeforeDraft = null;
  function cancelDrawing() {
    if (drawing && drawing.node && drawing.node.parentNode) drawing.node.remove();
    drawing = null; tapStart = null; clearTemp();
  }
  function clearTarget() {
    targetChoice = null;
    if (targetBox) targetBox.remove(); if (targetOutline) targetOutline.remove();
    targetBox = targetOutline = null;
  }
  function positionTarget() {
    if (!targetChoice || !targetOutline) return;
    var r = targetChoice.getBoundingClientRect();
    Object.assign(targetOutline.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
  }
  function chooseTarget(node) {
    if (!safeTarget(node) || !cssPath(node) || !anchorVisible(node)) { toast('This target is private, ambiguous or unavailable. Choose another element.'); return; }
    clearTarget(); targetChoice = node; focusBeforeDraft = node;
    targetOutline = el('div', { id: '__an_targetoutline', 'aria-hidden': 'true' });
    targetBox = el('section', { id: '__an_target', role: 'dialog', 'aria-label': 'Confirm review target' });
    targetBox.appendChild(el('strong', { text: 'Target: ' + componentLabel(node) }));
    function button(text, action, disabled) { var b = el('button', { class: 'an-ghost', text: text }); b.disabled = !!disabled; listen(b, 'click', action); targetBox.appendChild(b); return b; }
    button('Parent element', function () { chooseTarget(node.parentElement); }, !safeTarget(node.parentElement));
    var children = Array.prototype.filter.call(node.children, function (n) { return safeTarget(n) && anchorVisible(n); });
    children.forEach(function (child) { button('Child: ' + componentLabel(child), function () { chooseTarget(child); }); });
    var confirm = button('Use this target', function () {
      if (!cssPath(node) || !safeTarget(node)) { clearTarget(); return; }
      var label = componentLabel(node), geom = { kind: 'pin', selector: cssPath(node), x: 0.5, y: 0.5, vw: window.innerWidth, vh: window.innerHeight };
      clearTarget(); openComposer(20, 100, { type: 'pin', color: state.color, componentLabel: label, geom: geom });
    });
    button('Cancel marking', function () { clearTarget(); setTool('cursor'); if (focusBeforeDraft && focusBeforeDraft.focus) focusBeforeDraft.focus({ preventScroll: true }); });
    ensureHost().appendChild(targetOutline); ensureHost().appendChild(targetBox); positionTarget(); confirm.focus({ preventScroll: true });
  }
  listen(window, 'scroll', positionTarget, true); listen(window, 'resize', positionTarget);
  listen(document, 'pointercancel', function () { if (integration) { var wasDrawing = !!drawing; cancelDrawing(); if (wasDrawing) { clearTarget(); setTool('cursor'); } } }, true);
  listen(document, 'pointerup', function (e) {
    if (!integration || !tapStart) return;
    var start = tapStart; tapStart = null;
    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) <= 10 && Math.abs(window.scrollY - start.scrollY) <= 5) chooseTarget(start.node);
  }, true);
  listen(document, 'keydown', function (e) {
    if (!integration || !state.enabled) return;
    if (e.isComposing) return;
    if (e.key === 'Escape') {
      cancelDrawing(); clearTarget();
      if (pendingDraft) { e.preventDefault(); e.stopPropagation(); closeComposerDraft(); }
      else setTool('cursor');
      return;
    }
    if (state.tool === 'pin' && !isOurs(e.target) && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault(); e.stopImmediatePropagation(); chooseTarget(e.target);
    }
  }, true);
  function onDown(e) {
    if (isReadOnly() || !state.enabled || isOurs(e.target)) return;
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    var t = state.tool;
    if (integration && t === 'pin') {
      tapStart = { node: e.target, x: e.clientX, y: e.clientY, scrollY: window.scrollY }; return;
    }
    if (t === 'pin') { chooseTarget(e.target); return; }
    if (t === 'rect' || t === 'circle' || t === 'pen') {
      var anchor = integration ? e.target : pickAnchor(e.target);
      if (integration && (!safeTarget(anchor) || !cssPath(anchor))) { toast('Choose a public, unique component to draw on.'); return; }
      e.preventDefault(); e.stopPropagation(); ensureOverlay();
      drawing = { tool: t, anchorEl: anchor, box: docBox(anchor), startX: e.pageX, startY: e.pageY, points: [[e.pageX, e.pageY]], node: null };
      if (e.pointerId != null && overlay && overlay.setPointerCapture) try { overlay.setPointerCapture(e.pointerId); } catch (ex) {}
    }
  }
`);
patch('    e.preventDefault();\n    var d = drawing;', `    e.preventDefault();
    if (integration && drawing.points.length >= 2000) { cancelDrawing(); setTool('cursor'); toast('Drawing is too long. Use fewer than 2,000 points.', { kind: 'error' }); return; }
    var d = drawing;`);
patch('    if (isReadOnly()) t = "cursor";', `    if (isReadOnly()) t = "cursor";
    if (integration) { cancelDrawing(); clearTarget(); if (t !== 'cursor') closePanel(); }`);
patch('    document.body.classList.toggle("an-drawing", drawingTool);', `    document.body.classList.toggle("an-drawing", integration ? t === 'rect' || t === 'circle' || t === 'pen' : drawingTool);
    if (integration) {
      document.body.classList.toggle('an-review-selecting', t === 'pin');
      document.body.classList.toggle('an-review-browse', t === 'cursor');
      var title = bar.querySelector('[data-tool="pin"]'); if (title) title.setAttribute('aria-label', 'Mark this page');
      var browse = bar.querySelector('[data-tool="cursor"]'); if (browse) browse.setAttribute('aria-label', 'Browse page');
    }`);
patch('pin: "Click anywhere to drop a pin"', 'pin: "Tap or focus a target, then confirm. Swipe to scroll."');
patch('    if (!state.enabled) return;\n    if (drawing) return;', '    if (!state.enabled || integration && (state.tool !== "highlight" || isOurs(e.target))) return;\n    if (drawing) return;');
patch('      if (isOurs(range.commonAncestorContainer)) return;', '      if (isOurs(range.commonAncestorContainer) || integration && privateRange(range)) return;');
patch('  function ensureComposer() {', `  function closeComposerDraft() {
    saveComposerDraft();
    if (composer) composer.classList.remove('an-show');
    setTool('cursor');
    if (focusBeforeDraft && focusBeforeDraft.focus) focusBeforeDraft.focus({ preventScroll: true });
  }
  function saveComposerDraft() {
    if (!integration || !pendingDraft || !composer) return;
    var ta = composer.querySelector('textarea');
    var saved = { draft: serialize(pendingDraft), text: ta ? ta.value : '', createdAt: pendingDraft.__draftStarted || Date.now() };
    pendingDraft.__draftStarted = saved.createdAt;
    store.set('composer', JSON.stringify(saved));
  }
  function resumeDraft() {
    var saved = readComposerDraft(); if (!saved) return;
    saved.draft.__draftStarted = saved.createdAt;
    openComposer(20, 100, saved.draft);
    composer.querySelector('textarea').value = saved.text || ''; saveComposerDraft();
  }
  function composerViewport() {
    if (!integration) return;
    var v = window.visualViewport;
    ensureHost().style.setProperty('--an-vh', (v ? v.height : window.innerHeight) + 'px');
    ensureHost().style.setProperty('--an-vtop', (v ? v.offsetTop : 0) + 'px');
  }
  if (integration) {
    listen(window, 'resize', composerViewport);
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', composerViewport);
      window.visualViewport.addEventListener('scroll', composerViewport);
      cleanups.push(function () { window.visualViewport.removeEventListener('resize', composerViewport); window.visualViewport.removeEventListener('scroll', composerViewport); });
    }
    listen(window, 'pagehide', saveComposerDraft);
    listen(document, 'visibilitychange', function () { if (document.hidden) saveComposerDraft(); });
  }
  function ensureComposer() {`);
patch('    composer = el("div", { id: "__an_compose" });', '    composer = el("div", { id: "__an_compose", role: "dialog", "aria-label": "Write review comment" });');
patch('      if (performance.now() - composerShownAt < 120) return;', '      if (integration) return;\n      if (performance.now() - composerShownAt < 120) return;');
patch('    var ta = el("textarea", { class: "an-ta", rows: "3", placeholder: "Write your review…" });', `    var ta = el("textarea", { class: "an-ta", rows: "3", placeholder: "Write your review…", 'aria-label': 'Review description' });
    if (integration) { ta.value = draft.text || ''; listen(ta, 'input', saveComposerDraft); }
    if (integration) composer.appendChild(el('p', { class: 'an-context', text: 'Target: ' + (draft.componentLabel || componentLabel(draft.geom && resolveAnchorEl(draft.geom.selector))) + (draft.type === 'pen' ? '. A description is required. Original description only; no snapshot is available.' : '') }));`);
patch('      cancel, save,', `      integration ? el('button', { class: 'an-ghost', text: 'Close and keep draft', onclick: closeComposerDraft }) : null,
      cancel, save,`);
patch('    composer.classList.add("an-show");', `    composer.classList.add("an-show");
    if (integration) { closePanel(); composerViewport(); saveComposerDraft(); }`);
patch('  function cancelDraft() {', `  function cancelDraft() {
    if (integration) { store.set('composer', 'null'); clearTarget(); cancelDrawing(); }
    if (focusBeforeDraft && focusBeforeDraft.focus) focusBeforeDraft.focus({ preventScroll: true });`);
patch('    if (!c) return;\n    composer.classList.remove("an-show");', `    if (!c) return;
    if (integration) store.set('composer', 'null');
    composer.classList.remove("an-show");`);
patch('    setupPanelSwipe();', '    if (!integration) setupPanelSwipe();');
patch('      el("h2", { text: "Comments" }),', `      el("h2", { text: "Comments" }),
      integration ? el('button', { class: 'an-ghost', text: 'Mark this page', onclick: function () { setTool('pin'); } }) : null,
      integration ? el('button', { class: 'an-ghost', text: 'Resume draft', onclick: resumeDraft }) : null,`);
patch('var ch = el("span", { class: "an-chip"', 'var ch = el("button", { type: "button", class: "an-chip"');
patch('    var searchInput = el("input", { placeholder: "Search comments…" });', '    var searchInput = el("input", { placeholder: "Search comments…", "aria-label": "Search comments" });');
patch('      var rin = el("textarea", { class: "an-ta", rows: "2", placeholder: "Reply… (Ctrl+↵ to post)" });', '      var rin = el("textarea", { class: "an-ta", rows: "2", "aria-label": "Reply text", placeholder: "Reply… (Ctrl+↵ to post)" });');
patch('      var eta = el("textarea", { class: "an-ta", rows: "2" });', '      var eta = el("textarea", { class: "an-ta", rows: "2", "aria-label": "Edit comment" });');
patch('      document.body && document.body.classList.remove("an-drawing", "an-highlighting");', '      document.body && document.body.classList.remove("an-drawing", "an-highlighting", "an-review-selecting", "an-review-browse");');

patch('  function eligibleBlock(node) {', '  function eligibleBlock(node) {\n    if (integration && !safeTarget(node)) return null;');
// No hover/long-press capture in Browse mode. The explicit target tool covers sections.
patch('  function setupBlockPlus() {', '  function setupBlockPlus() {\n    if (integration) return;');
patch('    if (!plusTarget) return false;', '    if (!plusTarget) return false;');
patch('  function hidePlus(now) {', '  function hidePlus(now) {\n    if (integration) return;');
patch('g.points.length <= 10000', 'g.points.length <= (integration ? 2000 : 10000)');
patch('    var c = createComment(draft);', `    if (integration && draft.__draftStarted && Date.now() - draft.__draftStarted > 7 * 86400000) { expiryNotice(); return; }
    var c = createComment(draft);`);
patch('    if (status === 410) {', `    if (integration && status === 410 && op.t !== 'del') {
      var lost = dbRead().comments.find(function (c) { return c.id === op.id; });
      if (lost) { var deletedDrafts = JSON.parse(store.get('deleted-drafts') || '[]'); deletedDrafts.push(lost); store.set('deleted-drafts', JSON.stringify(deletedDrafts)); showDeletedDraft(lost); }
    }
    if (status === 410) {`);
patch('  function decorateConflict(c, card) {', `  function showDeletedDraft(c) {
    if (document.getElementById('__an_deleted_' + c.id)) return;
    var box = el('section', { id: '__an_deleted_' + c.id, class: 'an-deleted-draft', role: 'alert' });
    box.appendChild(el('p', { text: 'This thread was deleted. Your local draft will not be shared: ' + c.text + ' ' + c.replies.map(function (r) { return r.text; }).join('; ') }));
    box.appendChild(el('button', { class: 'an-ghost', text: 'Discard deleted thread draft', onclick: function () { store.set('deleted-drafts', JSON.stringify(JSON.parse(store.get('deleted-drafts') || '[]').filter(function (d) { return d.id !== c.id; }))); box.remove(); } }));
    ensureHost().appendChild(box);
  }
  function decorateConflict(c, card) {`);
patch('        if (current) {\n          var retry', `        if (current || !serverStamps(dbRead())[c.id] && !held.some(function (o) { return o.conflict; })) {
          var retry`);
patch('serverStamps(d)[c.id] = current.updatedAt; dbWrite(d);', 'if (current) serverStamps(d)[c.id] = current.updatedAt; dbWrite(d);');
patch('text: current ? \'Current shared text: \'', 'text: current ? \'Current shared text: \'');
// Highlight fallback must still obey unique range resolution and private intersections.
patch('        var ae = c.geom.selector ? resolveAnchorEl(c.geom.selector) : document.body;', '        var ae = c.geom.selector ? resolveAnchorEl(c.geom.selector) : (integration ? null : document.body);');

patch('    return g && g.vw && Math.abs(g.vw - window.innerWidth) > 200;', '    return g && g.vw && (integration ? Math.abs(g.vw - window.innerWidth) > 8 : Math.abs(g.vw - window.innerWidth) > 200);');
patch('  function sizeOverlay() {', `  function sizeOverlay() {
    if (integration && overlay) { overlay.setAttribute('width', 0); overlay.setAttribute('height', 0); overlay.style.width = '0px'; overlay.style.height = '0px'; }`);
// Persist the exact first-attempt PUT body. Later edits queue behind its receipt.
patch('        if (q[i].t === "put" && !(sync.inflight && sync.inflight.key === q[i].key)) {', '        if (q[i].t === "put" && !(integration && q[i].payload) && !(sync.inflight && sync.inflight.key === q[i].key)) {');
patch('    if (op.t !== "del" && (!rec || !isValidComment(rec) || rec.visibility === "private"))', '    if (op.t !== "del" && !(integration && op.t === "put" && op.payload) && (!rec || !isValidComment(rec) || rec.visibility === "private"))');
patch('    if (op.t === "put") {\n      var body = serialize(normalizeComment(rec));', `    if (integration && op.t === 'put' && op.payload) return apiFetch('PUT', path, JSON.parse(op.payload), headers);
    if (op.t === "put") {
      var body = serialize(normalizeComment(rec));`);
patch('      return apiFetch("PUT", path, body, headers);', `      if (integration) { op.payload = JSON.stringify(body); markOp(op, { payload: op.payload }); }
      return apiFetch("PUT", path, body, headers);`);
patch("{ held: false, conflict: false, key: idemKey() }", "{ held: false, conflict: false, payload: null, key: idemKey() }");
patch('    if (integration) {\n      var words = changes.reply', `    if (integration) {
      if (changes.editReply) { toast('Reply editing is unavailable. Your draft is kept.', { kind: 'error' }); return null; }
      var words = changes.reply`);
// Typed, unsent reply/edit drafts survive render, close, reload and actor teardown.
patch('    var drafts = {};\n    if (!preservingDrafts || !listEl) return drafts;', `    var drafts = integration ? JSON.parse(store.get('thread-drafts') || '{}') : {};
    if ((!preservingDrafts && !integration) || !listEl) return drafts;`);
patch('    return drafts;\n  }\n  function restoreDraft', `    if (integration) store.set('thread-drafts', JSON.stringify(drafts));
    return drafts;
  }
  function clearThreadDraft(id, kind) {
    if (!integration) return;
    var drafts = JSON.parse(store.get('thread-drafts') || '{}');
    if (drafts[id]) delete drafts[id][kind];
    store.set('thread-drafts', JSON.stringify(drafts));
  }
  function restoreDraft`);
patch('      rbox.appendChild(rin);', `      rbox.appendChild(rin);
      if (integration) listen(rin, 'input', captureDrafts);`);
patch('      ebox.appendChild(eta);', `      ebox.appendChild(eta);
      if (integration) listen(eta, 'input', captureDrafts);`);
patch('        rin.value = ""; mergeComment(updated); renderPanel();', `        rin.value = ''; rbox.classList.remove('an-show'); clearThreadDraft(c.id, 'reply'); mergeComment(updated); renderPanel();`);
patch('        if (updated) { mergeComment(updated); renderPanel(); }\n      });\n      card.appendChild(ebox);', `        if (updated) { ebox.classList.remove('an-show'); clearThreadDraft(c.id, 'edit'); mergeComment(updated); renderPanel(); }
      });
      card.appendChild(ebox);`);
patch('if (integration) { saveComposerDraft(); cleanThreads();', 'if (integration) { saveComposerDraft(); captureDrafts(); cleanThreads();');
patch('    setTool("cursor");\n    pendingDraft = null;', `    setTool("cursor");
    if (integration && listEl) {
      var savedCard = listEl.querySelector('[data-id="' + c.id + '"]');
      if (savedCard) { savedCard.setAttribute('tabindex', '-1'); savedCard.focus({ preventScroll: true }); }
    }
    pendingDraft = null;`);

patch('    buildUI();\n    ensureOverlay();', `    buildUI();
    if (integration) JSON.parse(store.get('deleted-drafts') || '[]').forEach(showDeletedDraft);
    ensureOverlay();`);
patch('    overlay.setAttribute("width", w);', '    if (integration) w = document.documentElement.clientWidth;\n    overlay.setAttribute("width", w);');
// Discussion state is independent of finding progress and fix verification.
patch('  var STATUSES = { open: "Open", in_progress: "In progress", resolved: "Resolved", wont_fix: "Won’t fix" };', `  var STATUSES = integration ? { open: 'Open discussion', in_progress: 'Discussion in progress', resolved: 'Discussion closed', wont_fix: 'Discussion declined' }
    : { open: "Open", in_progress: "In progress", resolved: "Resolved", wont_fix: "Won’t fix" };`);
patch('(c.resolved ? "Reopen" : "Resolve")', `(integration ? (c.resolved ? 'Reopen discussion' : 'Resolve discussion') : (c.resolved ? "Reopen" : "Resolve"))`);
patch('html: ICONS.check + "<span>Resolved</span>"', `html: ICONS.check + (integration ? '<span>Discussion closed</span>' : "<span>Resolved</span>")`);
patch('var select = el("select", { class: "an-status", "aria-label": "Status", title: "Status" });', `var select = el("select", { class: "an-status", "aria-label": integration ? 'Discussion status' : 'Status', title: integration ? 'Discussion status' : 'Status' });`);
patch('[["open", "Open"], ["resolved", "Resolved"], ["all", "All"]]', `[["open", integration ? 'Open discussions' : "Open"], ["resolved", integration ? 'Closed discussions' : "Resolved"], ["all", "All"]]`);
patch('          ? "Nothing resolved yet."', `          ? (integration ? 'No closed discussions yet.' : "Nothing resolved yet.")`);
patch('    var toolsRow = el("div", { class: "an-toolsrow" }, [search, filters]);', `    var toolsRow = el("div", { class: "an-toolsrow" }, [search, filters]);
    if (integration) toolsRow.appendChild(el('p', { class: 'an-context', text: 'Closing a discussion does not verify a fix.' }));`);
// Resume is a recovery action only when a real composer draft exists.
patch('  function resumeDraft() {', `  function readComposerDraft() {
    var saved; try { saved = JSON.parse(store.get('composer') || 'null'); } catch (e) {}
    if (!saved || !saved.draft) return null;
    if (!Number.isFinite(saved.createdAt) || Date.now() - saved.createdAt >= 7 * 86400000) {
      try { window.localStorage.removeItem(integration.storageNamespace + ':composer'); } catch (e) {}
      if (expiredDraftWork('composer', saved)) expiryNotice();
      return null;
    }
    return saved;
  }
  function hasComposerDraft() { return !!readComposerDraft(); }
  function updateResumeDraft() {
    var button = document.getElementById('__an_resume');
    if (button) button.hidden = !hasComposerDraft();
  }
  function resumeDraft() {`);
patch("text: 'Resume draft', onclick: resumeDraft", "id: '__an_resume', hidden: '', text: 'Resume draft', onclick: resumeDraft");
patch("    store.set('composer', JSON.stringify(saved));", "    store.set('composer', JSON.stringify(saved)); updateResumeDraft();");
patch("    if (integration) store.set('composer', 'null');", "    if (integration) { store.set('composer', 'null'); updateResumeDraft(); }");
patch("store.set('composer', 'null'); clearTarget();", "store.set('composer', 'null'); updateResumeDraft(); clearTarget();");
patch('  function renderPanel() {\n    cleanThreads();', '  function renderPanel() {\n    if (integration) updateResumeDraft();\n    cleanThreads();');
// Integrated builds cannot offer the upstream JSON export as storage recovery.
patch('  var UNSAVED_MSG = "Changes may not be saved — this browser is refusing storage. Your comments are kept on screen and can still be downloaded as JSON.";', `  var UNSAVED_MSG = integration ? 'This browser cannot save your draft on this device. Keep this page open until your changes are shared. Closing it can lose unshared work.'
    : "Changes may not be saved — this browser is refusing storage. Your comments are kept on screen and can still be downloaded as JSON.";`);
patch('toast("Storage full — export your comments before adding more.",', `toast(integration ? 'Storage is full. Keep this page open until your changes are shared. Closing it can lose unshared work.' : "Storage full — export your comments before adding more.",`);
patch('toast("Storage is unavailable — your comments are kept on screen only.",', `toast(integration ? 'Storage is unavailable. Keep this page open until your changes are shared. Closing it can lose unshared work.' : "Storage is unavailable — your comments are kept on screen only.",`);
patch('    error: "Not signed in to the review — changes are kept on this device.",', `    error: integration ? 'Could not share. Your draft is kept here. Compare or retry to continue.' : "Not signed in to the review — changes are kept on this device.",`);
// A 410 from a reply endpoint is not proof that its parent was deleted.
patch("    if (integration && status === 410 && op.t !== 'del') {", `    if (integration && status === 410 && (op.t === 'reply' || op.t === 'unreply') && !r.parentGoneVerified) {
      return reconcileGoneReply(op, r);
    }
    if (integration && status === 410 && op.t !== 'del') {`);
patch('    c.page = localPage(w.page);', `    if (integration) {
      var deletedReplies = JSON.parse(store.get('reply-tombstones') || '{}')[c.id] || {};
      c.replies = c.replies.filter(function (reply) { return !deletedReplies[reply.id]; });
    }
    c.page = localPage(w.page);`);
patch('  function showDeletedDraft(c) {', `  function reconcileGoneReply(op, response) {
    markOp(op, { held: true, replyGone: true }); sync.held = true; syncChanged(); renderPanel();
    settleWaiters(new Error('Could not share this reply. Its draft is kept while the discussion is checked.'));
    return apiFetch('GET', '/comments?page=' + encodeURIComponent(wirePage(PAGE))).then(function (r) {
      if (destroyed) return;
      if (!r.res.ok || !r.data || !Array.isArray(r.data.comments)) throw new Error('unavailable');
      var current = r.data.comments.find(function (c) { return c.id === op.id; });
      if (!current) {
        markOp(op, { held: false, replyGone: false }); releaseHold();
        handleResponse(op, Object.assign({}, response, { parentGoneVerified: true }));
        releaseHold(); return;
      }
      var parent = fromWire(current);
      if (!parent || parent.page !== PAGE) throw new Error('unavailable');
      var replyId = op.t === 'reply' ? op.r.id : op.rid;
      // An inconsistent snapshot is insufficient evidence to discard any operation.
      if (current.replies.some(function (reply) { return reply.id === replyId; })) throw new Error('unavailable');
      var tombstones = JSON.parse(store.get('reply-tombstones') || '{}');
      (tombstones[op.id] = tombstones[op.id] || {})[replyId] = true;
      store.set('reply-tombstones', JSON.stringify(tombstones));
      if (op.t === 'reply' && op.r.text) {
        var drafts = JSON.parse(store.get('deleted-reply-drafts') || '[]');
        if (!drafts.some(function (draft) { return draft.key === op.key; })) drafts.push({ key: op.key, threadId: op.id, text: op.r.text });
        store.set('deleted-reply-drafts', JSON.stringify(drafts));
      }
      dropOps(function (other) { return other.key === op.key; });
      var d = dbRead(), local = d.comments.find(function (c) { return c.id === op.id; });
      if (local) local.replies = local.replies.filter(function (reply) { return reply.id !== replyId; });
      dbWrite(d); sync.acks++; mergeServerPage(r.data.comments); releaseHold(); renderPanel(); scheduleFlush(0);
      toast('A reply was deleted. The discussion is still here; your words are kept in its thread.');
    }).catch(function () {
      if (!destroyed) { sync.held = true; syncChanged(); renderPanel(); toast('Could not check this discussion. Your reply and other changes are kept.'); }
    });
  }
  function decorateDeletedReplies(c, card) {
    JSON.parse(store.get('deleted-reply-drafts') || '[]').filter(function (draft) { return draft.threadId === c.id; }).forEach(function (draft) {
      var box = el('section', { class: 'an-conflict', 'aria-label': 'Deleted reply recovery' });
      box.appendChild(el('p', { text: 'This reply was deleted. These words are kept for you and will not be shared automatically. Copy them into a new reply if you still want to discuss them.' }));
      box.appendChild(el('p', { text: draft.text }));
      box.appendChild(el('button', { class: 'an-ghost', text: 'Copy kept reply words', onclick: function (e) { e.stopPropagation(); copyText(draft.text, 'Reply words copied'); } }));
      box.appendChild(el('button', { class: 'an-ghost', text: 'Discard kept reply words', onclick: function (e) {
        e.stopPropagation(); store.set('deleted-reply-drafts', JSON.stringify(JSON.parse(store.get('deleted-reply-drafts') || '[]').filter(function (d) { return d.key !== draft.key; }))); renderPanel();
      } }));
      listen(box, 'click', function (e) { e.stopPropagation(); }); card.appendChild(box);
    });
  }
  function showDeletedDraft(c) {`);
patch('        decorateConflict(c, card);', '        decorateConflict(c, card); decorateDeletedReplies(c, card);');
patch('    if (!held.length) return;\n    var box', `    if (!held.length) return;
    var uncertainReply = held.find(function (o) { return o.replyGone; });
    if (uncertainReply) {
      var check = el('section', { class: 'an-conflict' }, [el('p', { text: 'Could not confirm whether the reply or its discussion was deleted. Your words and other changes are kept.' })]);
      check.appendChild(el('button', { class: 'an-ghost', text: 'Check discussion again', onclick: function (e) {
        e.stopPropagation(); reconcileGoneReply(uncertainReply, { res: { status: 410 }, data: {} });
      } })); card.appendChild(check); return;
    }
    var box`);
// A successful complete snapshot may ask the integrated renderer to poll less often.
patch('  function poll() {', `  function applyPollAfter(response) {
    if (!integration) return;
    var value = response.headers.get('X-Review-Poll-After'), delay = value === null ? NaN : Number(value);
    sync.pollAfter = Math.max(5000, CFG.pollInterval, Number.isSafeInteger(delay) && delay > 0 ? Math.min(delay, 2147483647) : 0);
    clearTimeout(sync.pollTimer); sync.pollTimer = setTimeout(poll, sync.pollAfter);
  }
  function poll() {`);
patch('sync.pollTimer = setTimeout(poll, CFG.pollInterval);', 'sync.pollTimer = setTimeout(poll, sync.pollAfter || CFG.pollInterval);');
patch('if (status === 304) { sync.offline = false;', 'if (status === 304) { applyPollAfter(r.res); sync.offline = false;');
patch('        sync.loaded = true;', '        applyPollAfter(r.res); sync.loaded = true;');

// Escape is recovery in integrated composers; IME keystrokes belong to the browser.
patch('    listen(ta, "keydown", function (e) {', '    listen(ta, "keydown", function (e) {\n      if (integration && e.isComposing) return;');
patch('      if (e.key === "Escape") cancelDraft();', '      if (e.key === "Escape") { if (integration) closeComposerDraft(); else cancelDraft(); }');
patch('    listen(document, "keydown", function (e) {', '    listen(document, "keydown", function (e) {\n      if (integration && e.isComposing) return;');
patch('        setTool("cursor"); cancelDraft();', '        if (integration) closeComposerDraft(); else { setTool("cursor"); cancelDraft(); }');

// A factory prevents a stale concurrent mount from destroying a newer controller.
patch('export { init, destroy };', 'export { init, destroy, createController };');
const output = path.join(root, 'dist/review/vendor');
mkdirSync(output, { recursive: true });
const patched = '// Generated integration patch; edit scripts/build-review-renderer.mjs, not this file.\n' + code;
writeFileSync(path.join(output, 'annotate.mjs'), patched);
writeFileSync(path.join(root, 'src/review/vendor/annotate.mjs'), patched);
copyFileSync(path.join(root, 'vendor/reviewjs/LICENSE'), path.join(output, 'LICENSE.reviewjs.txt'));
copyFileSync(path.join(root, 'src/review/vendor/annotate.d.mts'), path.join(output, 'annotate.d.mts'));
