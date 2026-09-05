export declare const USER_MESSAGE_MAX = 300;
export declare const TECHNICAL_MAX = 2048;
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
    context: Record<string, unknown> & {
        kind: 'manual_report';
    };
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
export declare function buildUserReportPayload(rawText: string, ctx?: ReportContext): UserReportPayload | null;
