import { type ReviewScope } from './contract.js';
import type { ReviewSession } from './types.js';
export interface ReviewSource {
    filename: string;
    hash: string;
    pages?: number;
}
export interface FindingPanelConfig {
    host: Window;
    scope: ReviewScope;
    actorId: string;
    buildId: string;
    gateway: string;
    getSession: () => Promise<ReviewSession>;
    request: (url: string, init?: RequestInit) => Promise<Response>;
    sources?: readonly ReviewSource[];
    /** Host route for opaque, authenticated thread links. */
    returnPath?: string;
}
/** Structured finding UI uses supported renderer hooks and explicit service commands. */
export declare function createFindingPanels(cfg: FindingPanelConfig): {
    decorateThread: (comment: Record<string, unknown>, card: HTMLElement) => (() => void) | undefined;
    teardown(): void;
};
