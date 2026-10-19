# ReviewJS integration patch

Upstream: `reviewjs/annotate`, version 1.5.3, commit
`1748d22081c01e0d2d92d1724a1915e8b48fd4ca`. The original `annotate.mjs` is
unmodified and SHA256-pinned by `scripts/build-review-renderer.mjs`.
Its MIT licence is retained here and copied into the distributed renderer folder.

`npm run build` creates the maintained derivative in
`dist/review/vendor/annotate.mjs`. Each patch must match exactly one source anchor;
upstream drift fails the build. Do not edit the generated derivative directly.

Intentional changes:

- Explicit `integration` hooks initialise the verified actor/session, isolate
  every local preference/cache/queue/read mark by actor and complete scope, and
  supply a same-origin authenticated request function.
- Integration sessions never use invite links, editable names, or local-only
  auth fallback. Session callbacks after destruction cannot reactivate a UI.
- Export a controller factory so each adapter has a real lifecycle owner.
- Ownership uses opaque IDs only. Team reviewers can reply to shared threads;
  editing somebody else's words is denied locally and must also be denied by
  the backend. Viewer mutations are blocked. Leads have triage capabilities,
  not permission to impersonate another reviewer.
- A stale-edit conflict holds the operation and preserves the draft instead of
  automatically merging/overwriting the newer server record. Rejected writes
  remain held. Refresh alone does not approve replay.
- Loading, shared, offline and conflict states are distinct. Read failure never
  silently becomes a successful empty review.
- Selecting a component in pin mode cannot activate its underlying control.

The host wrapper is `src/review/adapter.ts`; transport is
`src/review/transport.ts`. The root reporting export does not load this code.
`scripts/review-spike-verify.ts` exercises the built module with a deliberately
local synthetic protocol backend. Its fixture server is not production storage,
an authorisation service or proof of SQL/Plane delivery behavior.

Upstream protocol reference:
https://github.com/reviewjs/annotate/blob/1748d22081c01e0d2d92d1724a1915e8b48fd4ca/docs/backlog/wire-protocol.md

Full backend conformance, production host identity checks and physical-device
acceptance remain separate gates. Never describe a fixture-only browser run as
Rhona's acceptance of the consuming app.

Renderer patch ledger for SPR-04 / SPR-05:

- Component paths prefer unique `data-review-id`. Selector resolution requires
  exactly one public target. Private/excluded ancestry, forms, inputs and
  contenteditable regions are excluded; text ranges crossing them are rejected
  both when selected and when resolved. Target labels never harvest parent text.
- Every new mark preserves an immutable `originalContext` containing the initial
  component label, description, viewport and null snapshot attachment. The host
  service sidecar owns the original build. URLs omit queries and fragments.
  Missing, hidden, ambiguous and incompatible drawing layouts show their original
  context in the thread list without a guessed overlay. Freehand explicitly says
  Original description only when no private snapshot was saved.
- Pin mode selects on pointerup, offers parent/child adjustment and confirmation,
  blocks underlying control activation, and preserves native swipe scrolling.
  Browse mode leaves native text selection alone. Highlight is an explicit mode
  with a native selection fallback. Drawing is explicit and Escape/pointercancel
  removes temporary strokes. Native scroll pointercancel preserves pin mode.
- Phone and tablet composers use the visual viewport and safe area, 16px fields,
  44px controls, readable colours, keyboard focus, close/keep/resume controls and
  persisted actor/scope drafts. Seven-day expiry holds both storage values and
  individual queue operations, including legacy queues without expiry. Expired
  work raises a notice and never silently replays. No session token is persisted.
- Blank or over-limit descriptions/replies are rejected without clearing the
  field. Pen marks require a description. Geometry is bounded at 2,000 points.
- Rejected/conflicting operations remain durably held across refresh, submit,
  subsequent edits and reload. Compare loads current shared words before offering
  explicit discard or retry. A retry is a new decision with a new operation key.
  Tombstones remove the shared mark and preserve refused local words separately
  until discard or expiry. Unsupported reply editing is explicitly rejected.
- The first attempted PUT persists its exact serialized payload. Network or auth
  retries reuse those bytes and key. Later local edits queue behind it with a new
  key. Polling cannot advance a pending operation's conflict base.

Supported integration extension points:

```js
integration.decorateThread = (comment, card) => {
  // Runs after the native reply/edit/actions content. Append sidecar content.
  const extra = document.createElement('section');
  card.appendChild(extra);
  return () => extra.remove(); // optional, called before rerender and on destroy
};
integration.teardown = () => { /* optional final host cleanup */ };
```

The callback receives a serialized copy of the renderer record. Keep service-owned
metadata in the host sidecar. Appending content must preserve the native reply UI.
A callback cleanup must release any listeners or other external resources it owns.
VisualViewport listeners and target observers belong to the renderer lifecycle.

Renderer-specific proof is in `test/review-renderer.test.ts` and
`scripts/review-renderer-verify.ts`. The latter owns a disposable loopback fixture,
blocks all non-fixture browser requests, and loads no environment file. Run it
headed with `npx tsx scripts/review-renderer-verify.ts`. The earlier spike harness
is coordinator-owned and requires the new Use this target confirmation step when
integrated. No normal-report source, host adapter, transport or gateway is changed
by this renderer slice.

Cold-review follow-up:

- Integrated status labels and actions explicitly describe discussion closure,
  reopening, progress and decline. Closing a discussion does not verify a fix.
  Nonintegrated upstream labels remain unchanged.
- Resume draft appears only while a valid saved composer exists. A nonnull local
  commit clears composer recovery while preserving queued comment words. Rejected
  input and held/offline operations retain their recovery paths.
- A reply endpoint 410 triggers an authoritative comment-list reread. If the
  parent remains live, only the deleted reply operation is removed; other queued
  work, operation keys and edit conflict bases survive. Deleted reply IDs cannot
  reappear from stale reads. Refused words remain in a copy/discard recovery card.
  A failed/inconsistent reread keeps the operation held; only confirmed parent
  absence permits a parent tombstone.
- Integrated storage errors explain that the page must stay open until sharing,
  and that closing can lose unshared work. They do not promise disabled exports.
  Generic sync errors describe a sharing failure without assuming login expired.
- Successful complete snapshots and 304 responses honor X-Review-Poll-After in
  milliseconds, with a five-second/configured-interval floor. No transport changes
  are needed. Missing or malformed hints preserve the normal polling cadence.
