# Shared page review pilot

Candidate 0.2.0-rc.1 extends the existing package with optional review entries.
It includes the earlier reporting reliability branch through e90f273 without
merging either feature into main or publishing a package. Existing consumers
keep their released pin until a coordinated release is approved.

The MIT ReviewJS renderer is pinned and patched reproducibly. Shared storage,
identity, permissions, finding decisions and delivery live in error-triage-service.
There is no Liveblocks service or subscription dependency.

## For testers and review leads

1. Sign in to the pilot app and open **Page feedback** on an enabled page.
2. Choose a pin, then click or tap the component. Check the outlined target,
   adjust to its parent or child if needed, then choose **Use this target**.
3. Explain what is wrong. Choose **Comment**. Wait for **Shared with the review
   team** before assuming another reviewer can see it.
4. Open the thread to reply. **Finding and progress** holds the structured
   expected result, actual result, impact, category and optional test reference.
5. The review lead completes the finding, selects **Send finding to Plane**,
   assigns follow-up and chooses who will retest. Waiting to file, linked to
   Plane, a proposed fix and tester verification are separate states.
6. Follow the thread link when the fix is ready. A retest result requires the
   assigned confirmed test build and an observation. A failed retest reopens the
   finding and keeps earlier attempts. A proposed fix alone never verifies it.

Use the cursor to interact with the app normally. Drawing is an explicit mode;
Escape cancels a selection or drawing. On a phone, use tap-to-pin when text
selection is awkward. Scroll before selecting the target. Rotate or close and
resume without discarding the draft.

Offline and unconfirmed changes are kept for the same signed-in actor and exact
page/resource scope on that device for seven days. They are not yet shared.
Sign back in as the same actor to resume. Another account cannot replay them.
Expired drafts do not replay. Storage can be blocked or cleared by the browser,
so a local draft is not a backup. Grants and service keys are never stored there.

A conflict keeps the local draft and offers comparison with the current saved
comment. Choose explicitly before retrying or discarding. A missing, private,
hidden or ambiguous target is explained in the thread; a mark is not moved to a
guessed location. A sketch from another layout retains its original description.
No automatic screenshot or private page capture occurs.

## Host integration

Use the optional client entry only after current host auth and context checks:

```ts
import { createReviewAdapter } from '@visibleprojects/report-a-problem/review';

const review = createReviewAdapter({
  actorId: verifiedContext.actorId,
  buildId: compiledClientBuildId,
  scope: verifiedContext.scope,
  gatewayPath: '/api/review',
  bootstrapPath: '/api/review/session',
  returnPath: '/dashboard/review',
  sources: approvedManifest,
  onSync: showPlainSaveState,
  onAccessLost: closeReviewAndShowSignIn,
  onBuildChanged: closeReviewAndOfferReload,
});
await review.mount();
review.open();
// After shared comments load and the page finishes rendering:
const found = review.focus(resolvedCommentId);
// Show a missing/deleted-thread message when found is false.
// On logout, actor change, route/resource change or unmount:
review.stop();
```

`scope` contains explicit appId, tenantId or null, environment, campaignId,
canonical pagePath and resourceId or null. The service campaignId is a UUID.
Never derive identity from a name field or trust browser-supplied roles.
`approvedManifest` contains `{filename,hash,pages?}` entries only after source
approval; an empty list is appropriate while school clarifications are pending.
Stable `data-review-id` plus readable `data-review-label` attributes improve
component selection. Mark sensitive areas with `data-review-private` or
`data-review-exclude`; controls/editable fields are excluded too.

The server-only `@visibleprojects/report-a-problem/review/server` entry exports
`createReviewGatewayHandlers`. Configure serviceUrl/key, appId, environment,
current buildId, a fresh verifySession callback and authorizeResource. Map:

| Host route | Handler |
| --- | --- |
| POST `/api/review/session` | `.session(request)` |
| GET `/api/review/return/:threadId` | `.resolveReturn(request,threadId)` |
| `/api/review/v1/...` | `.forward(request, '/api/v1/...' + query)` |

The host must compare the compiled `x-review-client-build` at bootstrap with its
current deployment before issuing a grant. Use a server-only deployment ID,
not a mutable browser value. Every forwarded operation introspects the actual
grant and checks current product access to its stored scope, with current actor
and build stamped server-side. Review campaign membership is additional to
product access. Both must pass. Missing auth, closed writes, revoked access,
wrong tenant/resource and a stale build fail closed.

Do not expose the app key, operator key or dispatcher config to the browser.
Only whitelisted same-origin routes and headers are forwarded. The adapter
renews once under host auth while preserving the exact queued operation. It
assembles full paginated comment/retest snapshots before exposing them.

Return links use an opaque internal thread UUID. The authenticated landing
`/dashboard/review?thread=<id>` and path alias `/dashboard/review/<id>` resolve
through the server, recheck product access, navigate only to allowed context,
then call `focus` after content and shared comments load. Configure the service
`return_url_prefix` to the actual HTTPS path alias ending in `/`. No arbitrary
return URL or production fallback is accepted.

## Service and operations

Deploy the matching service additive migration and API revision dark first.
Its handoff describes app/campaign/resource membership, private evidence,
registered target probes, encrypted per-app Plane configuration, delivery
reconciliation and the bounded approved-work operator commands. A lead can
promote; only the separately configured Chad capability can approve code work.
A Plane assignment, label or comment never authorizes a coding agent.

The operator queue tracks pending/unknown/failed delivery and work runs. The
service has explicit one-job delivery and coordination commands, not an enabled
background scheduler. Configure the operating owner and invocation mechanism
before pilot enablement. Uncertain remote effects are reconciled read-only;
never blindly create another issue or worker. Real dispatch uses the existing
Orca workflow, retains the ticket UUID and opens an unmerged PR.

Disable claims/delivery first, close campaign writes, then hide the host control.
Preserve historical data and ordinary reporting. Do not automatically reverse a
populated migration. Pilot enablement needs confirmed configuration, dependency
security review, target backup/rollback proof, actual device checks and named
Rhona acceptance. These are separate from local implementation evidence.

## Reproduce local proof

```sh
npm ci
npm run build
npm test
npm run verify:panel
npm run verify:review
npx tsx scripts/review-renderer-verify.ts
```

On Node versions that expose experimental Web Storage globally, run Vitest with
`NODE_OPTIONS=--no-experimental-webstorage`; Node 20/22 CI does not need it.

For real local storage proof, start the service's `npm run dev:reviews:local`,
then pass its printed loopback URL:

```sh
REVIEW_LOCAL_SERVICE_URL=http://127.0.0.1:<printed-port> npx tsx scripts/review-service-verify.ts
```

These scripts use synthetic actors/data and prohibit browser requests outside
the fixture origin. Service tests use disposable Postgres/PostgREST and fake
external sinks. They do not prove a live Plane destination, physical device,
production deployment or Rhona acceptance. Read the evidence reports for exact
commands and limitations, and the physical-device script before rollout.
