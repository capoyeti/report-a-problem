/**
 * Dependency-free review context. This is a namespace, never an access grant.
 * Keep changes in sync with error-triage-service's versioned boundary fixtures.
 */
export declare const REVIEW_CONTRACT_VERSION = 1;
export declare const REVIEW_ROLES: readonly ["viewer", "reviewer", "lead"];
export declare const REVIEW_ACTIONS: readonly ["read", "create", "reply", "edit_own", "moderate", "assign", "promote", "retest", "manage_campaign", "approve_work"];
export type ReviewRole = typeof REVIEW_ROLES[number];
export type ReviewAction = typeof REVIEW_ACTIONS[number];
export interface ReviewScope {
    appId: string;
    tenantId: string | null;
    environment: string;
    campaignId: string;
    pagePath: string;
    resourceId: string | null;
}
export declare function isReviewIdentifier(value: unknown): value is string;
/** A canonical path is supplied by the host; query/private context is separate. */
export declare function isCanonicalReviewPage(value: unknown): value is string;
/** Reject ambiguous/missing fields instead of converting them to app-wide scope. */
export declare function parseReviewScope(value: unknown): ReviewScope | null;
/** Stable and collision-safe: null cannot alias a tenant literally named null. */
export declare function getReviewScopeKey(scope: ReviewScope): string;
/** Actor must be the verified opaque ID, never an editable display name. */
export declare function getReviewDraftKey(actorId: string, scope: ReviewScope): string;
