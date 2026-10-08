# CLEVERCONN-215 package reliability verification

Baseline 1277da3e9835b5f799b241170f59c11da132e163, v0.1.3. Candidate v0.1.4 in isolated worktree capoyeti/ccp-215-report-reliability. Executor: Codex, GPT-6. Package Steps 1, 2 and package Step 5 only. No CCP, service, database, configuration, workflow, tag, publication or production report changes.

The additive API is settled in [report-reliability-contract.md](report-reliability-contract.md). CCP can pack the built worktree into a temporary directory. The host owns status caching, freshness deadlines and fresh submission/sign authority checks. The package does no polling.

## Headed failure evidence and reconciliation

Neither failed run is a completed browser pass. The three screenshots saved in the first run demonstrate only the states reached before failure.

Attempt 1, `npm run verify:panel`, exit 1:

```text
node:internal/process/promises:394
    triggerUncaughtException(err, true /* fromPromise */);
    ^

dialog.accept: Cannot accept dialog which is already handled!
    at _Page.<anonymous> (/Users/chadwilliams/orca/workspaces/report-a-problem/ccp-215-report-reliability/scripts/report-panel-verify.ts:84:47) {
  log: [],
  name: 'Error'
}

Node.js v22.22.2
```

Classification: TEST, accumulated dialog handlers. Each `close()` installed `page.once('dialog')`, including successful closes that emitted no dialog. Those handlers accumulated until an unresolved-report Close confirmation emitted one dialog. Two handlers tried to accept it. This is a fixture event-lifetime failure, not a filing or availability result. Reconciliation: install one page dialog handler, and await panel disappearance for every Close.

Attempt 2, `npm run build && git diff --check && npm run verify:panel`, exit 1 from browser step:

```text
AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:

false !== true

    at main (/Users/chadwilliams/orca/workspaces/report-a-problem/ccp-215-report-reliability/scripts/report-panel-verify.ts:124:12) {
  generatedMessage: true,
  code: 'ERR_ASSERTION',
  actual: false,
  expected: true,
  operator: 'strictEqual',
  diff: 'simple'
}
```

Failing source line at that revision: `assert.equal(await page.getByTestId('report-send').isDisabled(), true);` immediately after the availability-control loop.

Classification: TEST timing. `page.evaluate` queued a React state update and returned before its render; immediate `isDisabled()` is a snapshot read. Prior source lifecycle tests pass with React `act`, and attempt 1's unavailable screenshot shows retained draft/files and disabled Send. This supports harness timing rather than an application availability failure. The corrected gate must still prove the actual built UI.

The two-failure stop was honoured. Chad authorised a corrected run on 8 October after evidence and timing reconciliation. All remaining control/retry assertions were inspected before that run:

- Availability helper waits for both the specific notice text and expected Send disabled state.
- Retry connection waits for the ready DOM: existing enabled Send plus absence of the availability notice, including phone.
- Config changes wait for the newly rendered harness config, including enabled, endpoints and identity scope.
- Refusal retry registers a matching POST response wait before clicking, awaits response completion and then waits for the specific controlled error and enabled Retry same report button before comparing recorded bodies.
- No-op/malformed outcomes wait for the error DOM; success waits for sent DOM before inspecting fixture payloads. Close and scope replacement wait for panel disappearance.
- Drag waits for the rendered left position before comparing preservation. No arbitrary sleeps or blind failure retry was added.

Corrected headed attempt 3: exit 0 after browser/server cleanup. VERIFY OK: signs=3, puts=2, posts=24, unexpectedExternal=0, changedRetryBodies=0, durableReports=5. These are physical fixture request counts, not logical clicks. Dropped connections can create multiple HTTP attempts; only five durable reports exist, one initial report plus four lost-reply reports. The earlier index comparisons alone did not attribute refusals when the transport made extra attempts. Follow-up assertions now bind to the exact refusal and duplicate response request bodies/endpoints, verify duplicate=true and original durable ID, compare every physical attempt in each scenario and cap total attempts. Strengthened final headed attempt 4: exit 0 after cleanup, with the same counts. Every physical request within each refusal/duplicate scenario is byte-identical, each refusal is attributed to its exact HTTP response, duplicate=true is asserted, and its durable ID equals the original. This final run verifies strengthened evidence rather than blindly retrying a failure.

Final headed attempt 5 adds a controlled held-response scenario, resolving the missing native Enter/double-click and in-flight availability assertions without sleeps. Exit 0 after cleanup. Current counts artifact: signs=4, puts=3, posts=25, unexpectedExternal=0, changedRetryBodies=0, durableReports=6. The held scenario adds exactly one sign, PUT and durable report. It asserts one POST despite repeated Enter/click and preserves true completion after unavailable presentation and trigger hiding.

Physical HTTP retry totals can differ across runs when the fixture drops a socket. Do not equate them to user clicks. Fixed assertions bind every retry body/endpoint, original durable ID and duplicate flag, assert no external requests and cap total attempts. The final artifact reflects the latest executor run above; prior counts are historical evidence.

Coordinator independent review, 8 October: npm test passes 153; npm run build passes; npm run verify:panel exits 0; the packed React 19 consumer at /tmp/rap-react19-sZzuDV passes 41. Coordinator reported signs=3, puts=2, posts=23, unexpectedExternal=0, changedRetryBodies=0, durableReports=5 for that headed run. Source review approves ambiguity preservation, UUID/list validation and the corrected object-row parameterisation. Approval is for draft PR only; release remains held until CCP local verification.

## Source and packed artifact results

`npm ci`: exit 0. Existing audit reported 7 dependency vulnerabilities; unrelated upgrades were not performed.

`npx vitest run`: exit 0, 153 tests across 11 files, React 18.3.1.

`npm run build`: exit 0. `git diff --check`: exit 0. `head -1 dist/client/ReportProblemPanel.js`: `'use client';`. `npm run build && git diff --exit-code dist` passes, exit 0, after the server/client commits.

`npx playwright install chromium`: exit 0. Local `npm pack`: exit 0, candidate archive only, no tag/publication.

React 19 packed consumer final result: final refreshed local pack exits 0 with 41 tests (confirmed after final source build), 41 tests across two files, React/react-dom 19.1.0, Vitest 2.1.9 and jsdom 25.0.1. The first consumer fixture run failed 3 tests because installed dist was externalised and html2canvas mocks did not apply. A Vitest inline transform for /@visibleprojects\/report-a-problem/ corrected the fixture; the second run passed all 41. This is built-library compatibility proof, not CCP integration or a headed React 19 application pass.

Recipe: create an OS temporary npm project, install the local pack plus the versions above and existing html2canvas/lucide-react peers. Copy panel-delivery and provider-availability tests and replace source imports with installed dist imports. Configure test.server.deps.inline for the installed package and run npm test. No shared checkout or CCP manifest was edited.

## G/U/P mapping

All source assertions below pass. Corrected headed and strengthened attribution gates both exit 0; the final run includes browser/server cleanup. Packed React 19 panel/provider tests also pass against installed dist. CCP-specific portions remain separate unresolved integration gates. Real stalled browser requests are not claimed from fake-timer unit tests.

| ID | Passing source assertion and named variants | Built/integration limit |
| --- | --- | --- |
| G1 | handlers: legacy omitted, 403, 503, invalid 500 default on both routes | No deployed authority claim |
| G2 | origin precedes session; throwing check, invalid identity/JSON, size cap, session-only identity | Source proof |
| G3 | filed true, ref-only, ID-only duplicate; panel durable reference | Final headed gate reaches sent; durable reference shown |
| G4 | app_disabled, tenant_disabled, tenant_not_allowed, tenant_denied, noop, unknown reason never succeeds | Final headed gate rejects HTTP 200 no-op |
| G5 | null, missing/empty/wrong typed proof, ok=1, filed string, ok=false, invalid JSON | Final headed gate rejects invalid JSON |
| G6 | transport, timeout, 5xx, 429; controlled retry copy and retained draft | Final headed lost connection plus all four refusals pass |
| G7 | sanitised delivered; reporter_copy true/false/string/1/null | Final sent screenshot has no email promise |
| G8 | panel rejects bypass-consumer missing/false/wrong typed proof and null | Headed no-op and invalid JSON pass; other proof variants are unit tests |
| G9 | byte-identical body/UUID/IDs after lost reply and route change; later 401/403/503/429 retain original endpoint/content | Final socket-drop, endpoint-change and four later-refusal chains pass |
| G10 | synthetic registry files once, loses reply, returns original duplicate under retained UUID | Final real socket-drop retry confirms duplicate and original ID; one durable report per UUID |
| G11 | synchronous double click: one POST; separate one sign/PUT/report pipeline | Final held-response headed scenario passes: native Enter/double click during Send cause only one sign/PUT/POST |
| G12 | sign status 401/403/413/415/429/503/500 controlled; malformed/non-UUID IDs reject; mixed/invalid report lists block service | No reduced invalid report forwarded |
| U1 | partial failure retains two files, zero report POST; malformed sign prevents PUT | Final headed warning retains two files with zero POST |
| U2 | failed-only retry, five IDs reused, explicit remove excludes ID, max three pipelines across six files | Final headed good signs once, bad retries once, exact two IDs sent |
| U3 | unsupported, oversized, six-file cap; existing MIME tests | Built rejection variants not run |
| U4 | stalled sign headers/body, PUT, report headers/body exit spinner and abort under named deadlines | Real stalled HTTP browser case not run |
| U5 | parent abort; unmount mid-sign ignores late ID/revokes URLs; scope switch mid-POST ignores old result | Built mid-work scope cases pending |
| U6 | ambiguity locks mutation; definitive first refusal unlocks; later four refusal variants cannot erase prior ambiguity; reopen gets new UUID | Final headed four later-refusal chains remain locked until original duplicate |
| U7 | unselected capture omitted from sign/POST; transitions capture once with no upload | Final headed run sends only explicitly selected files |
| U8 | possible prior receipt confirm; decline preserves text, accept does not auto-resend | Final headed unresolved Close confirmations and no auto-resend pass |
| P1 | real provider ready/checking/unavailable/ready keeps same panel/textarea/file DOM; no fetch, one capture | Final headed transitions retain dragged position; CCP deadlines/grace outside scope |
| P2 | hidden trigger retains disabled draft; close/re-enable cannot reopen | Final headed hide/preserve/close/re-enable passes |
| P3 | unknown visible/blocked, missing config hides and preserves open draft | CCP auth/config resolver outside scope |
| P4 | outside context inert; initial disabled no capture; omitted props ready | Packed React 19 also passes |
| P5 | identity key switch clears form/files/result, aborts old scope; upload unmount ignores old ID | Actual CCP key/auth integration unresolved |
| P6 | native retry button focus/callback/disabled retrying, status live region | Final desktop Enter, collapsed trigger and 390px phone recovery pass; actual CCP controls outside scope |
| P7 | renderToString/hydrateRoot unknown HTML matches; no warning/capture/fetch | Actual CCP SSR snapshot outside scope |
| P8 | availability false during POST preserves true completion; scope switch ignores old completion | Final held-response headed scenario passes: hidden trigger/unavailable during POST preserves its immutable true completion |
| P9 | Cancel/reopen new UUID, removal clears draft/URLs, unmount and unresolved Close cleanup | Final headed scope/reload clear state; actual logout is CCP scope |

Final TEST review correction: malformed attachment-list cases now use named object rows rather than raw arrays. Request clones assert the exact two-entry mixed array and eleven-entry oversized array reach the handler, and every case asserts zero downstream fetch calls. Other new each tables were audited: intentional status/error tuples retain positional parameters; proof and malformed sign cases use scalar/object values, so no additional accidental array spreading was found.

Review reconciliation: ambiguity survives later definitive refusals. UUIDs are required at both signing boundaries; malformed mixed report lists return controlled 400 before service work. Optional props/failure type are exported. The panel preserves files and successful uploaded IDs, keeps retries immutable and bounds browser work.

## Screenshots and boundaries

Attempt 1 screenshots were inspected as partial evidence only. Final successful run refreshes the same three synthetic screenshots; these were inspected again:

- [Unavailable draft](report-reliability-react18/unavailable.png)
- [Partial attachment warning](report-reliability-react18/partial-attachments.png)
- [Filed reference](report-reliability-react18/sent.png)

Panel body scrolls within its fixed height, with visible footer controls and no overlap. No sensitive data or real payload logs. Final bounded counters are saved in [counts.json](report-reliability-react18/counts.json). Screenshot inspection and counters do not establish deployed or CCP proof.

Static checks find no process.env, localStorage, sessionStorage or console calls in src. No runtime dependency added. Existing .gitignore remains node_modules/ and test-results/. New notices reuse token-driven rap styles; third-party icon classes and capture colour-conversion internals are unchanged.

The existing workflow runs unconditionally on push and pull_request, including drafts. It is outside allowed source scope and unchanged. Delivery reconciliation: the final evidence commit includes [skip ci], so the existing push/PR jobs are skipped under GitHub's documented commit-message mechanism. No workflow or live configuration changes. See [GitHub skip workflow documentation](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/skip-workflow-runs). The coordinator must reconcile the ready transition and single CI gate separately before lifting that marker. No ready transition is performed here.

Drafts exist only in mounted memory. Close/Cancel, reload, logout and actor/profile/tenant key switch clear them. Browser abort does not establish service cancellation. No release, published dependency adoption, deployed proof or Martin acceptance is claimed. CCP C/A cases, production Next cache, local auth/impersonation, desktop/phone application UI and actual local-pack CCP integration remain coordinator gates.
