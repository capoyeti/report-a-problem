// src/lib/attachment-filename.ts
const EXT_BY_MIME = {
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
/**
 * Reduces a reporter-supplied filename to something safe to use as part of a
 * storage object key, while keeping enough of the original that a triage comment
 * can show "tender-scope.pdf" rather than an opaque id. That readability is the
 * whole point once attachments are documents and not just screenshots.
 *
 * error-triage-service builds the real object key, so nothing in this package
 * calls this. It is exported so a consumer naming its own uploads, or a service
 * sharing this contract, applies exactly the same rules.
 */
export function sanitizeAttachmentFilename(name, mime) {
    const fallbackExt = EXT_BY_MIME[mime] ?? 'bin';
    const raw = name && name.trim() ? name.trim() : `attachment.${fallbackExt}`;
    const safe = raw.replace(/[^A-Za-z0-9._-]/g, '_');
    if (safe.length <= MAX_LENGTH)
        return safe;
    const dot = safe.lastIndexOf('.');
    const ext = dot > 0 ? safe.slice(dot) : '';
    const stem = dot > 0 ? safe.slice(0, dot) : safe;
    return stem.slice(0, MAX_LENGTH - ext.length) + ext;
}
