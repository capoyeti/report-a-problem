import type { ReviewRole, ReviewScope } from './contract.js';
export interface ReviewSession {
    token: string;
    expiresAt: string;
    actor: {
        id: string;
        name: string;
        role: ReviewRole;
    };
    scope: ReviewScope;
    buildId: string;
}
export interface ReviewSyncState {
    state: 'local' | 'loading' | 'idle' | 'pending' | 'offline' | 'error' | 'conflict';
    pending: number;
}
export interface ReviewRenderer {
    init(config: Record<string, unknown>): ReviewRenderer;
    destroy(): void;
    open(): void;
    close(): void;
    setTool(tool: 'cursor' | 'highlight' | 'rect' | 'circle' | 'pen' | 'pin'): void;
    refresh(): void;
    focus?(id: string): void;
    comments(): Array<Record<string, unknown>>;
    syncState(): ReviewSyncState;
    submit(): Promise<unknown>;
}
export interface ReviewRendererModule {
    createController(host: Window): ReviewRenderer;
}
