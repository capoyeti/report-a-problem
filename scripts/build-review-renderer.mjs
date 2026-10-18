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
// A factory prevents a stale concurrent mount from destroying a newer controller.
patch('export { init, destroy };', 'export { init, destroy, createController };');
const output = path.join(root, 'dist/review/vendor');
mkdirSync(output, { recursive: true });
const patched = '// Generated integration patch; edit scripts/build-review-renderer.mjs, not this file.\n' + code;
writeFileSync(path.join(output, 'annotate.mjs'), patched);
writeFileSync(path.join(root, 'src/review/vendor/annotate.mjs'), patched);
copyFileSync(path.join(root, 'vendor/reviewjs/LICENSE'), path.join(output, 'LICENSE.reviewjs.txt'));
copyFileSync(path.join(root, 'src/review/vendor/annotate.d.mts'), path.join(output, 'annotate.d.mts'));
