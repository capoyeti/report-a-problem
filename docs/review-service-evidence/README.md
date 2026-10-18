# Real local service browser proof

18 October 2026, headed Chromium 153.0.8010.12. The final run completed at
19:45:28 UTC with 42 actual same-origin gateway operations and no page errors.
Only synthetic users and school-like controls were used. Screens were inspected
before inclusion. No real parent records or source PDFs are present.

The browser used package source d5ef6ab7fe3bf5a17f697ab168e875d4055da334,
including ordinary-report reliability carried forward from PR6. The host fixture
used the actual shared server helper, cookie authentication and current
resource checks. It forwarded to error-triage-service c78fac545115232e20283f68ac3ece33273d7a22
running real Next routes, PostgREST and disposable PostgreSQL17. The later
fixture-image-only correction b42cbf4 does not change those service contracts.

## What passed

- Two independently authenticated browser contexts created, read and replied to
  the same persisted thread with server-stamped identities.
- Selecting the document button never activated its underlying action.
- A lead saved structured expected/actual/impact details and reserved the one
  canonical report/outbox. Delivery remained off, visible as waiting for Plane.
- Copy feedback survived an immediate 390x844 redraw and a return to1280.
- The lead assigned the follow-up and tester, recorded a proposed GitHub fix,
  and marked an allowlisted target/build ready for retest.
- An older loaded build could not record a result. After a fresh checked
  bootstrap on the registered build, the reporter failed the retest, the
  finding reopened, the lead made it ready again, and a later pass verified it.
  Both failed and passed observations remained visible.
- Host product-access revocation removed the review overlay. Browser requests
  stayed on the local fixture origin, with no page errors.

[Machine-readable results](results.json) include method/path/status traces.
[Screens](verified-retest.png) show synthetic thread/work evidence; the
[copy redraw screen](copy-status-after-redraw-390.png) covers the new recovery.
The service SQL suite separately proves transactional concurrency, permissions,
revocation cutoffs, uncertain Plane/attachment/dispatch recovery and the real
legacy sweep using fake external sinks.

## Reproduce

Start a fresh service fixture with `npm run dev:reviews:local` in its checked
branch. It prints a loopback URL. Select only the Postgres container created by
that run, labelled `spr.checkout` for that service checkout. Then:

```sh
REVIEW_LOCAL_SERVICE_URL=http://127.0.0.1:<printed-port> \
REVIEW_LOCAL_DB_CONTAINER=spr-test-<run-suffix> \
npx tsx scripts/review-service-verify.ts
```

The optional container argument enables the full retest journey. The harness
refuses non-fixture names, image, exposed interface, database or app identity.
Its one target-origin update is synthetic setup, equivalent to a release owner
registering a test target. It is not a user workaround or production probe.
Without that argument, the smaller shared finding/promotion journey runs and
must not be called a retest pass. Stop the service fixture afterward so its own
containers/network are removed.

## Limits

This uses a thin synthetic host, not the Montessori auth implementation. Its
separate consuming-app proof covers that implementation on React19/Next16.
There was no actual code repair, deployment or external GitHub/Plane interaction
in this browser journey. The PR URL, test build and target were synthetic.
Delivery/worker flags stayed off; canonical report reservation is not Plane
linkage. Real integrations, production backup/rollback, physical devices,
software keyboards, screen readers and Rhona's acceptance remain release gates.
