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
/**
 * Keeps at least a grabbable sliver of the panel on-screen on every axis. Without
 * this a drag can park the panel entirely outside the viewport, and because the
 * panel is its own drag handle there is then no way to bring it back short of a
 * reload, which loses a half-written report.
 */
export declare function clampPanelPosition(pos: Point, panel: Size, viewport: Size): Point;
