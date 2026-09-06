// src/server/types.ts

/**
 * What `verifySession` hands back once it has established who is filing. The
 * forwarders trust only this for identity, never the request body, which is what
 * stops a caller filing a report as somebody else or against another tenant.
 */
export interface ReportProblemSession {
  user: { id: string; email?: string | null; name?: string | null };
  tenantId?: string | null;
  tenantName?: string | null;
}

/**
 * Everything the forwarders need, passed in rather than read from the
 * environment. The package reads no environment variables at all, so a consumer
 * can point two deployments at different services, or swap a key, without a
 * rebuild of this package.
 */
export interface ReportProblemHandlerConfig {
  serviceUrl: string;
  serviceKey: string;
  verifySession: () => Promise<ReportProblemSession | { error: unknown }>;
  timeoutMs?: number;
  fetch?: typeof fetch;
}
