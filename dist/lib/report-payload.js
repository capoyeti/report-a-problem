// src/lib/report-payload.ts
/**
 * Mirrors the service's own cap on `user_message`. Kept in the client so a long
 * description is split here rather than rejected there with a 400.
 */
export const USER_MESSAGE_MAX = 300;
/**
 * Mirrors the service's own cap on `technical_message`, and doubles as the
 * panel textarea's `maxLength` so the reporter is stopped at the boundary
 * instead of silently losing the tail of what they wrote.
 */
export const TECHNICAL_MAX = 2048;
/**
 * Builds the body for a user-initiated problem report, returning null on an
 * empty or whitespace-only description so the caller can skip the POST. Pure, so
 * the slice boundaries around the two length caps are testable without a DOM: a
 * 300-char head lands in userMessage (which becomes the email subject line) and
 * the full text rides in technicalMessage.
 *
 * EXPERTTECH-201: `route` alone described where the user was STANDING when they
 * filed, not what broke (REP-1007: she reported a 404 from /settings after
 * navigating away). `referrer` is the field that recovers the page they came
 * from. Absent fields are omitted rather than set null, so the stored context
 * stays readable.
 */
export function buildUserReportPayload(rawText, ctx = {}) {
    const text = rawText.trim();
    if (!text)
        return null;
    const context = { kind: 'manual_report' };
    if (ctx.href)
        context.href = ctx.href;
    if (ctx.referrer)
        context.referrer = ctx.referrer;
    if (ctx.title)
        context.title = ctx.title;
    if (ctx.viewport)
        context.viewport = ctx.viewport;
    if (ctx.sentryEventId)
        context.sentryEventId = ctx.sentryEventId;
    return {
        userMessage: text.slice(0, USER_MESSAGE_MAX),
        technicalMessage: text.length > USER_MESSAGE_MAX ? text.slice(0, TECHNICAL_MAX) : undefined,
        code: 'user_report',
        route: ctx.route,
        context,
    };
}
