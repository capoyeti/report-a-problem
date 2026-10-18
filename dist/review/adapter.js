import { getReviewDraftKey } from './contract.js';
import { createReviewTransport } from './transport.js';
import { createFindingPanels } from './finding.js';
async function loadRenderer() {
    // This file is produced by scripts/build-review-renderer.mjs. The root export
    // never imports it, and this dynamic import runs only after bootstrap succeeds.
    return import('./vendor/annotate.mjs');
}
/** One lifecycle owner per browser document. Superseded async mounts cannot win. */
const owners = new WeakMap();
export function createReviewAdapter(config, host = window) {
    let renderer = null;
    let disposed = false;
    let mounted = false;
    let mounting = null;
    const transport = createReviewTransport({ ...config, origin: host.location.origin,
        onAccessLost: () => { stop(); config.onAccessLost?.(); },
        onBuildChanged: () => { stop(); config.onBuildChanged?.(); } });
    const findings = createFindingPanels({ host, scope: config.scope, actorId: config.actorId,
        buildId: config.buildId, gateway: transport.gateway, request: transport.request,
        getSession: transport.getSession, sources: config.sources, returnPath: config.returnPath });
    const owner = { stop };
    function onSync(event) {
        if (!disposed && owners.get(host) === owner)
            config.onSync?.(event.detail);
    }
    function stop() {
        disposed = true;
        transport.stop();
        findings.teardown();
        host.removeEventListener('annotate:sync', onSync);
        renderer?.destroy();
        renderer = null;
        if (owners.get(host) === owner)
            owners.delete(host);
    }
    async function mount() {
        if (disposed)
            throw new Error('Review adapter has stopped');
        if (mounted)
            return;
        if (mounting)
            return mounting;
        owners.get(host)?.stop();
        owners.set(host, owner);
        mounting = (async () => {
            const session = await transport.getSession();
            const module = await (config.loadRenderer ?? loadRenderer)();
            if (disposed || owners.get(host) !== owner)
                return;
            renderer = module.createController(host);
            host.addEventListener('annotate:sync', onSync);
            renderer.init({
                project: 'shared-review', page: config.scope.pagePath,
                api: transport.gateway, reviewId: config.scope.campaignId, startOpen: true,
                spa: false, pollInterval: 5000,
                integration: {
                    initialSession: session, storageNamespace: getReviewDraftKey(config.actorId, config.scope),
                    getSession: transport.getSession, request: transport.request,
                    decorateThread: findings.decorateThread, teardown: findings.teardown,
                },
            });
            mounted = true;
        })().catch(error => { stop(); throw error; });
        return mounting;
    }
    return {
        mount, stop,
        open: () => renderer?.open(),
        close: () => renderer?.close(),
        refresh: () => renderer?.refresh(),
        /** Call after shared comments load. False means missing or deleted, never a guessed target. */
        focus: (id) => {
            if (!/^[A-Za-z0-9_-]{1,128}$/.test(id) || !renderer?.comments().some(c => c.id === id))
                return false;
            renderer.open();
            renderer.focus?.(id);
            return true;
        },
        setTool: (tool) => renderer?.setTool(tool),
        submit: () => renderer ? renderer.submit() : Promise.reject(new Error('Review is not open')),
        comments: () => renderer?.comments() ?? [],
        syncState: () => renderer?.syncState() ?? { state: 'loading', pending: 0 },
        scope: { ...config.scope },
    };
}
