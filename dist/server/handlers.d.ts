import type { ReportProblemHandlerConfig } from './types.js';
/**
 * Builds the two routes an app needs: `report` forwards a filed report to
 * error-triage-service, `attachment` swaps a filename for a signed upload URL.
 * Both are plain `(Request) => Promise<Response>`, so a Next.js App Router file
 * is a single `export const POST`, and any other framework is a one-line adapter.
 *
 * The service key lives here and never reaches the browser, which is the reason
 * these exist at all rather than the panel calling the service directly.
 *
 * `report` awaits the service instead of firing and forgetting, unlike an
 * automatic error-boundary capture: a person is sitting in front of the panel
 * waiting for a reference number. Awaiting means a slow service becomes a
 * timeout, which is why the panel sends a stable `submission_id` and the service
 * settles the retry as a duplicate rather than filing the report twice.
 */
export declare function createReportProblemHandlers(cfg: ReportProblemHandlerConfig): {
    report(req: Request): Promise<Response>;
    attachment(req: Request): Promise<Response>;
};
