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
