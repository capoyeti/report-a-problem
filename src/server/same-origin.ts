// src/server/same-origin.ts
//
// Compare the browser's Origin host against the Host header it sent, NOT the
// request URL's host: Next can resolve req.url to a different host and cause
// false 403s (learned in experttech).

export function isSameOrigin(req: Request): boolean {
  const origin = req.headers.get('origin') || req.headers.get('referer');
  if (!origin) return true;
  const host = req.headers.get('host');
  if (!host) return true;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
