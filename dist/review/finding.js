import { getReviewDraftKey } from './contract.js';
const labels = {
    open: 'Discussion', needs_decision: 'Needs a decision', assigned: 'Assigned', ready: 'Ready to start',
    in_progress: 'Work in progress', pr_open: 'Fix proposed', ready_for_retest: 'Ready for your retest',
    verified: 'Verified by a tester', reopened: 'Retest failed', declined: 'Declined',
    pending: 'Waiting to file in Plane', processing: 'Filing in Plane', linked: 'Linked to Plane',
    unknown: 'Delivery needs reconciliation', failed: 'Delivery failed', parked: 'Delivery paused',
};
const categoryLabels = {
    bug: 'Function does not work', content: 'Content correction', source_question: 'Question for the document owner',
    ux_decision: 'Usability decision', enhancement: 'Improvement idea',
};
const sevenDays = 7 * 24 * 60 * 60000;
/** Structured finding UI uses supported renderer hooks and explicit service commands. */
export function createFindingPanels(cfg) {
    const doc = cfg.host.document;
    const prefix = getReviewDraftKey(cfg.actorId, cfg.scope) + ':finding:';
    const drafts = new Map();
    const pending = new Map();
    let stopped = false;
    const cleanups = new Set();
    function saveDraft(id, fields) {
        drafts.set(id, fields);
        try {
            cfg.host.localStorage.setItem(prefix + id, JSON.stringify({ at: Date.now(), fields }));
        }
        catch { /* The visible form remains authoritative. */ }
    }
    function loadDraft(id) {
        if (drafts.has(id))
            return drafts.get(id);
        try {
            const raw = cfg.host.localStorage.getItem(prefix + id);
            if (!raw)
                return;
            const value = JSON.parse(raw);
            if (!Number.isFinite(value.at) || value.at < Date.now() - sevenDays) {
                cfg.host.localStorage.removeItem(prefix + id);
                return;
            }
            if (value.fields && Object.values(value.fields).every(v => typeof v === 'string')) {
                drafts.set(id, value.fields);
                return value.fields;
            }
        }
        catch { /* Invalid drafts do not become shared records. */ }
    }
    function clearDraft(id) {
        drafts.delete(id);
        try {
            cfg.host.localStorage.removeItem(prefix + id);
        }
        catch { /* Storage can be unavailable. */ }
    }
    function node(tag, text) {
        const n = doc.createElement(tag);
        if (text)
            n.textContent = text;
        return n;
    }
    function button(text, action) {
        const b = node('button', text);
        b.type = 'button';
        b.addEventListener('click', action);
        return b;
    }
    function decorateThread(comment, card) {
        const id = String(comment.id);
        if (!/^[A-Za-z0-9_-]{1,128}$/.test(id) || stopped)
            return;
        let disposed = false, snapshot = null, session = null, busy = false;
        const root = node('details');
        root.className = 'an-finding';
        root.addEventListener('click', e => e.stopPropagation());
        root.addEventListener('keydown', e => e.stopPropagation());
        const summary = node('summary', 'Finding and progress');
        root.append(summary);
        const status = node('p', 'Open to load shared finding details.');
        status.setAttribute('role', 'status');
        root.append(status);
        const content = node('div');
        root.append(content);
        card.append(root);
        function alive() { return !disposed && !stopped; }
        function errorText(response, data) {
            if (response.status === 409)
                return 'This finding changed, or the test build no longer matches. Your form is kept. Reload shared details, compare, then save again.';
            if (response.status === 410)
                return 'This comment was deleted. Your draft has been kept on this device.';
            if (response.status === 429)
                return 'Too many changes at once. Wait a minute, then retry this change.';
            if (data?.error === 'target_unavailable')
                return 'That test target is unavailable. Ask the review lead to check it.';
            return 'This change was not accepted. Your form is kept. Check your access and the required details.';
        }
        async function load() {
            if (busy || !alive())
                return;
            busy = true;
            status.textContent = 'Loading shared finding details...';
            try {
                const [verified, response] = await Promise.all([cfg.getSession(), cfg.request(`${cfg.gateway}/v1/reviews/${cfg.scope.campaignId}/threads/${id}/finding`)]);
                if (!response.ok) {
                    if (alive())
                        status.textContent = 'Could not load shared finding details. Your draft stays here.';
                    return;
                }
                const data = await response.json();
                if (!data.finding || !Number.isInteger(data.finding.version) || !Array.isArray(data.retests))
                    throw new Error('Invalid finding');
                if (!alive())
                    return;
                session = verified;
                snapshot = data;
                render();
            }
            catch {
                if (alive())
                    status.textContent = 'Could not load shared finding details. Try again when connected.';
            }
            finally {
                busy = false;
            }
        }
        async function mutate(path, payload) {
            if (busy || !snapshot || !alive())
                return;
            let op = pending.get(id);
            // A lost acknowledgement must retry the exact operation before a new one.
            if (!op) {
                op = { key: cfg.host.crypto.randomUUID(), body: JSON.stringify({ expectedVersion: snapshot.finding.version, ...payload }), path };
                pending.set(id, op);
            }
            busy = true;
            status.textContent = 'Sharing this change...';
            content.querySelectorAll('button').forEach(b => { b.disabled = true; });
            try {
                const response = await cfg.request(`${cfg.gateway}/v1/reviews/${cfg.scope.campaignId}/threads/${id}/${op.path}`, {
                    method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': op.key }, body: op.body,
                });
                const result = await response.json().catch(() => ({}));
                if (!alive())
                    return;
                pending.delete(id);
                if (!response.ok) {
                    status.textContent = errorText(response, result);
                    return;
                }
                if (path === 'finding' && payload.command === 'describe')
                    clearDraft(id);
                status.textContent = path === 'promotion' ? 'Finding reserved for Plane. Delivery progress appears below.' : 'Change shared with the team.';
                busy = false;
                await load();
            }
            catch {
                if (alive()) {
                    render();
                    status.textContent = 'Could not confirm delivery. Your form is kept. Retry the same change to check it safely.';
                }
            }
            finally {
                busy = false;
                if (alive())
                    content.querySelectorAll('button').forEach(b => { b.disabled = false; });
            }
        }
        function formField(form, title, key, initial, fields, multiline = false, required = false) {
            const label = node('label', title);
            const input = multiline ? node('textarea') : node('input');
            input.value = fields[key] ?? initial;
            input.maxLength = 5000;
            input.required = required;
            if (multiline)
                input.rows = 3;
            input.addEventListener('input', () => { fields[key] = input.value; saveDraft(id, fields); });
            label.append(input);
            form.append(label);
            return input;
        }
        function render() {
            if (!snapshot || !session)
                return;
            const f = snapshot.finding, lead = session.actor.role === 'lead';
            const writable = session.actor.role !== 'viewer';
            const creator = comment.authorId === cfg.actorId;
            const owner = f.owner_id === cfg.actorId;
            content.replaceChildren();
            status.textContent = labels[f.state] ?? 'Review in progress';
            if (f.reason)
                content.append(node('p', f.reason));
            const threadLink = cfg.returnPath && /^\/[A-Za-z0-9/_-]+$/.test(cfg.returnPath) && /^[a-f0-9-]{36}$/i.test(f.thread_id)
                ? `${cfg.host.location.origin}${cfg.returnPath}?thread=${encodeURIComponent(f.thread_id)}` : null;
            if (threadLink)
                content.append(button('Copy link to this thread', () => {
                    cfg.host.navigator.clipboard?.writeText(threadLink).then(() => { status.textContent = 'Thread link copied. Access is checked when it is opened.'; }, () => { status.textContent = 'Could not copy the link. Try again.'; });
                }));
            if (snapshot.delivery) {
                const delivery = snapshot.delivery;
                content.append(node('p', labels[delivery.state] ?? 'Plane delivery in progress'));
                if (delivery.reason)
                    content.append(node('p', delivery.reason));
                if (delivery.issueUrl && /^https:\/\/app\.plane\.so\//.test(delivery.issueUrl)) {
                    const a = node('a', 'Open Plane ticket');
                    a.href = delivery.issueUrl;
                    a.target = '_blank';
                    a.rel = 'noopener noreferrer';
                    content.append(a);
                }
            }
            content.append(button('Reload shared details', () => { void load(); }));
            if (pending.has(id)) {
                content.append(button('Retry unconfirmed change', () => { const op = pending.get(id); void mutate(op.path, {}); }));
                content.append(node('p', 'Resolve this unconfirmed change before making another change.'));
                return;
            }
            if (writable && (lead || creator) && !snapshot.delivery) {
                const form = node('form');
                form.setAttribute('aria-label', 'Finding details');
                const fields = { ...(loadDraft(id) ?? {}) };
                const details = f.details;
                const label = node('label', 'What kind of feedback is this?');
                const category = node('select');
                for (const [value, text] of Object.entries(categoryLabels)) {
                    const option = node('option', text);
                    option.value = value;
                    category.append(option);
                }
                category.value = fields.category ?? details?.category ?? 'bug';
                category.addEventListener('change', () => { fields.category = category.value; saveDraft(id, fields); });
                label.append(category);
                form.append(label);
                const expected = formField(form, 'What should happen?', 'expected', details?.expected ?? '', fields, true, true);
                const actual = formField(form, 'What actually happens?', 'actual', details?.actual ?? String(comment.text ?? ''), fields, true, true);
                const impact = formField(form, 'Who is affected, and how?', 'impact', details?.impact ?? '', fields, true, true);
                const steps = formField(form, 'Steps to reproduce, including any menu or dialog', 'steps', details?.reproductionSteps ?? '', fields, true);
                const caseId = formField(form, 'Test case reference (optional)', 'case', details?.caseId ?? '', fields);
                const sourceLabel = node('label', 'Source document (optional)');
                const source = node('select');
                const none = node('option', 'No source document');
                none.value = '';
                source.append(none);
                for (const item of cfg.sources ?? []) {
                    const option = node('option', item.filename);
                    option.value = item.hash;
                    source.append(option);
                }
                source.value = fields.source ?? details?.source?.hash ?? '';
                source.addEventListener('change', () => { fields.source = source.value; saveDraft(id, fields); });
                sourceLabel.append(source);
                form.append(sourceLabel);
                const sourcePage = formField(form, 'Source page (optional)', 'sourcePage', String(details?.source?.page ?? ''), fields);
                sourcePage.setAttribute('inputmode', 'numeric');
                sourcePage.setAttribute('pattern', '[1-9][0-9]*');
                const save = node('button', 'Save finding details');
                save.type = 'submit';
                form.append(save);
                form.addEventListener('submit', e => {
                    e.preventDefault();
                    if (!form.reportValidity())
                        return;
                    const selected = cfg.sources?.find(s => s.hash === source.value);
                    const page = sourcePage.value ? Number(sourcePage.value) : null;
                    if (page !== null && (!selected || !Number.isSafeInteger(page) || page <= 0 || selected.pages && page > selected.pages)) {
                        status.textContent = 'Choose a source and a valid page number.';
                        return;
                    }
                    void mutate('finding', { command: 'describe', details: { category: category.value, expected: expected.value.trim(), actual: actual.value.trim(), impact: impact.value.trim(), reproductionSteps: steps.value.trim(), caseId: caseId.value.trim() || null,
                            source: selected ? { filename: selected.filename, hash: selected.hash, page } : null } });
                });
                content.append(form);
            }
            else if (f.details) {
                const d = f.details;
                content.append(node('h4', categoryLabels[d.category]));
                for (const [title, value] of [['Expected', d.expected], ['Actual', d.actual], ['Impact', d.impact], ['Steps', d.reproductionSteps], ['Test case', d.caseId], ['Source', d.source ? `${d.source.filename}${d.source.page ? ', page ' + d.source.page : ''}` : null]]) {
                    if (value) {
                        content.append(node('strong', title ?? ''), node('p', value));
                    }
                }
            }
            if (lead) {
                if (f.details && !snapshot.delivery)
                    content.append(button('Send finding to Plane', () => { void mutate('promotion', {}); }));
                const members = snapshot.members?.filter(m => m.role !== 'viewer' && m.name.trim()) ?? [];
                if (members.length) {
                    const assignment = node('form');
                    assignment.setAttribute('aria-label', 'Assign follow-up');
                    function choose(title, value) {
                        const label = node('label', title), select = node('select');
                        const none = node('option', 'Unassigned');
                        none.value = '';
                        select.append(none);
                        for (const m of members) {
                            const o = node('option', m.name);
                            o.value = m.id;
                            select.append(o);
                        }
                        select.value = value ?? '';
                        label.append(select);
                        assignment.append(label);
                        return select;
                    }
                    const assigned = choose('Who will follow up?', f.owner_id), tester = choose('Who will retest?', f.tester_id);
                    const submit = node('button', 'Save assignment');
                    submit.type = 'submit';
                    assignment.append(submit);
                    assignment.addEventListener('submit', e => { e.preventDefault(); void mutate('finding', { command: 'assign', ownerId: assigned.value || null, testerId: tester.value || null }); });
                    content.append(assignment);
                }
                const decision = node('form');
                decision.setAttribute('aria-label', 'Review decision');
                const reason = node('textarea');
                reason.placeholder = 'Explain the decision';
                reason.setAttribute('aria-label', 'Decision reason');
                reason.required = true;
                reason.maxLength = 5000;
                decision.append(reason);
                for (const [command, text] of [['needs_decision', 'Needs a decision'], ['decline', 'Decline finding']])
                    decision.append(button(text, () => {
                        if (!reason.value.trim()) {
                            reason.reportValidity();
                            return;
                        }
                        void mutate('finding', { command, reason: reason.value.trim() });
                    }));
                content.append(decision);
            }
            if (writable && (lead || owner)) {
                if (['assigned', 'ready', 'reopened'].includes(f.state))
                    content.append(button('Start follow-up', () => { void mutate('finding', { command: 'start' }); }));
                if (f.state === 'in_progress') {
                    const form = node('form'), input = node('input');
                    input.type = 'url';
                    input.placeholder = 'GitHub pull request link';
                    input.setAttribute('aria-label', 'GitHub pull request link');
                    input.required = true;
                    form.append(input);
                    const submit = node('button', 'Record proposed fix');
                    submit.type = 'submit';
                    form.append(submit);
                    form.addEventListener('submit', e => { e.preventDefault(); if (form.reportValidity())
                        void mutate('finding', { command: 'pr_open', prUrl: input.value }); });
                    content.append(form);
                }
            }
            if (f.pr_url && /^https:\/\/github.com\/[^/]+\/[^/]+\/pull\/\d+$/.test(f.pr_url)) {
                const link = node('a', 'Open proposed fix');
                link.href = f.pr_url;
                link.rel = 'noopener noreferrer';
                link.target = '_blank';
                content.append(link);
            }
            if (writable && (lead || owner) && ['pr_open', 'in_progress', 'reopened'].includes(f.state)) {
                const targets = snapshot.targets?.filter(t => t.reachable) ?? [];
                if (targets.length) {
                    const form = node('form');
                    form.setAttribute('aria-label', 'Choose retest build');
                    const label = node('label', 'Test target and build');
                    const select = node('select');
                    for (const t of targets) {
                        const option = node('option', `${new URL(t.origin).hostname}: ${t.buildId}`);
                        option.value = t.id;
                        select.append(option);
                    }
                    label.append(select);
                    form.append(label);
                    const submit = node('button', 'Ready for retest');
                    submit.type = 'submit';
                    form.append(submit);
                    form.addEventListener('submit', e => { e.preventDefault(); const target = targets.find(t => t.id === select.value); if (target)
                        void mutate('finding', { command: 'ready_for_retest', targetId: target.id, buildId: target.buildId }); });
                    content.append(form);
                }
                else
                    content.append(node('p', 'No confirmed test build is available yet. Ask the release owner to register the test target.'));
            }
            if (f.state === 'ready_for_retest' && writable && (creator || f.tester_id === cfg.actorId)) {
                const target = snapshot.testTarget;
                if (f.fix_build !== cfg.buildId || !target?.reachable || target.buildId !== cfg.buildId || target.origin !== cfg.host.location.origin) {
                    content.append(node('p', 'This is not the confirmed test build. Open the assigned test target and reload before recording a result.'));
                    if (target?.reachable && /^https:\/\//.test(target.origin)) {
                        const a = node('a', 'Open assigned test target');
                        a.href = target.origin + cfg.scope.pagePath;
                        a.rel = 'noopener noreferrer';
                        content.append(a);
                    }
                }
                else {
                    const form = node('form');
                    form.setAttribute('aria-label', 'Retest result');
                    const observations = node('textarea');
                    observations.required = true;
                    observations.maxLength = 5000;
                    observations.setAttribute('aria-label', 'What did you observe during the retest?');
                    observations.placeholder = 'What did you observe during the retest?';
                    form.append(observations);
                    content.append(node('p', 'Retesting the confirmed build: ' + cfg.buildId));
                    for (const [result, text] of [['pass', 'Retest passed'], ['fail', 'Retest failed']])
                        form.append(button(text, () => {
                            if (!observations.value.trim()) {
                                observations.reportValidity();
                                return;
                            }
                            void mutate('retest', { result, observations: observations.value.trim(), caseId: f.details?.caseId ?? null, targetId: f.target_id });
                        }));
                    content.append(form);
                }
            }
            for (const retest of snapshot.retests)
                content.append(node('p', `${retest.result === 'pass' ? 'Passed' : 'Failed'} on ${retest.build_id}: ${retest.observations}`));
            const style = node('style');
            style.textContent = '.an-finding{border-top:1px solid #bbb;padding:12px 0;margin-top:12px}.an-finding summary{cursor:pointer;min-height:44px;display:list-item}.an-finding label{display:block;margin:12px 0}.an-finding input,.an-finding textarea,.an-finding select{display:block;box-sizing:border-box;width:100%;font:inherit;font-size:16px;padding:8px;margin-top:4px;color:#17171f;background:#fff;border:1px solid #777;border-radius:4px}.an-finding button,.an-finding a{display:inline-flex;align-items:center;min-height:44px;font:inherit;font-size:14px;padding:8px;box-sizing:border-box;margin:4px 4px 4px 0;white-space:normal}.an-finding p{overflow-wrap:anywhere}.an-finding h4{margin:12px 0 4px}.an-finding textarea{min-height:80px}';
            content.append(style);
        }
        root.addEventListener('toggle', () => { if (root.open && !snapshot)
            void load(); });
        const cleanup = () => { disposed = true; cleanups.delete(cleanup); };
        cleanups.add(cleanup);
        return cleanup;
    }
    return { decorateThread, teardown() { stopped = true; cleanups.forEach(fn => fn()); cleanups.clear(); drafts.clear(); pending.clear(); } };
}
