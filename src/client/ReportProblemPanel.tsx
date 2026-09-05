'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { X, Send, CheckCircle2, Loader2, Bug, ImagePlus, Trash2, GripHorizontal, FileText } from 'lucide-react';
import { buildUserReportPayload, TECHNICAL_MAX, type ReportContext } from '../lib/report-payload.js';
import { needsScreenshot } from '../lib/needs-screenshot.js';
import { clampPanelPosition, type Point } from '../lib/panel-position.js';
import { uploadAttachment } from './upload.js';

// Marks the panel's own DOM subtree so the auto-capture (html2canvas over
// document.body) can exclude it. The shot must show what was BEHIND the
// panel, never the panel itself.
const PANEL_ROOT_ATTR = 'data-report-panel-root';
const MAX_SHOTS = 6;
const MAX_BYTES = 8 * 1024 * 1024;
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const DOC_TYPES = [
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
];
const ALLOWED_TYPES = [...IMAGE_TYPES, ...DOC_TYPES];

const DEFAULT_ENDPOINTS = { report: '/api/error-report', attachment: '/api/error-report/attachment' };

export interface ReportProblemPanelProps {
  open: boolean;
  onClose: () => void;
  endpoints?: { report?: string; attachment?: string };
}

function isImageFile(file: File): boolean {
  return IMAGE_TYPES.includes(file.type);
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
export function ReportProblemPanel({ open, onClose, endpoints }: ReportProblemPanelProps) {
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
  const panelRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  // One id per open, reused across retries so the service can settle a
  // duplicate rather than filing two reports for one problem.
  const submissionIdRef = useRef<string | null>(null);

  const revokeShots = (list: Shot[]) => list.forEach((s) => { if (s.previewUrl) URL.revokeObjectURL(s.previewUrl); });

  const close = useCallback(() => {
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
        const canvas = await html2canvas(document.body, {
          logging: false,
          useCORS: true,
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
        // DOM capture can fail (canvas taint from cross-origin content, etc).
        // The manual paste/drop path below still works, never block on this.
      }
    })();
    return () => { cancelled = true; };
  }, [open]);

  if (!open) return null;

  const acceptFile = (f: File | undefined) => {
    if (!f) return;
    if (shots.length >= MAX_SHOTS) {
      setShotError(`You can attach up to ${MAX_SHOTS} files.`);
      return;
    }
    if (!ALLOWED_TYPES.includes(f.type)) {
      setShotError('That file type is not supported. Use a PNG/JPG/WebP screenshot, a PDF, a text/CSV file, or a Word/Excel doc.');
      return;
    }
    if (f.size > MAX_BYTES) {
      setShotError(`That file is over ${formatBytes(MAX_BYTES)}.`);
      return;
    }
    setShotError(null);
    setShots((prev) => [...prev, { id: newId(), file: f, previewUrl: isImageFile(f) ? URL.createObjectURL(f) : undefined }]);
  };

  const removeShot = (id: string) => {
    setShots((prev) => {
      const target = prev.find((s) => s.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((s) => s.id !== id);
    });
  };

  const includeAutoShot = () => {
    if (!autoShot) return;
    if (shots.length >= MAX_SHOTS) {
      setShotError(`You can attach up to ${MAX_SHOTS} files.`);
      return;
    }
    setShots((prev) => [...prev, autoShot]); // ownership moves to shots, do not revoke its URL here
    setAutoShot(null);
  };

  const discardAutoShot = () => {
    if (autoShot?.previewUrl) URL.revokeObjectURL(autoShot.previewUrl);
    setAutoShot(null);
  };

  // Dragging: measure the panel's real on-screen rect at drag start (valid
  // whether it is still CSS-centered or already pixel-positioned from a prior
  // drag), then clamp every move so a sliver always stays grabbable.
  const onHeaderPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!panelRef.current) return;
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
    (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
  };

  const submit = async () => {
    // Cheap guard first: never upload files on an empty report. The Send button
    // is disabled when the text is empty, so this is belt-and-braces rather
    // than a reachable path.
    if (!description.trim()) return;

    setState('sending');
    setErrorHint(null);

    const ctx = collectReportContext();

    // Sign and upload every accumulated attachment first so their ids can ride
    // in the report body. A failed upload never blocks the report, it just
    // drops that one file rather than losing the whole report.
    const attachmentIds = shots.length
      ? (await Promise.all(shots.map((s) => uploadAttachment(attachmentEndpoint, s.file)))).filter((id): id is string => !!id)
      : [];

    const payload = buildUserReportPayload(description, ctx);
    if (!payload) { setState('idle'); return; }
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
      setErrorHint(
        res.status === 429
          ? "You've sent a few reports just now. Give it a minute and try again."
          : "We couldn't send that just now. Please try again."
      );
      setState('error');
    } catch {
      setErrorHint("We couldn't send that just now. Please try again.");
      setState('error');
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
              onPaste={(e) => acceptFile(Array.from(e.clipboardData.files)[0])}
              disabled={state === 'sending'}
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
                  <button type="button" onClick={includeAutoShot} data-testid="report-auto-shot-include" className="rap-btn rap-btn--primary rap-btn--small">
                    Include
                  </button>
                  <button type="button" onClick={discardAutoShot} data-testid="report-auto-shot-discard" className="rap-btn rap-btn--small">
                    Discard
                  </button>
                </div>
              </div>
            ) : null}

            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                acceptFile(Array.from(e.dataTransfer.files)[0]);
              }}
              className={nudgeForShot ? 'rap-dropzone rap-dropzone--active' : 'rap-dropzone'}
              data-testid="report-shot-zone"
            >
              {shots.length > 0 ? (
                <div className="rap-shots">
                  {shots.map((s) =>
                    s.previewUrl ? (
                      <div key={s.id} className="rap-shot">
                        <img src={s.previewUrl} alt="Screenshot to send" className="rap-shot-img" />
                        <button
                          type="button"
                          onClick={() => removeShot(s.id)}
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
                          onClick={() => removeShot(s.id)}
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
                  Press Cmd+Ctrl+Shift+4 (or PrtScn), then paste with Cmd+V. Drag this
                  panel out of the way first if it&apos;s covering what you want to capture.
                  You can also drop files here, screenshots, PDFs, text, Word or Excel,
                  and add as many as you need before sending.
                </p>
              </div>
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
            <button onClick={submit} disabled={state === 'sending' || trimmedEmpty} data-testid="report-send" className="rap-btn rap-btn--primary">
              {state === 'sending' ? <Loader2 className="rap-icon rap-icon--spin" /> : <Send className="rap-icon" />}
              {state === 'sending' ? 'Sending…' : 'Send'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default ReportProblemPanel;
