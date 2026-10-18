/**
 * Dependency-free review context. This is a namespace, never an access grant.
 * Keep changes in sync with error-triage-service's versioned boundary fixtures.
 */
export const REVIEW_CONTRACT_VERSION = 1;
export const REVIEW_ROLES = ['viewer', 'reviewer', 'lead'] as const;
export const REVIEW_ACTIONS = [
  'read', 'create', 'reply', 'edit_own', 'moderate', 'assign', 'promote',
  'retest', 'manage_campaign', 'approve_work',
] as const;

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

const FIELDS = ['appId', 'tenantId', 'environment', 'campaignId', 'pagePath', 'resourceId'];
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

export function isReviewIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 200
    && value === value.trim() && !CONTROL.test(value);
}

/** A canonical path is supplied by the host; query/private context is separate. */
export function isCanonicalReviewPage(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 1024
    && /^\/(?:[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~-]+)*)?$/.test(value)
    && !value.split('/').some(segment => segment === '.' || segment === '..');
}

/** Reject ambiguous/missing fields instead of converting them to app-wide scope. */
export function parseReviewScope(value: unknown): ReviewScope | null {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const data = value as Record<string, unknown>;
    const keys = Object.keys(data);
    if (keys.length !== FIELDS.length || FIELDS.some(field => !keys.includes(field))) return null;
    if (!isReviewIdentifier(data.appId) || !isReviewIdentifier(data.environment)
      || !isReviewIdentifier(data.campaignId) || !isCanonicalReviewPage(data.pagePath)
      || !(data.tenantId === null || isReviewIdentifier(data.tenantId))
      || !(data.resourceId === null || isReviewIdentifier(data.resourceId))) return null;
    return {
      appId: data.appId, tenantId: data.tenantId, environment: data.environment,
      campaignId: data.campaignId, pagePath: data.pagePath, resourceId: data.resourceId,
    };
  } catch {
    return null;
  }
}

function scopeTuple(value: unknown): [string, string | null, string, string, string, string | null] {
  const scope = parseReviewScope(value);
  if (!scope) throw new TypeError('Invalid review scope');
  return [scope.appId, scope.tenantId, scope.environment, scope.campaignId, scope.pagePath, scope.resourceId];
}

/** Stable and collision-safe: null cannot alias a tenant literally named null. */
export function getReviewScopeKey(scope: ReviewScope): string {
  return `review-scope:v1:${JSON.stringify(scopeTuple(scope))}`;
}

/** Actor must be the verified opaque ID, never an editable display name. */
export function getReviewDraftKey(actorId: string, scope: ReviewScope): string {
  if (!isReviewIdentifier(actorId)) throw new TypeError('Invalid review actor');
  return `review-draft:v1:${JSON.stringify([actorId, ...scopeTuple(scope)])}`;
}
