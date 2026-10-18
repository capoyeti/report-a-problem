# CLEVERCONN-215 package contract

Settled additive API, 8 October 2026. Source and dist build successfully. Candidate version: 0.1.4, not published or tagged. CCP may use `npm pack --pack-destination <temporary directory>` from this worktree to test the built package. Repack after later corrections. Coordinator owns review, release and adoption.

```ts
import type {
  ReportProblemAvailability,
  ReportProblemSessionFailure,
  ReportProblemProviderProps,
} from '@visibleprojects/report-a-problem';

interface ReportProblemAvailability {
  canSubmit: boolean;
  message?: string;
  onRetry?: () => void;
  retrying?: boolean;
}
interface ReportProblemSessionFailure {
  error: unknown;
  status?: 401 | 403 | 503;
}
```

Provider and panel accept optional `availability`. Omission defaults to ready. Provider `enabled` remains trigger visibility. An open panel remains mounted when enabled becomes false, with Send blocked. Close unmounts it, clears local state and does not spontaneously reopen on re-enable. Provider outside context is inert.

CCP must key the provider by `${ctx.tenantId}:${ctx.authUser.id}:${ctx.profile.id}`. Availability alone never clears a draft or cancels a dispatched POST. CCP owns observation age, deadlines, bounded explicit recovery, public messages, SSR/hydration consistency and fresh server authority checks. The package does no status polling.

`verifySession` may return `{error, status}`. Omitted/invalid status defaults to 401 unauthorized. Explicit 403 returns reporting_disabled; 503 returns service_unavailable. Thrown checks return controlled 503. Origin is checked before session/external work. Raw errors are never returned. CCP fresh status failures must use these typed results before any POST/sign call.

Successful report response forwarded to the panel includes `ok:true`, `filed:true`, a nonempty string `ref` or `reportId`, sanitised delivered fields and optional duplicate. Missing/malformed filing proof is 502 service_error. A known disabled/gating no-op is 403 reporting_disabled; other no-ops are 502. Panel defensively requires the same proof even when a consumer bypasses the forwarder. Email wording requires delivered.reporter_copy exactly true.

Signing success requires a UUID attachment_id at both the forwarder and browser boundary. A supplied report attachment_ids list must contain only UUID strings and at most ten entries; malformed or mixed lists return 400 invalid_attachment_ids before forwarding, never silently reduce attachments.

Attachment outcomes retain files and successful IDs within this mounted scope. Only failed files retry, at most three concurrent sign/PUT pipelines. Compatibility `uploadAttachment` remains string/null; `uploadAttachmentDetailed` and `AttachmentUploadOutcome` expose controlled results.

Named browser deadlines: signing 15 seconds, PUT 60 seconds, report POST including response body 20 seconds. Browser work is aborted on unmount, late results ignored. A started report retains the exact serialised body and endpoint on ambiguous retry, with editing locked. Only a definitive refusal on the first dispatched attempt releases that lock. After any ambiguous result, later 401/403/503/429 refusals retain the original payload and editing lock until durable filing is confirmed or the panel is explicitly closed. Explicit Close warns an unresolved report may already have arrived. Browser abort does not establish cancellation at the service.

Drafts are only in mounted memory. Explicit Close/Cancel, scope key change, logout and full reload may clear them. No browser storage, analytics or payload logging is used. Automatic capture remains local until explicit Include consent.

Release compatibility: CCP currently pins v0.1.2 and ExpertTech v0.1.1 in the read-only main checkouts inspected. Their fixtures and direct consumer inventory need release review. Strict success intentionally rejects old mocks omitting filed or durable identity. No final dependency path, release tag or published artifact is created by this unit.

Final package verification: 153 source tests, committed-dist rebuild consistency, headed React 18 smoke with inspected screenshots, and 41 tests against the final local pack in a disposable React 19 consumer pass. Coordinator independently confirmed the source/build/browser and 41-test packed consumer gates, and approved draft delivery. Actual CCP local-pack integration and release remain held. See report-reliability-package.md for exact failed harness evidence, reconciliation, final counters and case limits.
