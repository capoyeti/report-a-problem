import { type ReviewScope } from './contract.js';
import type { ReviewSession } from './types.js';
export declare class ReviewAccessError extends Error {
    readonly kind: 'invalid_session' | 'access_lost' | 'stopped' | 'unavailable' | 'build_changed';
    constructor(kind: 'invalid_session' | 'access_lost' | 'stopped' | 'unavailable' | 'build_changed');
}
export interface ReviewTransportConfig {
    origin: string;
    gatewayPath: string;
    bootstrapPath: string;
    actorId: string;
    scope: ReviewScope;
    buildId: string;
    fetch?: typeof fetch;
    now?: () => number;
    onAccessLost?: () => void;
    onBuildChanged?: () => void;
}
/** Explicit per-review transport. It never patches global fetch or browser storage. */
export declare function createReviewTransport(config: ReviewTransportConfig): {
    getSession: (force?: boolean) => Promise<ReviewSession>;
    request: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
    stop: () => void;
    gateway: string;
};
