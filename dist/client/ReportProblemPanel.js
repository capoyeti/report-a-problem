'use client';
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useCallback, useEffect, useRef, useState } from 'react';
import { X, Send, CheckCircle2, Loader2, Bug, ImagePlus, Trash2, GripHorizontal, FileText, ClipboardPaste } from 'lucide-react';
import { buildUserReportPayload, TECHNICAL_MAX } from '../lib/report-payload.js';
import { needsScreenshot } from '../lib/needs-screenshot.js';
import { clampPanelPosition } from '../lib/panel-position.js';
import { uploadAttachment } from './upload.js';
import { ALLOWED_TYPES, IMAGE_TYPES, buildAcceptAttribute, clipboardBlobToFile, firstAllowedImageType } from './attachments.js';
// Marks the panel's own DOM subtree so the auto-capture (html2canvas over
// document.body) can exclude it. The shot must show what was BEHIND the
// panel, never the panel itself.
const PANEL_ROOT_ATTR = 'data-report-panel-root';
const MAX_SHOTS = 6;
const MAX_BYTES = 8 * 1024 * 1024;
const ACCEPT = buildAcceptAttribute();
const CLIPBOARD_BLOCKED = 'Your browser blocked clipboard access; press Cmd+V (Ctrl+V) instead or choose a file.';
const DEFAULT_ENDPOINTS = { report: '/api/error-report', attachment: '/api/error-report/attachment' };
function isImageFile(file) {
    return IMAGE_TYPES.includes(file.type);
}
// Screenshot tools differ: some put the image in `files`, some only expose it
// through `items`. Reading both is the difference between Cmd+V working and
// doing nothing at all.
function clipboardFile(data) {
    if (!data)
        return null;
    const direct = Array.from(data.files ?? [])[0];
    if (direct)
        return direct;
    for (const item of Array.from(data.items ?? [])) {
        if (item.kind !== 'file')
            continue;
        const file = item.getAsFile();
        if (file)
            return file;
    }
    return null;
}
function formatBytes(bytes) {
    return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))}KB` : `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
function collectReportContext() {
    if (typeof window === 'undefined')
        return {};
    const dpr = window.devicePixelRatio || 1;
    return {
        route: window.location.pathname,
        href: window.location.href,
        // The page they came FROM. This is the one that recovers a 404 the user
        // has already navigated away from (REP-1007).
        referrer: document.referrer || undefined,
        title: document.title || undefined,
        viewport: `${window.innerWidth}x${window.innerHeight} @${dpr}x`,
    };
}
function newId() {
    return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}
/**
 * Proactive "Report a problem" panel. Unlike a reactive error toast (which only
 * appears when code catches an error), this lets a signed-in user describe a
 * problem at any time. The description is POSTed to the consumer's own route,
 * which forwards it to error-triage-service. No technical detail is ever shown
 * to the user, and we only render copy we control here.
 *
 * A non-blocking, draggable floating panel rather than a modal: the page stays
 * fully interactive behind it so the reporter can navigate, reproduce the
 * problem, and take further OS-level screenshots (pasted in here) while it is
 * still open, all landing in one report on a single Send.
 *
 * Controlled component: parent owns `open` and resets on `onClose`.
 */
export function ReportProblemPanel({ open, onClose, endpoints }) {
    const report = endpoints?.report ?? DEFAULT_ENDPOINTS.report;
    const attachmentEndpoint = endpoints?.attachment ?? DEFAULT_ENDPOINTS.attachment;
    const [description, setDescription] = useState('');
    const [state, setState] = useState('idle');
    const [reference, setReference] = useState(null);
    const [emailedCopy, setEmailedCopy] = useState(false);
    const [errorHint, setErrorHint] = useState(null);
    const [shots, setShots] = useState([]);
    const [shotError, setShotError] = useState(null);
    // The page-as-it-looked-when-clicked capture, awaiting the reporter's
    // explicit consent (never auto-attached, see brainstorm design 2026-09-03).
    const [autoShot, setAutoShot] = useState(null);
    const [position, setPosition] = useState(null); // null = start centered
    const [dragging, setDragging] = useState(false);
    // Feature-detected after mount rather than at render, so a server render and
    // the first client render agree.
    const [clipboardReadable, setClipboardReadable] = useState(false);
    const panelRef = useRef(null);
    const fileInputRef = useRef(null);
    // A paste inside the textarea reaches both React's onPaste and the
    // document-level listener. Marking the native event stops the second one
    // attaching the same file twice.
    const handledPastes = useRef(new WeakSet());
    const dragRef = useRef(null);
    // One id per open, reused across retries so the service can settle a
    // duplicate rather than filing two reports for one problem.
    const submissionIdRef = useRef(null);
    const revokeShots = (list) => list.forEach((s) => { if (s.previewUrl)
        URL.revokeObjectURL(s.previewUrl); });
    const close = useCallback(() => {
        // Reset so the next open starts clean.
        setDescription('');
        setState('idle');
        setReference(null);
        setEmailedCopy(false);
        setErrorHint(null);
        setShots((prev) => { revokeShots(prev); return []; });
        setAutoShot((prev) => { if (prev?.previewUrl)
            URL.revokeObjectURL(prev.previewUrl); return null; });
        setShotError(null);
        setPosition(null);
        onClose();
    }, [onClose]);
    // Every route in (drop, file picker, Cmd+V, the clipboard button) funnels
    // through here, so the size cap, the type check and the MAX_SHOTS rule are
    // enforced in exactly one place. The last rejection wins the hint; a batch
    // that lands at least one file still clears an earlier error.
    const acceptFiles = useCallback((files) => {
        if (!files.length)
            return;
        const room = MAX_SHOTS - shots.length;
        if (room <= 0) {
            setShotError(`You can attach up to ${MAX_SHOTS} files.`);
            return;
        }
        const accepted = [];
        let hint = null;
        for (const f of files) {
            if (accepted.length >= room) {
                hint = `You can attach up to ${MAX_SHOTS} files.`;
                break;
            }
            if (!ALLOWED_TYPES.includes(f.type)) {
                hint = 'That file type is not supported. Use a PNG/JPG/WebP screenshot, a PDF, a text/CSV file, or a Word/Excel doc.';
                continue;
            }
            if (f.size > MAX_BYTES) {
                hint = `That file is over ${formatBytes(MAX_BYTES)}.`;
                continue;
            }
            accepted.push({ id: newId(), file: f, previewUrl: isImageFile(f) ? URL.createObjectURL(f) : undefined });
        }
        setShotError(hint);
        if (accepted.length)
            setShots((prev) => [...prev, ...accepted]);
    }, [shots.length]);
    const acceptFile = useCallback((f) => { if (f)
        acceptFiles([f]); }, [acceptFiles]);
    const handlePaste = useCallback((e) => {
        if (handledPastes.current.has(e))
            return;
        const file = clipboardFile(e.clipboardData);
        if (!file)
            return; // plain text: leave the paste alone so it lands in the textarea
        handledPastes.current.add(e);
        // A file on the clipboard becomes an attachment, never a wall of binary
        // in the description.
        e.preventDefault();
        acceptFile(file);
    }, [acceptFile]);
    // Paste belongs to the whole panel, not to the textarea. A reporter who has
    // just taken a screenshot presses Cmd+V wherever the cursor happens to be,
    // and before this it silently did nothing (EXPERTTECH-243). An editable
    // element outside the panel keeps its own paste.
    useEffect(() => {
        if (!open)
            return;
        const onDocumentPaste = (e) => {
            const target = e.target;
            const insidePanel = !!target && !!panelRef.current && panelRef.current.contains(target);
            const isEditable = !!target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' || target.isContentEditable);
            if (isEditable && !insidePanel)
                return;
            handlePaste(e);
        };
        document.addEventListener('paste', onDocumentPaste);
        return () => document.removeEventListener('paste', onDocumentPaste);
    }, [open, handlePaste]);
    useEffect(() => {
        setClipboardReadable(typeof navigator !== 'undefined' && typeof navigator.clipboard?.read === 'function');
    }, []);
    // Escape closes, but never while the reporter is typing (an accidental or
    // muscle-memory Escape must not nuke a half-written report), and never
    // mid-send, so we do not abandon an in-flight POST without feedback.
    useEffect(() => {
        if (!open)
            return;
        const onKey = (e) => {
            if (e.key !== 'Escape' || state === 'sending')
                return;
            const target = e.target;
            const isEditable = !!target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' || target.isContentEditable);
            if (isEditable)
                return;
            close();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open, state, close]);
    // Capture the page as it looked the instant the panel opened, before the
    // reporter does anything else. ignoreElements excludes our own subtree, so
    // this only ever shows what was BEHIND the panel, never the panel, and
    // (being a DOM rasterization, not a system screen/tab capture) it is
    // physically incapable of seeing anything outside this browser tab.
    useEffect(() => {
        if (!open)
            return;
        submissionIdRef.current = newId();
        let cancelled = false;
        (async () => {
            try {
                const { default: html2canvas } = await import('html2canvas');
                const canvas = await html2canvas(document.body, {
                    logging: false,
                    useCORS: true,
                    ignoreElements: (el) => el instanceof Element && (el.hasAttribute(PANEL_ROOT_ATTR) || !!el.closest(`[${PANEL_ROOT_ATTR}]`)),
                });
                if (cancelled)
                    return;
                canvas.toBlob((blob) => {
                    if (!blob || cancelled)
                        return;
                    const file = new File([blob], 'auto-capture.png', { type: 'image/png' });
                    setAutoShot({ id: 'auto', file, previewUrl: URL.createObjectURL(blob) });
                }, 'image/png');
            }
            catch {
                // DOM capture can fail (canvas taint from cross-origin content, etc).
                // The manual paste/drop path below still works, never block on this.
            }
        })();
        return () => { cancelled = true; };
    }, [open]);
    if (!open)
        return null;
    const openFilePicker = () => fileInputRef.current?.click();
    // The explicit button exists because right-clicking a div offers no Paste,
    // and a reporter who cannot find Cmd+V has no other way in. Permission can
    // be refused (or the API can be absent behind an insecure origin), so every
    // failure ends as a hint rather than an exception.
    const pasteFromClipboard = async () => {
        try {
            const items = await navigator.clipboard.read();
            for (const item of items) {
                const type = firstAllowedImageType(item.types);
                if (!type)
                    continue;
                const file = clipboardBlobToFile(await item.getType(type));
                if (file) {
                    acceptFile(file);
                    return;
                }
            }
            setShotError('There was no image on your clipboard. Take a screenshot first, or choose a file.');
        }
        catch {
            setShotError(CLIPBOARD_BLOCKED);
        }
    };
    const removeShot = (id) => {
        setShots((prev) => {
            const target = prev.find((s) => s.id === id);
            if (target?.previewUrl)
                URL.revokeObjectURL(target.previewUrl);
            return prev.filter((s) => s.id !== id);
        });
    };
    const includeAutoShot = () => {
        if (!autoShot)
            return;
        if (shots.length >= MAX_SHOTS) {
            setShotError(`You can attach up to ${MAX_SHOTS} files.`);
            return;
        }
        setShots((prev) => [...prev, autoShot]); // ownership moves to shots, do not revoke its URL here
        setAutoShot(null);
    };
    const discardAutoShot = () => {
        if (autoShot?.previewUrl)
            URL.revokeObjectURL(autoShot.previewUrl);
        setAutoShot(null);
    };
    // Dragging: measure the panel's real on-screen rect at drag start (valid
    // whether it is still CSS-centered or already pixel-positioned from a prior
    // drag), then clamp every move so a sliver always stays grabbable.
    const onHeaderPointerDown = (e) => {
        if (!panelRef.current)
            return;
        const rect = panelRef.current.getBoundingClientRect();
        dragRef.current = { startX: e.clientX, startY: e.clientY, originX: rect.left, originY: rect.top };
        setDragging(true);
        e.currentTarget.setPointerCapture(e.pointerId);
    };
    const onHeaderPointerMove = (e) => {
        if (!dragRef.current || !panelRef.current)
            return;
        const rect = panelRef.current.getBoundingClientRect();
        const next = clampPanelPosition({
            x: dragRef.current.originX + (e.clientX - dragRef.current.startX),
            y: dragRef.current.originY + (e.clientY - dragRef.current.startY),
        }, { width: rect.width, height: rect.height }, { width: window.innerWidth, height: window.innerHeight });
        setPosition(next);
    };
    const onHeaderPointerUp = (e) => {
        dragRef.current = null;
        setDragging(false);
        e.currentTarget.releasePointerCapture(e.pointerId);
    };
    const submit = async () => {
        // Cheap guard first: never upload files on an empty report. The Send button
        // is disabled when the text is empty, so this is belt-and-braces rather
        // than a reachable path.
        if (!description.trim())
            return;
        setState('sending');
        setErrorHint(null);
        const ctx = collectReportContext();
        // Sign and upload every accumulated attachment first so their ids can ride
        // in the report body. A failed upload never blocks the report, it just
        // drops that one file rather than losing the whole report.
        const attachmentIds = shots.length
            ? (await Promise.all(shots.map((s) => uploadAttachment(attachmentEndpoint, s.file)))).filter((id) => !!id)
            : [];
        const payload = buildUserReportPayload(description, ctx);
        if (!payload) {
            setState('idle');
            return;
        }
        try {
            const res = await fetch(report, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...payload, submission_id: submissionIdRef.current, attachment_ids: attachmentIds }),
            });
            const body = await res.json().catch(() => ({}));
            if (res.ok && body?.ok) {
                setReference(body.ref ?? body.reportId ?? null);
                // Only promise an email copy when the service actually sent one. The
                // reporter-copy sink is best-effort and can be false (mail down, etc).
                setEmailedCopy(body?.delivered?.reporter_copy === true);
                setState('sent');
                return;
            }
            // Friendly, internal-free messaging. Rate-limit gets a specific hint; all
            // other failures get a generic retry prompt.
            setErrorHint(res.status === 429
                ? "You've sent a few reports just now. Give it a minute and try again."
                : "We couldn't send that just now. Please try again.");
            setState('error');
        }
        catch {
            setErrorHint("We couldn't send that just now. Please try again.");
            setState('error');
        }
    };
    const trimmedEmpty = description.trim().length === 0;
    const panelStyle = position
        ? { left: position.x, top: position.y, transform: 'none' }
        : {};
    const nudgeForShot = needsScreenshot(description) && shots.length === 0;
    return (_jsxs("div", { ref: panelRef, [PANEL_ROOT_ATTR]: 'true', className: dragging ? 'rap-panel rap-panel--dragging' : 'rap-panel', style: panelStyle, role: "dialog", "aria-modal": "false", "aria-label": "Report a problem", "data-testid": "report-problem-panel", children: [_jsxs("div", { className: "rap-handle", onPointerDown: onHeaderPointerDown, onPointerMove: onHeaderPointerMove, onPointerUp: onHeaderPointerUp, "data-testid": "report-drag-handle", children: [_jsxs("div", { className: "rap-handle-left", children: [_jsx(GripHorizontal, { className: "rap-icon rap-icon--faint" }), _jsx(Bug, { className: "rap-icon" }), _jsx("h2", { className: "rap-title", children: "Report a problem" })] }), _jsx("button", { onClick: close, disabled: state === 'sending', "aria-label": "Close", className: "rap-icon-btn", children: _jsx(X, { className: "rap-icon" }) })] }), _jsx("div", { className: "rap-body", children: state === 'sent' ? (_jsxs("div", { className: "rap-success", "data-testid": "report-sent", children: [_jsx(CheckCircle2, { className: "rap-icon" }), _jsxs("div", { children: [_jsx("p", { className: "rap-success-title", children: "Thanks, the team has it." }), reference ? (_jsxs("p", { className: "rap-success-ref", children: ["Your reference is ", _jsx("span", { className: "rap-ref", children: reference }), "."] })) : null, _jsx("p", { className: "rap-hint", children: emailedCopy
                                        ? "We've emailed you a copy, just reply or forward it to follow up."
                                        : 'You can quote this reference if you follow up with the team.' })] })] })) : (_jsxs(_Fragment, { children: [_jsx("label", { htmlFor: "rap-report-text", className: "rap-label", children: "Tell us what went wrong. The team gets this with the page you were on so they can look into it. Drag this panel by its title bar if it's in your way, the page underneath stays usable." }), _jsx("textarea", { id: "rap-report-text", "data-testid": "report-text", autoFocus: true, value: description, maxLength: TECHNICAL_MAX, onChange: (e) => setDescription(e.target.value), onPaste: (e) => handlePaste(e.nativeEvent), disabled: state === 'sending', rows: 5, placeholder: "e.g. I clicked Generate and nothing happened for a few minutes.", className: "rap-textarea" }), _jsxs("div", { className: "rap-counter", children: [_jsxs("span", { className: description.length > TECHNICAL_MAX * 0.9 ? 'rap-hint rap-hint--warn' : 'rap-hint', children: [description.length, "/", TECHNICAL_MAX] }), errorHint ? (_jsx("span", { className: "rap-error", "data-testid": "report-error", children: errorHint })) : null] }), autoShot ? (_jsxs("div", { className: "rap-consent", "data-testid": "report-auto-shot", children: [_jsx("img", { src: autoShot.previewUrl ?? '', alt: "Screen as you clicked Report a problem", className: "rap-consent-thumb" }), _jsxs("div", { className: "rap-consent-copy", children: [_jsx("p", { className: "rap-consent-title", children: "We grabbed the page as you opened this." }), _jsx("p", { className: "rap-hint", children: "Only visible if you choose to include it." })] }), _jsxs("div", { className: "rap-consent-actions", children: [_jsx("button", { type: "button", onClick: includeAutoShot, "data-testid": "report-auto-shot-include", className: "rap-btn rap-btn--primary rap-btn--small", children: "Include" }), _jsx("button", { type: "button", onClick: discardAutoShot, "data-testid": "report-auto-shot-discard", className: "rap-btn rap-btn--small", children: "Discard" })] })] })) : null, _jsxs("div", { role: "button", tabIndex: 0, "aria-label": "Add a screenshot or file. Click to choose a file, or paste one with Cmd+V.", onClick: openFilePicker, onKeyDown: (e) => {
                                if (e.key !== 'Enter' && e.key !== ' ')
                                    return;
                                e.preventDefault(); // Space would otherwise scroll the panel body
                                openFilePicker();
                            }, onDragOver: (e) => e.preventDefault(), onDrop: (e) => {
                                e.preventDefault();
                                acceptFiles(Array.from(e.dataTransfer.files));
                            }, className: nudgeForShot ? 'rap-dropzone rap-dropzone--active' : 'rap-dropzone', "data-testid": "report-shot-zone", children: [_jsx("input", { ref: fileInputRef, type: "file", multiple: true, accept: ACCEPT, tabIndex: -1, "aria-hidden": "true", className: "rap-file-input", "data-testid": "report-file-input", 
                                    // Without this the click we fire on the input bubbles back to
                                    // the zone, which fires it again, forever.
                                    onClick: (e) => e.stopPropagation(), onChange: (e) => {
                                        acceptFiles(Array.from(e.target.files ?? []));
                                        e.target.value = ''; // so picking the same file twice still fires change
                                    } }), shots.length > 0 ? (_jsx("div", { className: "rap-shots", children: shots.map((s) => s.previewUrl ? (_jsxs("div", { className: "rap-shot", children: [_jsx("img", { src: s.previewUrl, alt: "Screenshot to send", className: "rap-shot-img" }), _jsx("button", { type: "button", onClick: (e) => { e.stopPropagation(); removeShot(s.id); }, "aria-label": `Remove ${s.file.name || 'screenshot'}`, className: "rap-shot-remove", children: _jsx(Trash2, { className: "rap-icon rap-icon--tiny" }) })] }, s.id)) : (_jsxs("div", { className: "rap-shot rap-shot--file", children: [_jsx(FileText, { className: "rap-icon rap-icon--faint" }), _jsxs("div", { className: "rap-shot-meta", children: [_jsx("p", { className: "rap-shot-name", children: s.file.name || 'file' }), _jsx("p", { className: "rap-shot-size", children: formatBytes(s.file.size) })] }), _jsx("button", { type: "button", onClick: (e) => { e.stopPropagation(); removeShot(s.id); }, "aria-label": `Remove ${s.file.name || 'file'}`, className: "rap-shot-remove", children: _jsx(Trash2, { className: "rap-icon rap-icon--tiny" }) })] }, s.id))) })) : null, _jsxs("div", { className: "rap-dropzone-copy", children: [_jsx(ImagePlus, { className: "rap-icon rap-icon--faint" }), _jsx("p", { className: "rap-dropzone-title", children: nudgeForShot
                                                ? 'A screenshot would really help here'
                                                : shots.length >= MAX_SHOTS
                                                    ? `Up to ${MAX_SHOTS} files`
                                                    : 'Add a screenshot or file (optional)' }), _jsxs("p", { className: "rap-hint", children: ["Click to choose a file, drop one here, or paste a screenshot with Cmd+V (Ctrl+V on Windows). Screenshots, PDFs, text, Word or Excel, up to ", MAX_SHOTS, " files."] })] }), clipboardReadable ? (_jsx("div", { className: "rap-dropzone-actions", children: _jsxs("button", { type: "button", onClick: (e) => { e.stopPropagation(); void pasteFromClipboard(); }, "data-testid": "report-clipboard-paste", className: "rap-btn rap-btn--small", children: [_jsx(ClipboardPaste, { className: "rap-icon rap-icon--tiny" }), "Paste from clipboard"] }) })) : null, shotError ? _jsx("p", { className: "rap-error", children: shotError }) : null] })] })) }), _jsx("div", { className: "rap-footer", children: state === 'sent' ? (_jsx("button", { onClick: close, className: "rap-btn rap-btn--primary", children: "Done" })) : (_jsxs(_Fragment, { children: [_jsx("button", { onClick: close, disabled: state === 'sending', className: "rap-btn", children: "Cancel" }), _jsxs("button", { onClick: submit, disabled: state === 'sending' || trimmedEmpty, "data-testid": "report-send", className: "rap-btn rap-btn--primary", children: [state === 'sending' ? _jsx(Loader2, { className: "rap-icon rap-icon--spin" }) : _jsx(Send, { className: "rap-icon" }), state === 'sending' ? 'Sending…' : 'Send'] })] })) })] }));
}
/** Default as well as named, because `React.lazy` accepts only a default export. */
export default ReportProblemPanel;
