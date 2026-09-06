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
export declare function sanitizeAttachmentFilename(name: string | undefined, mime: string): string;
