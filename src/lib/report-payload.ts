// src/lib/report-payload.ts
//
// Builds the /api/error-report body for a USER-INITIATED problem report (the
// "Report a problem" menu action), as opposed to the reactive ErrorProvider
// toast that fires on a caught error.
//
// error-triage-service caps userMessage at 300 chars and technicalMessage at
// 2048. We mirror those limits here so a long description never trips the
// service's 400 (invalid_body) path: a 300-char head lands in userMessage (the
// email subject/summary line), and the full text, up to 2048, rides in
// technicalMessage. Kept as a pure function so the slice boundaries are
// unit-testable without a DOM.

export const USER_MESSAGE_MAX = 300; // must match BodySchema.userMessage.max
export const TECHNICAL_MAX = 2048; // must match BodySchema.technicalMessage.max

export interface ReportContext {
  route?: string;
  href?: string;
  referrer?: string;
  title?: string;
  viewport?: string;
  sentryEventId?: string;
}

export interface UserReportPayload {
  userMessage: string;
  technicalMessage?: string;
  code: 'user_report';
  route?: string;
  context: Record<string, unknown> & { kind: 'manual_report' };
}

/**
 * Build the request body for a user-initiated problem report. Returns null when
 * the description is empty/whitespace-only so the caller can skip the POST.
 *
 * EXPERTTECH-201: `route` alone described where the user was STANDING when they
 * filed, not what broke (REP-1007: she reported a 404 from /settings after
 * navigating away). `referrer` is the field that recovers the page they came
 * from. Absent fields are omitted rather than set null, so the stored context
 * stays readable.
 */
export function buildUserReportPayload(
  rawText: string,
  ctx: ReportContext = {},
): UserReportPayload | null {
  const text = rawText.trim();
  if (!text) return null;

  const context: Record<string, unknown> & { kind: 'manual_report' } = { kind: 'manual_report' };
  if (ctx.href) context.href = ctx.href;
  if (ctx.referrer) context.referrer = ctx.referrer;
  if (ctx.title) context.title = ctx.title;
  if (ctx.viewport) context.viewport = ctx.viewport;
  if (ctx.sentryEventId) context.sentryEventId = ctx.sentryEventId;

  return {
    userMessage: text.slice(0, USER_MESSAGE_MAX),
    technicalMessage: text.length > USER_MESSAGE_MAX ? text.slice(0, TECHNICAL_MAX) : undefined,
    code: 'user_report',
    route: ctx.route,
    context,
  };
}
