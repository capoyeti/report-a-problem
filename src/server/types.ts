// src/server/types.ts
//
// Config for the two forwarders. Everything the package needs arrives here;
// the package itself reads no environment variables, so a consumer can wire a
// different service URL or key per deployment without a rebuild.

export interface ReportProblemSession {
  user: { id: string; email?: string | null; name?: string | null };
  tenantId?: string | null;
  tenantName?: string | null;
}

export interface ReportProblemHandlerConfig {
  serviceUrl: string;
  serviceKey: string;
  verifySession: () => Promise<ReportProblemSession | { error: unknown }>;
  timeoutMs?: number;
  fetch?: typeof fetch;
}
