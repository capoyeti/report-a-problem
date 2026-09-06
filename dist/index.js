// src/index.ts
//
// Three layers, in dependency order: pure helpers that need neither a DOM nor a
// network, the server forwarders, and the React client. Server and client are in
// one entry point deliberately; the forwarders never reach a browser bundle
// because only a route file imports them.
export { buildUserReportPayload, USER_MESSAGE_MAX, TECHNICAL_MAX } from './lib/report-payload.js';
export { clampPanelPosition } from './lib/panel-position.js';
export { needsScreenshot } from './lib/needs-screenshot.js';
export { sanitizeAttachmentFilename } from './lib/attachment-filename.js';
export { createReportProblemHandlers } from './server/handlers.js';
export { ReportProblemPanel } from './client/ReportProblemPanel.js';
export { ReportProblemProvider, useReportProblem } from './client/ReportProblemProvider.js';
export { uploadAttachment } from './client/upload.js';
