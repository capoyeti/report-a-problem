import { type ReviewScope } from './contract.js';
import { type ReviewTransportConfig } from './transport.js';
import type { ReviewRenderer, ReviewRendererModule, ReviewSyncState } from './types.js';
export interface ReviewAdapterConfig extends Omit<ReviewTransportConfig, 'origin' | 'onAccessLost'> {
    onAccessLost?: () => void;
    onSync?: (state: ReviewSyncState) => void;
    loadRenderer?: () => Promise<ReviewRendererModule>;
}
export declare function createReviewAdapter(config: ReviewAdapterConfig, host?: Window): {
    mount: () => Promise<void>;
    stop: () => void;
    open: () => void | undefined;
    close: () => void | undefined;
    refresh: () => void | undefined;
    setTool: (tool: Parameters<ReviewRenderer["setTool"]>[0]) => void | undefined;
    submit: () => Promise<unknown>;
    comments: () => Record<string, unknown>[];
    syncState: () => ReviewSyncState;
    scope: ReviewScope;
};
