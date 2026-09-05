export interface ReportProblemSession {
    user: {
        id: string;
        email?: string | null;
        name?: string | null;
    };
    tenantId?: string | null;
    tenantName?: string | null;
}
export interface ReportProblemHandlerConfig {
    serviceUrl: string;
    serviceKey: string;
    verifySession: () => Promise<ReportProblemSession | {
        error: unknown;
    }>;
    timeoutMs?: number;
    fetch?: typeof fetch;
}
