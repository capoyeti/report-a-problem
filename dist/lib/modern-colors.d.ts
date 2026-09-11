/**
 * html2canvas 1.4.1 reimplements CSS colour parsing in JavaScript and supports
 * only `rgb`, `rgba`, `hsl` and `hsla`. Anything else throws
 * `Attempting to parse an unsupported color function`, and because the capture
 * runs over `document.body`, a single modern colour anywhere on the page kills
 * the whole screenshot. Tailwind v4 emits `oklch()` for its entire default
 * palette, so every Tailwind v4 consumer loses auto-capture outright. This
 * module rewrites those declarations to `rgb()` on html2canvas's own cloned
 * document, which is throwaway, so the live page is never touched.
 */
/** Colour functions html2canvas 1.4.1 cannot parse. `rgb`/`hsl` are fine and stay. */
export declare const MODERN_COLOR_FUNCTION: RegExp;
/**
 * Computed properties worth rewriting. Longhand only: reading a shorthand such
 * as `border` back from `getComputedStyle` returns an empty string in Chrome,
 * so a shorthand here would silently normalise nothing.
 */
export declare const COLOR_PROPERTIES: readonly ["color", "backgroundColor", "borderTopColor", "borderRightColor", "borderBottomColor", "borderLeftColor", "outlineColor", "textDecorationColor", "columnRuleColor", "caretColor", "fill", "stroke"];
export type ColorConverter = (value: string) => string | null;
/**
 * Converts any colour the browser understands into `rgb()`/`rgba()`, by painting
 * one pixel and reading the bytes back.
 *
 * Reading `ctx.fillStyle` back is the obvious approach and does not work:
 * current Chrome preserves the authored colour space, so assigning `oklch(...)`
 * returns `oklch(...)` unchanged. Rasterising is what forces a real sRGB value.
 */
export declare function createCanvasColorConverter(): ColorConverter;
/**
 * Rewrites every modern colour declaration in `doc` to its sRGB equivalent and
 * returns how many were changed. Pass this html2canvas's cloned document from
 * its `onclone` hook; never the live one.
 *
 * The converter is injected so the walk can be tested without a canvas.
 */
export declare function normalizeModernColors(doc: Document, convert: ColorConverter): number;
