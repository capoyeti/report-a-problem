export interface Point {
    x: number;
    y: number;
}
export interface Size {
    width: number;
    height: number;
}
export declare function clampPanelPosition(pos: Point, panel: Size, viewport: Size): Point;
