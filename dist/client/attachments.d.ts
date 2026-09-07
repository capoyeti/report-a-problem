export declare const IMAGE_TYPES: string[];
export declare const DOC_TYPES: string[];
export declare const ALLOWED_TYPES: string[];
/**
 * The `accept` attribute for the panel's file input, built from the same
 * allowlist `acceptFile` checks against so the picker cannot offer a file the
 * panel would then reject.
 */
export declare function buildAcceptAttribute(): string;
/**
 * Turns a clipboard blob into a named `File` the upload path can carry, or
 * null when the clipboard held a type we do not accept. Callers pass a
 * timestamp only in tests; the name just has to be unique per paste.
 */
export declare function clipboardBlobToFile(blob: Blob, timestamp?: number): File | null;
/**
 * Picks the type to ask a clipboard item for. `navigator.clipboard.read()`
 * offers several representations of one copy (an image plus an HTML wrapper,
 * say) and we only ever want the image.
 */
export declare function firstAllowedImageType(types: readonly string[]): string | null;
