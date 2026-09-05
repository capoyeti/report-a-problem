// src/client/upload.ts
//
// Sign through the app (session-bound), then PUT the bytes straight to storage.
// The app server and the service never see attachment bytes, which sidesteps
// Vercel's 4.5MB function body cap entirely.
export async function uploadAttachment(endpoint, file, fetchImpl = fetch) {
    try {
        const sign = await fetchImpl(endpoint, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ filename: file.name, mime: file.type, size_bytes: file.size }),
        });
        const body = (await sign.json().catch(() => ({})));
        if (!sign.ok || !body.ok || !body.attachment_id || !body.upload_url)
            return null;
        const put = await fetchImpl(body.upload_url, { method: 'PUT', headers: { 'content-type': file.type, 'x-upsert': 'false' }, body: file });
        return put.ok ? body.attachment_id : null;
    }
    catch {
        return null;
    }
}
