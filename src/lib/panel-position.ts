// src/lib/panel-position.ts

/** Viewport pixel coordinates of the panel's top-left corner, not a translate offset. */
export interface Point {
  x: number;
  y: number;
}

/** On-screen dimensions of an element, as measured rather than as declared in CSS. */
export interface Size {
  width: number;
  height: number;
}

const MIN_VISIBLE = 40;

/**
 * Keeps at least a grabbable sliver of the panel on-screen on every axis. Without
 * this a drag can park the panel entirely outside the viewport, and because the
 * panel is its own drag handle there is then no way to bring it back short of a
 * reload, which loses a half-written report.
 */
export function clampPanelPosition(pos: Point, panel: Size, viewport: Size): Point {
  const maxX = viewport.width - MIN_VISIBLE;
  const maxY = viewport.height - MIN_VISIBLE;
  const minX = MIN_VISIBLE - panel.width;
  const minY = MIN_VISIBLE - panel.height;
  return {
    x: Math.min(Math.max(pos.x, minX), maxX),
    y: Math.min(Math.max(pos.y, minY), maxY),
  };
}

/**
 * Whether a pointerdown on the drag handle should start a drag. Controls inside
 * the handle are excluded: capturing the pointer for a drag retargets pointerup
 * to the handle, and the Close button then never gets its click.
 */
export function startsDrag(target: EventTarget | null): boolean {
  if (typeof Element === 'undefined' || !(target instanceof Element)) return false;
  return !target.closest('button, a, input, textarea, select, [role="button"]');
}
