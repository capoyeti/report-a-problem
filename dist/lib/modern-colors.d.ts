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
export declare const COLOR_PROPERTIES: readonly ["color", "backgroundColor", "borderTopColor", "borderRightColor", "borderBottomColor", "borderLeftColor", "outlineColor", "textDecorationColor", "columnRuleColor", "caretColor", "fill", "stroke", "webkitTextStrokeColor"];
/**
 * Computed properties whose value can hold several colours among other tokens:
 * gradient stops, and one colour per shadow layer. Each colour function inside
 * the value is converted in place. Tailwind v4 puts oklab/lab colours here via
 * `from-*`/`to-*` gradients and `ring-*` or `shadow-*` with an opacity modifier.
 */
export declare const COMPOUND_COLOR_PROPERTIES: readonly ["backgroundImage", "boxShadow", "textShadow"];
export type ColorConverter = (value: string) => string | null;
/**
 * Replaces every modern colour function inside a compound value, such as a
 * gradient or a multi-layer shadow, with its sRGB equivalent. Nested functions
 * like `color-mix(in oklab, oklch(...) 50%, ...)` are converted as one unit.
 * Returns the value unchanged when it holds no modern colour, and null when any
 * one of them fails to convert, so the caller never writes a half-fixed value.
 */
export declare function replaceColorFunctions(value: string, convert: ColorConverter): string | null;
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
 * its `onclone` hook; never the live one. By then html2canvas has already
 * turned ::before/::after into real child elements, so the element walk covers
 * pseudo-element content too.
 *
 * The converter is injected so the walk can be tested without a canvas.
 */
export declare function normalizeModernColors(doc: Document, convert: ColorConverter): number;
