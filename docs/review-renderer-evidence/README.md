# SPR-04 / SPR-05 renderer local proof

Date: 18 October 2026. Environment: disposable synthetic loopback fixture, no
production records, environment file, real mail or external feedback jobs.

Fresh Orca worktree `plan011-renderer-mobile` started at main
`1277da3e9835b5f799b241170f59c11da132e163`. Requested prerequisite commits were
cherry-picked as `6354caa`, `9a49c6c`, `f5fb6f1`. The coordinator should integrate
only the later renderer delta, since it already owns the prerequisites.

Verified locally:

| Command / boundary | Result |
| --- | --- |
| `npm ci` | Exit 0. Lockfile unchanged. Existing audit reports 7 dependency vulnerabilities; no unrelated upgrades made. |
| `npm run build` | Exit 0, pinned source verified, derivative regenerated in src and dist. |
| `npm test` | Exit 0, 14 files and 192 tests passed. |
| `npx tsc --noEmit` | Exit 0. |
| `git diff --check` | Exit 0. |
| `gitleaks git --pre-commit --staged --redact --no-banner` | Exit 0, no leaks found. |
| Renderer rebuild and SHA comparison | Identical repeated output; source/dist derivatives match. |
| `npx tsx scripts/review-renderer-verify.ts` | Headed Chromium, loopback-only, no page errors or external requests. Details in results.json. |

The renderer-specific unit suite includes private ranges, unique selectors,
immutable original context, text limits, fixed seven-day queue expiry, held
conflicts, tombstones and a lost-acknowledgement payload regression. The latter
verifies the same serialized body and operation key on retry while later local
words remain in a separate queued operation.

The browser fixture covers shared create/read/reply; missing anchors; explicit
conflict comparison and retry across submit/refresh/reload; keyboard selection;
parent/child adjustment; private/excluded/form/editable capture refusal; native
text selection; real Chromium touch swipe scrolling; description limits; shapes
and pen; Escape/pointercancel; phone-to-desktop description-only fallback; expiry;
deleted-thread draft retention; actor-isolated typed reply recovery; normal
Browse activation; and decorateThread cleanup with native replies preserved.

Screenshots are synthetic and reviewed locally:

- `shared-1440.png` and `shared-1280.png`: shared thread and reply.
- `composer-390x844.png` and `composer-844x390.png`: bottom composer and retained draft.
- `threads-768x1024.png` and `threads-844x390.png`: navigable responsive list.
- `phone-pen-on-desktop.png`: unavailable geometry with original description.

A reduced 390x420 viewport checks composer actions while available height changes.
This is preliminary keyboard geometry evidence, not an actual software-keyboard
or visual-browser-bar test. The harness explicitly records its browser version,
headed status, viewports, request count and second-browser visibility time.

Remaining gates: coordinator adapter/service/sidecar integration and its full
permission/failure matrix; real iPhone Safari, Android Chrome and tablet; actual
keyboard, pinch/zoom and screen-reader operation; deployed host/build identity;
Rhona's independent journey and acceptance. No main merge, deployment, package
publication, ready transition or CI retry was performed by this renderer task.

The original spike harness belongs to the coordinator and was not edited. Its pin
journey must click Use this target before opening the composer after integration.
The root reporting code, transport, adapter and gateway were not changed.
