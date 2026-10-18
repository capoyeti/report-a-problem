import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  REVIEW_ACTIONS, REVIEW_CONTRACT_VERSION, REVIEW_ROLES,
  getReviewDraftKey, getReviewScopeKey, parseReviewScope, type ReviewScope,
} from '../src/review/contract.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/review-contract-v1.json', import.meta.url), 'utf8')) as {
  contractVersion: number; roles: string[]; actions: string[];
  cases: Array<{ name: string; value: unknown; valid: boolean; scopeKey?: string }>;
};
const scope: ReviewScope = {
  appId: 'app-a', tenantId: null, environment: 'test', campaignId: 'october',
  pagePath: '/dashboard/parent-documents', resourceId: null,
};

describe('versioned review boundary', () => {
  it('matches the shared fixture vocabulary', () => {
    expect(REVIEW_CONTRACT_VERSION).toBe(fixture.contractVersion);
    expect(REVIEW_ROLES).toEqual(fixture.roles);
    expect(REVIEW_ACTIONS).toEqual(fixture.actions);
  });
  it.each(fixture.cases)('$name', ({ value, valid, scopeKey }) => {
    const result = parseReviewScope(value);
    expect(result !== null).toBe(valid);
    if (result) expect(getReviewScopeKey(result)).toBe(scopeKey);
    else expect(() => getReviewScopeKey(value as ReviewScope)).toThrow(TypeError);
  });
  it('does not depend on object key order or mutate the caller', () => {
    const reversed = Object.fromEntries(Object.entries(scope).reverse()) as unknown as ReviewScope;
    expect(getReviewScopeKey(reversed)).toBe(getReviewScopeKey(scope));
    expect(parseReviewScope(scope)).not.toBe(scope);
  });
  it('rejects throwing accessors without leaking their error', () => {
    const hostile = { ...scope, get appId(): string { throw new Error('private'); } };
    expect(parseReviewScope(hostile)).toBeNull();
  });
});

describe('actor-isolated drafts', () => {
  it('has a stable explicit versioned key', () => {
    expect(getReviewDraftKey('actor-a', scope)).toBe(
      'review-draft:v1:["actor-a","app-a",null,"test","october","/dashboard/parent-documents",null]',
    );
  });
  it('separates every scope field, null values and actors', () => {
    const variants: ReviewScope[] = [
      scope, { ...scope, appId: 'app-b' }, { ...scope, tenantId: 'null' },
      { ...scope, environment: 'preview' }, { ...scope, campaignId: 'november' },
      { ...scope, pagePath: '/dashboard/inbox' }, { ...scope, resourceId: 'null' },
    ];
    const keys = variants.map(s => getReviewDraftKey('actor-a', s));
    keys.push(getReviewDraftKey('actor-b', scope));
    expect(new Set(keys).size).toBe(keys.length);
  });
  it('cannot collide by moving delimiters between identifier fields', () => {
    const a = { ...scope, appId: 'a:b', tenantId: 'c' };
    const b = { ...scope, appId: 'a', tenantId: 'b:c' };
    expect(getReviewDraftKey('actor', a)).not.toBe(getReviewDraftKey('actor', b));
  });
  it.each(['', ' actor', 'actor\n', 'a'.repeat(201), null, 1])('rejects invalid actor %s', actor => {
    expect(() => getReviewDraftKey(actor as string, scope)).toThrow(TypeError);
  });
});
