import { describe, it, expect } from 'vitest';
import {
  buildUserReportPayload,
  USER_MESSAGE_MAX,
  TECHNICAL_MAX,
} from '../src/lib/report-payload';

describe('buildUserReportPayload', () => {
  it('returns null for empty or whitespace-only text', () => {
    expect(buildUserReportPayload('')).toBeNull();
    expect(buildUserReportPayload('   \n\t ')).toBeNull();
  });

  it('trims surrounding whitespace', () => {
    const p = buildUserReportPayload('  the save button does nothing  ');
    expect(p?.userMessage).toBe('the save button does nothing');
  });

  it('keeps a short description in userMessage with no technicalMessage', () => {
    const p = buildUserReportPayload('upload spins forever');
    expect(p?.userMessage).toBe('upload spins forever');
    expect(p?.technicalMessage).toBeUndefined();
  });

  it('does not split when exactly at the userMessage limit', () => {
    const text = 'a'.repeat(USER_MESSAGE_MAX);
    const p = buildUserReportPayload(text);
    expect(p?.userMessage).toHaveLength(USER_MESSAGE_MAX);
    expect(p?.technicalMessage).toBeUndefined();
  });

  it('splits a long description: 300-char head in userMessage, full text in technicalMessage', () => {
    const text = 'b'.repeat(USER_MESSAGE_MAX + 50);
    const p = buildUserReportPayload(text);
    expect(p?.userMessage).toHaveLength(USER_MESSAGE_MAX);
    expect(p?.technicalMessage).toHaveLength(USER_MESSAGE_MAX + 50);
  });

  it('caps technicalMessage at the backend limit for very long text', () => {
    const text = 'c'.repeat(TECHNICAL_MAX + 500);
    const p = buildUserReportPayload(text);
    expect(p?.userMessage).toHaveLength(USER_MESSAGE_MAX);
    expect(p?.technicalMessage).toHaveLength(TECHNICAL_MAX);
  });

  it('tags the report with the manual code, kind, and route', () => {
    const p = buildUserReportPayload('something broke', { route: '/tenders/abc' });
    expect(p?.code).toBe('user_report');
    expect(p?.context).toEqual({ kind: 'manual_report' });
    expect(p?.route).toBe('/tenders/abc');
  });

  it('omits route when not provided', () => {
    const p = buildUserReportPayload('something broke');
    expect(p?.route).toBeUndefined();
  });
});

describe('buildUserReportPayload, diagnostic context (EXPERTTECH-201)', () => {
  it('carries the full diagnostic context', () => {
    const p = buildUserReportPayload('the page broke', {
      route: '/settings',
      href: 'https://experttech-phi.vercel.app/settings?tab=x',
      referrer: 'https://experttech-phi.vercel.app/',
      title: 'Settings',
      viewport: '1440x900 @2x',
    });
    expect(p).not.toBeNull();
    expect(p!.context).toEqual({
      kind: 'manual_report',
      href: 'https://experttech-phi.vercel.app/settings?tab=x',
      referrer: 'https://experttech-phi.vercel.app/',
      title: 'Settings',
      viewport: '1440x900 @2x',
    });
    expect(p!.route).toBe('/settings');
  });

  it('omits absent fields rather than writing nulls', () => {
    const p = buildUserReportPayload('x', { route: '/a' });
    expect(p!.context).toEqual({ kind: 'manual_report' });
  });

  it('still returns null for empty text', () => {
    expect(buildUserReportPayload('   ', { route: '/a' })).toBeNull();
  });

  it('accepts no context at all', () => {
    const p = buildUserReportPayload('x');
    expect(p!.context).toEqual({ kind: 'manual_report' });
    expect(p!.route).toBeUndefined();
  });
});
