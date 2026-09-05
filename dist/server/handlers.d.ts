import type { ReportProblemHandlerConfig } from './types.js';
export declare function createReportProblemHandlers(cfg: ReportProblemHandlerConfig): {
    report(req: Request): Promise<Response>;
    attachment(req: Request): Promise<Response>;
};
