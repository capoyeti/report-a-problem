'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { X, Send, CheckCircle2, Loader2, Bug, ImagePlus, Trash2, GripHorizontal, FileText, ClipboardPaste } from 'lucide-react';
import { buildUserReportPayload, TECHNICAL_MAX, type ReportContext } from '../lib/report-payload.js';
import { needsScreenshot } from '../lib/needs-screenshot.js';
import { clampPanelPosition, startsDrag, type Point } from '../lib/panel-position.js';
import { uploadAttachmentDetailed, withRequestDeadline, REPORT_TIMEOUT_MS } from './upload.js';
import { ALLOWED_TYPES, IMAGE_TYPES, buildAcceptAttribute, clipboardBlobToFile, firstAllowedImageType } from './attachments.js';
import { createCanvasColorConverter, normalizeModernColors } from '../lib/modern-colors.js';

// Marks the panel's own DOM subtree so the auto-capture (html2canvas over
// document.body) can exclude it. The shot must show what was BEHIND the
// panel, never the panel itself.
const PANEL_ROOT_ATTR = 'data-report-panel-root';
const MAX_SHOTS = 6;
const MAX_BYTES = 8 * 1024 * 1024;
const ACCEPT = buildAcceptAttribute();
const CLIPBOARD_BLOCKED = 'Your browser blocked clipboard access; press Cmd+V (Ctrl+V) instead or choose a file.';
const CAPTURE_FAILED = 'We could not capture this screen automatically. Paste or drop a screenshot instead.';

const DEFAULT_ENDPOINTS = { report: '/api/error-report', attachment: '/api/error-report/attachment' };

export interface ReportProblemAvailability {
  canSubmit: boolean;
  message?: string;
  onRetry?: () => void;
  retrying?: boolean;
}

/** Endpoints point at the consumer's own routes, not at the service. */
export interface ReportProblemPanelProps {
  open: boolean;
  onClose: () => void;
  endpoints?: { report?: string; attachment?: string };
  availability?: ReportProblemAvailability;
}

function isImageFile(file: File): boolean {
  return IMAGE_TYPES.includes(file.type);
}

// Screenshot tools differ: some put the image in `files`, some only expose it
// through `items`. Reading both is the difference between Cmd+V working and
// doing nothing at all.
function clipboardFile(data: DataTransfer | null): File | null {
  if (!data) return null;
  const direct = Array.from(data.files ?? [])[0];
  if (direct) return direct;
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind !== 'file') continue;
    const file = item.getAsFile();
    if (file) return file;
  }
  return null;
}

function formatBytes(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))}KB` : `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

interface Shot {
  id: string;
  file: File;
  // Object URL for an image preview; undefined for a document (no thumbnail
  // to render, shown as a filename chip instead).
  previewUrl?: string;
}

function collectReportContext(): ReportContext {
  if (typeof window === 'undefined') return {};
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

function newId(): string {
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
export function ReportProblemPanel({ open, onClose, endpoints, availability }: ReportProblemPanelProps) {
  const report = endpoints?.report ?? DEFAULT_ENDPOINTS.report;
  const attachmentEndpoint = endpoints?.attachment ?? DEFAULT_ENDPOINTS.attachment;

  const [description, setDescription] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [reference, setReference] = useState<string | null>(null);
  const [emailedCopy, setEmailedCopy] = useState(false);
  const [errorHint, setErrorHint] = useState<string | null>(null);
  const [shots, setShots] = useState<Shot[]>([]);
  const [shotError, setShotError] = useState<string | null>(null);
  // The page-as-it-looked-when-clicked capture, awaiting the reporter's
  // explicit consent (never auto-attached, see brainstorm design 2026-09-03).
  const [autoShot, setAutoShot] = useState<Shot | null>(null);
  const [position, setPosition] = useState<Point | null>(null); // null = start centered
  const [dragging, setDragging] = useState(false);
  // Feature-detected after mount rather than at render, so a server render and
  // the first client render agree.
  const [clipboardReadable, setClipboardReadable] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // A paste inside the textarea reaches both React's onPaste and the
  // document-level listener. Marking the native event stops the second one
  // attaching the same file twice.
  const handledPastes = useRef<WeakSet<Event>>(new WeakSet());
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  // One id per open, reused across retries so the service can settle a
  // duplicate rather than filing two reports for one problem.
  const submissionIdRef = useRef<string | null>(null);
  const inFlight = useRef(false);
  const lifetime = useRef<AbortController | null>(null);
  const uploadedIds = useRef(new Map<string, string>());
  const attempted = useRef<{ endpoint: string; body: string; ambiguous: boolean } | null>(null);
  const [unresolved, setUnresolved] = useState(false);
  const [failedFiles, setFailedFiles] = useState(false);
  const latestAvailability = useRef(availability);
  latestAvailability.current = availability;
  const resources = useRef({ shots, autoShot });
  resources.current = { shots, autoShot };
  const locked = state === 'sending' || unresolved;

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    lifetime.current = controller;
    inFlight.current = false;
    attempted.current = null;
    uploadedIds.current.clear();
    setDescription(''); setShots([]); setAutoShot(null); setPosition(null);
    setState('idle'); setUnresolved(false); setFailedFiles(false);
    setErrorHint(null); setShotError(null); setReference(null); setEmailedCopy(false);
    return () => {
      controller.abort();
      revokeShots(resources.current.shots);
      if (resources.current.autoShot?.previewUrl) URL.revokeObjectURL(resources.current.autoShot.previewUrl);
    };
  }, [open]);

  const revokeShots = (list: Shot[]) => list.forEach((s) => { if (s.previewUrl) URL.revokeObjectURL(s.previewUrl); });

  const close = useCallback(() => {
    if (attempted.current && !window.confirm('This report may already have been received. Closing clears your local draft, but does not cancel delivery. Close anyway?')) return;
    lifetime.current?.abort();
    attempted.current = null;
    uploadedIds.current.clear();
    setUnresolved(false);
    // Reset so the next open starts clean.
    setDescription('');
    setState('idle');
    setReference(null);
    setEmailedCopy(false);
    setErrorHint(null);
    setShots((prev) => { revokeShots(prev); return []; });
    setAutoShot((prev) => { if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl); return null; });
    setShotError(null);
    setPosition(null);
    onClose();
  }, [onClose]);

  // Every route in (drop, file picker, Cmd+V, the clipboard button) funnels
  // through here, so the size cap, the type check and the MAX_SHOTS rule are
  // enforced in exactly one place. The last rejection wins the hint; a batch
  // that lands at least one file still clears an earlier error.
  const acceptFiles = useCallback(
    (files: File[]) => {
      if (!files.length || inFlight.current || attempted.current || lifetime.current?.signal.aborted) return;
      const room = MAX_SHOTS - shots.length;
      if (room <= 0) {
        setShotError(`You can attach up to ${MAX_SHOTS} files.`);
        return;
      }
      const accepted: Shot[] = [];
      let hint: string | null = null;
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
      if (accepted.length) setShots((prev) => [...prev, ...accepted]);
    },
    [shots.length]
  );

  const acceptFile = useCallback((f: File | null | undefined) => { if (f) acceptFiles([f]); }, [acceptFiles]);

  const handlePaste = useCallback(
    (e: ClipboardEvent) => {
      if (handledPastes.current.has(e)) return;
      const file = clipboardFile(e.clipboardData);
      if (!file) return; // plain text: leave the paste alone so it lands in the textarea
      handledPastes.current.add(e);
      // A file on the clipboard becomes an attachment, never a wall of binary
      // in the description.
      e.preventDefault();
      acceptFile(file);
    },
    [acceptFile]
  );

  // Paste belongs to the whole panel, not to the textarea. A reporter who has
  // just taken a screenshot presses Cmd+V wherever the cursor happens to be,
  // and before this it silently did nothing (EXPERTTECH-243). An editable
  // element outside the panel keeps its own paste.
  useEffect(() => {
    if (!open) return;
    const onDocumentPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      const insidePanel = !!target && !!panelRef.current && panelRef.current.contains(target);
      const isEditable = !!target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' || target.isContentEditable);
      if (isEditable && !insidePanel) return;
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
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || state === 'sending') return;
      const target = e.target as HTMLElement | null;
      const isEditable = !!target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' || target.isContentEditable);
      if (isEditable) return;
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
    if (!open) return;
    submissionIdRef.current = newId();
    let cancelled = false;
    (async () => {
      try {
        const { default: html2canvas } = await import('html2canvas');
        const convert = createCanvasColorConverter();
        const canvas = await html2canvas(document.body, {
          logging: false,
          useCORS: true,
          // html2canvas cannot parse oklch/lab/color(), which is Tailwind v4's
          // entire default palette. Rewrite them on its own clone before it
          // reads any styles; the live page is untouched.
          onclone: (cloned) => {
            normalizeModernColors(cloned, convert);
          },
          ignoreElements: (el) =>
            el instanceof Element && (el.hasAttribute(PANEL_ROOT_ATTR) || !!el.closest(`[${PANEL_ROOT_ATTR}]`)),
        });
        if (cancelled) return;
        canvas.toBlob((blob) => {
          if (!blob || cancelled) return;
          const file = new File([blob], 'auto-capture.png', { type: 'image/png' });
          setAutoShot({ id: 'auto', file, previewUrl: URL.createObjectURL(blob) });
        }, 'image/png');
      } catch {
        // Capture can still fail: canvas taint from cross-origin content, or a
        // colour we could not convert. Say so. Swallowing this is what let a
        // Tailwind v4 app ship for four days with no auto-capture and no signal
        // to anyone (CLEVERCONN-66).
        if (!cancelled) setShotError(CAPTURE_FAILED);
      }
    })();
    return () => { cancelled = true; };
  }, [open]);

  if (!open) return null;

  const openFilePicker = () => { if (!locked) fileInputRef.current?.click(); };

  // The explicit button exists because right-clicking a div offers no Paste,
  // and a reporter who cannot find Cmd+V has no other way in. Permission can
  // be refused (or the API can be absent behind an insecure origin), so every
  // failure ends as a hint rather than an exception.
  const pasteFromClipboard = async () => {
    if (locked) return;
    const scope = lifetime.current;
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const type = firstAllowedImageType(item.types);
        if (!type) continue;
        const file = clipboardBlobToFile(await item.getType(type));
        if (scope?.signal.aborted || scope !== lifetime.current || attempted.current || inFlight.current) return;
        if (file) {
          acceptFile(file);
          return;
        }
      }
      if (scope?.signal.aborted || scope !== lifetime.current) return;
      setShotError('There was no image on your clipboard. Take a screenshot first, or choose a file.');
    } catch {
      if (!scope?.signal.aborted && scope === lifetime.current) setShotError(CLIPBOARD_BLOCKED);
    }
  };

  const removeShot = (id: string) => {
    if (locked || inFlight.current || attempted.current) return;
    uploadedIds.current.delete(id);
    setShots((prev) => {
      const target = prev.find((s) => s.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((s) => s.id !== id);
    });
  };

  const includeAutoShot = () => {
    if (!autoShot || locked || inFlight.current || attempted.current) return;
    if (shots.length >= MAX_SHOTS) {
      setShotError(`You can attach up to ${MAX_SHOTS} files.`);
      return;
    }
    setShots((prev) => [...prev, autoShot]); // ownership moves to shots, do not revoke its URL here
    setAutoShot(null);
  };

  const discardAutoShot = () => {
    if (locked) return;
    if (autoShot?.previewUrl) URL.revokeObjectURL(autoShot.previewUrl);
    setAutoShot(null);
  };

  // Dragging: measure the panel's real on-screen rect at drag start (valid
  // whether it is still CSS-centered or already pixel-positioned from a prior
  // drag), then clamp every move so a sliver always stays grabbable.
  const onHeaderPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!panelRef.current || !startsDrag(e.target)) return;
    const rect = panelRef.current.getBoundingClientRect();
    dragRef.current = { startX: e.clientX, startY: e.clientY, originX: rect.left, originY: rect.top };
    setDragging(true);
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
  };
  const onHeaderPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current || !panelRef.current) return;
    const rect = panelRef.current.getBoundingClientRect();
    const next = clampPanelPosition(
      {
        x: dragRef.current.originX + (e.clientX - dragRef.current.startX),
        y: dragRef.current.originY + (e.clientY - dragRef.current.startY),
      },
      { width: rect.width, height: rect.height },
      { width: window.innerWidth, height: window.innerHeight }
    );
    setPosition(next);
  };
  const onHeaderPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = null;
    setDragging(false);
    const handle = e.currentTarget as HTMLDivElement;
    if (handle.hasPointerCapture(e.pointerId)) handle.releasePointerCapture(e.pointerId);
  };

  const canSubmit = () => latestAvailability.current?.canSubmit !== false;

  const submit = async () => {
    if (!description.trim() || inFlight.current || !canSubmit() || state === 'sent') return;
    const scope = lifetime.current;
    if (!scope || scope.signal.aborted) return;
    inFlight.current = true;
    setState('sending'); setErrorHint(null);
    const active = () => !scope.signal.aborted && lifetime.current === scope;
    try {
      if (!attempted.current) {
        const payload = buildUserReportPayload(description, collectReportContext());
        if (!payload) { setState('idle'); return; }
        const pending = shots.filter((shot) => !uploadedIds.current.has(shot.id));
        let cursor = 0;
        let failure = false;
        let authorityHint: string | null = null;
        await Promise.all(Array.from({ length: Math.min(3, pending.length) }, async () => {
          while (cursor < pending.length && active()) {
            const shot = pending[cursor++];
            const result = await uploadAttachmentDetailed(attachmentEndpoint, shot.file, fetch, scope.signal);
            if (!active()) return;
            if (result.ok) uploadedIds.current.set(shot.id, result.attachmentId);
            else {
              failure = true;
              if (result.error === 'reporting_disabled') authorityHint = 'Reporting is not enabled for this workspace. Your description is still here.';
              if (result.error === 'unauthorized') authorityHint = 'Please sign in again before sending. Your description is still here.';
            }
          }
        }));
        if (!active()) return;
        setFailedFiles(failure);
        if (failure) {
          setShotError("Some attachments couldn't be uploaded. Retry them or remove them before sending.");
          setErrorHint(authorityHint); setState('error'); return;
        }
        setShotError(null);
        if (!canSubmit()) { setState('idle'); return; }
        const attachmentIds = shots.map((shot) => uploadedIds.current.get(shot.id)!);
        attempted.current = { endpoint: report, ambiguous: false, body: JSON.stringify({ ...payload, submission_id: submissionIdRef.current, attachment_ids: attachmentIds }) };
        setUnresolved(true);
      }
      const attempt = attempted.current;
      const { res, body } = await withRequestDeadline(REPORT_TIMEOUT_MS, scope.signal, async (signal) => {
        const res = await fetch(attempt.endpoint, {
          method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: attempt.body, signal,
        });
        const body = await res.json().catch(() => null);
        return { res, body };
      });
      if (!active()) return;
      const proof = (value: unknown): value is string => typeof value === 'string' && !!value.trim();
      if (res.ok && body?.ok === true && body.filed === true && (proof(body.ref) || proof(body.reportId))
        && (body.ref == null || proof(body.ref)) && (body.reportId == null || proof(body.reportId))) {
        setReference(body.ref ?? body.reportId);
        setEmailedCopy(body?.delivered?.reporter_copy === true);
        attempted.current = null; setUnresolved(false); setState('sent'); return;
      }
      const definitive = (res.status === 401 && body?.error === 'unauthorized')
        || (res.status === 403 && body?.error === 'reporting_disabled')
        || (res.status === 503 && body?.error === 'service_unavailable')
        || (res.status === 429 && body?.error === 'rate_limited');
      if (definitive && !attempt.ambiguous) { attempted.current = null; setUnresolved(false); }
      else attempt.ambiguous = true;
      setErrorHint(res.status === 429 ? "You've sent a few reports just now. Give it a minute and try again."
        : res.status === 403 && body?.error === 'reporting_disabled' ? 'Reporting is not enabled for this workspace. Your description is still here.'
        : res.status === 401 ? 'Please sign in again before sending. Your description is still here.'
        : "We couldn't send that just now. Your description is still here. Please try again.");
      setState('error');
    } catch {
      if (active()) {
        if (attempted.current) attempted.current.ambiguous = true;
        setErrorHint("We couldn't send that just now. Your description is still here. Please try again.");
        setState('error');
      }
    } finally {
      if (active()) inFlight.current = false;
    }
  };

  const trimmedEmpty = description.trim().length === 0;
  const panelStyle: React.CSSProperties = position
    ? { left: position.x, top: position.y, transform: 'none' }
    : {};
  const nudgeForShot = needsScreenshot(description) && shots.length === 0;

  return (
    <div
      ref={panelRef}
      {...{ [PANEL_ROOT_ATTR]: 'true' }}
      className={dragging ? 'rap-panel rap-panel--dragging' : 'rap-panel'}
      style={panelStyle}
      role="dialog"
      aria-modal="false"
      aria-label="Report a problem"
      data-testid="report-problem-panel"
    >
      <div
        className="rap-handle"
        onPointerDown={onHeaderPointerDown}
        onPointerMove={onHeaderPointerMove}
        onPointerUp={onHeaderPointerUp}
        data-testid="report-drag-handle"
      >
        <div className="rap-handle-left">
          <GripHorizontal className="rap-icon rap-icon--faint" />
          <Bug className="rap-icon" />
          <h2 className="rap-title">Report a problem</h2>
        </div>
        <button onClick={close} disabled={state === 'sending'} aria-label="Close" className="rap-icon-btn">
          <X className="rap-icon" />
        </button>
      </div>

      <div className="rap-body">
        {state !== 'sent' && (availability?.message || availability?.canSubmit === false) ? (
          <div className="rap-consent" role="status" aria-live="polite" data-testid="report-availability">
            <p className="rap-hint">{availability.message ?? 'Reporting is temporarily unavailable. Your description will stay here while you retry.'}</p>
            {availability.onRetry ? <button type="button" className="rap-btn rap-btn--small" onClick={availability.onRetry} disabled={availability.retrying === true}>
              {availability.retrying ? 'Retrying…' : 'Retry connection'}
            </button> : null}
          </div>
        ) : null}
        {state === 'sent' ? (
          <div className="rap-success" data-testid="report-sent">
            <CheckCircle2 className="rap-icon" />
            <div>
              <p className="rap-success-title">Thanks, the team has it.</p>
              {reference ? (
                <p className="rap-success-ref">
                  Your reference is <span className="rap-ref">{reference}</span>.
                </p>
              ) : null}
              <p className="rap-hint">
                {emailedCopy
                  ? "We've emailed you a copy, just reply or forward it to follow up."
                  : 'You can quote this reference if you follow up with the team.'}
              </p>
            </div>
          </div>
        ) : (
          <>
            <p className="rap-hint">Your draft stays here while this panel is open. Closing, reloading, signing out or switching accounts or workspaces clears it.</p>
            {unresolved ? <p className="rap-hint" role="status">This report may already have been received. Retry sends the same report; editing is locked until its result is confirmed.</p> : null}
            <label htmlFor="rap-report-text" className="rap-label">
              Tell us what went wrong. The team gets this with the page you were
              on so they can look into it. Drag this panel by its title bar if
              it&apos;s in your way, the page underneath stays usable.
            </label>
            <textarea
              id="rap-report-text"
              data-testid="report-text"
              autoFocus
              value={description}
              maxLength={TECHNICAL_MAX}
              onChange={(e) => setDescription(e.target.value)}
              onPaste={(e) => handlePaste(e.nativeEvent)}
              disabled={locked}
              rows={5}
              placeholder="e.g. I clicked Generate and nothing happened for a few minutes."
              className="rap-textarea"
            />
            <div className="rap-counter">
              <span className={description.length > TECHNICAL_MAX * 0.9 ? 'rap-hint rap-hint--warn' : 'rap-hint'}>
                {description.length}/{TECHNICAL_MAX}
              </span>
              {errorHint ? (
                <span className="rap-error" data-testid="report-error">
                  {errorHint}
                </span>
              ) : null}
            </div>

            {autoShot ? (
              <div className="rap-consent" data-testid="report-auto-shot">
                <img src={autoShot.previewUrl ?? ''} alt="Screen as you clicked Report a problem" className="rap-consent-thumb" />
                <div className="rap-consent-copy">
                  <p className="rap-consent-title">We grabbed the page as you opened this.</p>
                  <p className="rap-hint">Only visible if you choose to include it.</p>
                </div>
                <div className="rap-consent-actions">
                  <button type="button" disabled={locked} onClick={includeAutoShot} data-testid="report-auto-shot-include" className="rap-btn rap-btn--primary rap-btn--small">
                    Include
                  </button>
                  <button type="button" disabled={locked} onClick={discardAutoShot} data-testid="report-auto-shot-discard" className="rap-btn rap-btn--small">
                    Discard
                  </button>
                </div>
              </div>
            ) : null}

            <div
              role="button"
              tabIndex={locked ? -1 : 0}
              aria-disabled={locked}
              aria-label="Add a screenshot or file. Click to choose a file, or paste one with Cmd+V."
              onClick={openFilePicker}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' && e.key !== ' ') return;
                e.preventDefault(); // Space would otherwise scroll the panel body
                openFilePicker();
              }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                acceptFiles(Array.from(e.dataTransfer.files));
              }}
              className={nudgeForShot ? 'rap-dropzone rap-dropzone--active' : 'rap-dropzone'}
              data-testid="report-shot-zone"
            >
              <input
                ref={fileInputRef}
                type="file"
                disabled={locked}
                multiple
                accept={ACCEPT}
                tabIndex={-1}
                aria-hidden="true"
                className="rap-file-input"
                data-testid="report-file-input"
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => {
                  acceptFiles(Array.from(e.target.files ?? []));
                  e.target.value = ''; // so picking the same file twice still fires change
                }}
              />
              {shots.length > 0 ? (
                <div className="rap-shots">
                  {shots.map((s) =>
                    s.previewUrl ? (
                      <div key={s.id} className="rap-shot">
                        <img src={s.previewUrl} alt="Screenshot to send" className="rap-shot-img" />
                        <button
                          type="button"
                          disabled={locked}
                          onClick={(e) => { e.stopPropagation(); removeShot(s.id); }}
                          aria-label={`Remove ${s.file.name || 'screenshot'}`}
                          className="rap-shot-remove"
                        >
                          <Trash2 className="rap-icon rap-icon--tiny" />
                        </button>
                      </div>
                    ) : (
                      <div key={s.id} className="rap-shot rap-shot--file">
                        <FileText className="rap-icon rap-icon--faint" />
                        <div className="rap-shot-meta">
                          <p className="rap-shot-name">{s.file.name || 'file'}</p>
                          <p className="rap-shot-size">{formatBytes(s.file.size)}</p>
                        </div>
                        <button
                          type="button"
                          disabled={locked}
                          onClick={(e) => { e.stopPropagation(); removeShot(s.id); }}
                          aria-label={`Remove ${s.file.name || 'file'}`}
                          className="rap-shot-remove"
                        >
                          <Trash2 className="rap-icon rap-icon--tiny" />
                        </button>
                      </div>
                    )
                  )}
                </div>
              ) : null}
              <div className="rap-dropzone-copy">
                <ImagePlus className="rap-icon rap-icon--faint" />
                <p className="rap-dropzone-title">
                  {nudgeForShot
                    ? 'A screenshot would really help here'
                    : shots.length >= MAX_SHOTS
                      ? `Up to ${MAX_SHOTS} files`
                      : 'Add a screenshot or file (optional)'}
                </p>
                <p className="rap-hint">
                  Click to choose a file, drop one here, or paste a screenshot with
                  Cmd+V (Ctrl+V on Windows). Screenshots, PDFs, text, Word or Excel,
                  up to {MAX_SHOTS} files.
                </p>
              </div>
              {clipboardReadable ? (
                <div className="rap-dropzone-actions">
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); void pasteFromClipboard(); }}
                    disabled={locked}
                    data-testid="report-clipboard-paste"
                    className="rap-btn rap-btn--small"
                  >
                    <ClipboardPaste className="rap-icon rap-icon--tiny" />
                    Paste from clipboard
                  </button>
                </div>
              ) : null}
              {shotError ? <p className="rap-error">{shotError}</p> : null}
            </div>
          </>
        )}
      </div>

      <div className="rap-footer">
        {state === 'sent' ? (
          <button onClick={close} className="rap-btn rap-btn--primary">
            Done
          </button>
        ) : (
          <>
            <button onClick={close} disabled={state === 'sending'} className="rap-btn">
              Cancel
            </button>
            <button onClick={submit} disabled={state === 'sending' || trimmedEmpty || availability?.canSubmit === false} data-testid="report-send" className="rap-btn rap-btn--primary">
              {state === 'sending' ? <Loader2 className="rap-icon rap-icon--spin" /> : <Send className="rap-icon" />}
              {state === 'sending' ? 'Sending…' : unresolved ? 'Retry same report' : failedFiles ? 'Retry attachments and send' : 'Send'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/** Default as well as named, because `React.lazy` accepts only a default export. */
export default ReportProblemPanel;
