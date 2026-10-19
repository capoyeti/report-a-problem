import type { ReportProblemSession } from '../server/types.js';
import { type ReviewScope } from './contract.js';
export interface ReviewGatewayConfig {
    enabled: boolean;
    serviceUrl: string;
    serviceKey: string;
    appId: string;
    environment: string;
    buildId: string;
    verifySession: () => Promise<ReportProblemSession | {
        error: unknown;
    }>;
    /** Current product access plus permitted campaign/page/resource, checked server-side. */
    authorizeResource: (session: ReportProblemSession, scope: ReviewScope) => Promise<boolean>;
    fetch?: typeof fetch;
    timeoutMs?: number;
}
/** Server-only forwarder. Never export this entry from a client component. */
export declare function createReviewGatewayHandlers(cfg: ReviewGatewayConfig): {
    resolveReturn(req: Request, opaqueId: string): Promise<Response>;
    session(req: Request): Promise<Response>;
    forward(req: Request, servicePath: string): Promise<Response>;
};
