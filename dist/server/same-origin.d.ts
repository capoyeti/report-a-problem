/**
 * Cheap CSRF guard for the two forwarders. Compares the browser's Origin against
 * the Host header it sent, NOT against the request URL's host: Next can resolve
 * `req.url` to a different host behind a proxy, which produced false 403s in
 * experttech. A request with no Origin at all (same-origin GET-style navigations,
 * server-to-server callers) passes, since there is nothing to disagree with.
 */
export declare function isSameOrigin(req: Request): boolean;
