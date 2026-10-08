export declare const SIGN_TIMEOUT_MS = 15000;
export declare const PUT_TIMEOUT_MS = 60000;
export declare const REPORT_TIMEOUT_MS = 20000;
export type AttachmentUploadOutcome = {
    ok: true;
    attachmentId: string;
} | {
    ok: false;
    phase: 'sign' | 'put';
    status?: number;
    error: 'unauthorized' | 'reporting_disabled' | 'service_unavailable' | 'unsupported_type' | 'file_too_large' | 'rate_limited' | 'upload_failed';
};
export declare function withRequestDeadline<T>(timeoutMs: number, parent: AbortSignal | undefined, run: (signal: AbortSignal) => Promise<T>): Promise<T>;
export declare function uploadAttachmentDetailed(endpoint: string, file: File, fetchImpl?: typeof fetch, signal?: AbortSignal): Promise<AttachmentUploadOutcome>;
export declare function uploadAttachment(endpoint: string, file: File, fetchImpl?: typeof fetch): Promise<string | null>;
