export { buildUserReportPayload, USER_MESSAGE_MAX, TECHNICAL_MAX } from './lib/report-payload.js';
export type { ReportContext, UserReportPayload } from './lib/report-payload.js';
export { clampPanelPosition } from './lib/panel-position.js';
export type { Point } from './lib/panel-position.js';
export { needsScreenshot } from './lib/needs-screenshot.js';
export { sanitizeAttachmentFilename } from './lib/attachment-filename.js';
export { createReportProblemHandlers } from './server/handlers.js';
export type { ReportProblemHandlerConfig, ReportProblemSession } from './server/types.js';
