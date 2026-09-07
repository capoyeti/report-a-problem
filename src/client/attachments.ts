// The attachment allowlist and the two pure pieces of the attach path. They
// live apart from the panel so they can be unit tested in a node environment,
// and so the file picker, the drop zone and the clipboard all read the same
// list the service enforces.

export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
export const DOC_TYPES = [
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
];
export const ALLOWED_TYPES = [...IMAGE_TYPES, ...DOC_TYPES];

// A clipboard blob has a mime type and no name, so the extension has to be
// derived. Word and Excel keep their short extensions rather than the mime's
// unreadable tail.
const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
  'text/plain': 'txt',
  'text/csv': 'csv',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
};

/**
 * The `accept` attribute for the panel's file input, built from the same
 * allowlist `acceptFile` checks against so the picker cannot offer a file the
 * panel would then reject.
 */
export function buildAcceptAttribute(): string {
  return ALLOWED_TYPES.join(',');
}

/**
 * Turns a clipboard blob into a named `File` the upload path can carry, or
 * null when the clipboard held a type we do not accept. Callers pass a
 * timestamp only in tests; the name just has to be unique per paste.
 */
export function clipboardBlobToFile(blob: Blob, timestamp: number = Date.now()): File | null {
  const ext = EXTENSIONS[blob.type];
  if (!ext) return null;
  return new File([blob], `pasted-${timestamp}.${ext}`, { type: blob.type });
}

/**
 * Picks the type to ask a clipboard item for. `navigator.clipboard.read()`
 * offers several representations of one copy (an image plus an HTML wrapper,
 * say) and we only ever want the image.
 */
export function firstAllowedImageType(types: readonly string[]): string | null {
  return types.find((t) => IMAGE_TYPES.includes(t)) ?? null;
}
