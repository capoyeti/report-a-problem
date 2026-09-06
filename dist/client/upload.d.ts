/**
 * Sign through the app (which knows who the reporter is), then PUT the bytes
 * straight to storage. No attachment byte passes through the app server or the
 * service function, which sidesteps Vercel's 4.5MB function body cap entirely
 * and is why this is two round trips rather than one multipart POST.
 *
 * Returns null rather than throwing on every failure: one refused or failed
 * attachment must never cost the reporter the whole report.
 */
export declare function uploadAttachment(endpoint: string, file: File, fetchImpl?: typeof fetch): Promise<string | null>;
