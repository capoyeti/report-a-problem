// src/lib/panel-position.ts
const MIN_VISIBLE = 40;
/**
 * Keeps at least a grabbable sliver of the panel on-screen on every axis. Without
 * this a drag can park the panel entirely outside the viewport, and because the
 * panel is its own drag handle there is then no way to bring it back short of a
 * reload, which loses a half-written report.
 */
export function clampPanelPosition(pos, panel, viewport) {
    const maxX = viewport.width - MIN_VISIBLE;
    const maxY = viewport.height - MIN_VISIBLE;
    const minX = MIN_VISIBLE - panel.width;
    const minY = MIN_VISIBLE - panel.height;
    return {
        x: Math.min(Math.max(pos.x, minX), maxX),
        y: Math.min(Math.max(pos.y, minY), maxY),
    };
}
