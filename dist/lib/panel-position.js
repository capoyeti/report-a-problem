// src/lib/panel-position.ts
//
// Pure clamp for the draggable "Report a problem" panel: keeps at least
// MIN_VISIBLE px of the panel on-screen on every axis so a drag can never
// lose the panel off-viewport with no way to bring it back.
const MIN_VISIBLE = 40;
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
