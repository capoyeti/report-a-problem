// src/lib/attachment-filename.ts
//
// Sanitizes a reporter-supplied filename for use as (part of) a
// storage object key. Keeps the original name so the Plane comment can show
// a real filename (e.g. "tender-scope.pdf") rather than an opaque request id.
// That matters once attachments are documents, not just screenshots.

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
  'text/plain': 'txt',
  'text/csv': 'csv',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
};

const MAX_LENGTH = 120;

export function sanitizeAttachmentFilename(name: string | undefined, mime: string): string {
  const fallbackExt = EXT_BY_MIME[mime] ?? 'bin';
  const raw = name && name.trim() ? name.trim() : `attachment.${fallbackExt}`;
  const safe = raw.replace(/[^A-Za-z0-9._-]/g, '_');

  if (safe.length <= MAX_LENGTH) return safe;

  const dot = safe.lastIndexOf('.');
  const ext = dot > 0 ? safe.slice(dot) : '';
  const stem = dot > 0 ? safe.slice(0, dot) : safe;
  return stem.slice(0, MAX_LENGTH - ext.length) + ext;
}
