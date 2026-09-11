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
export const MODERN_COLOR_FUNCTION = /\b(?:oklch|oklab|lab|lch|hwb|color|color-mix)\(/i;
/**
 * Computed properties worth rewriting. Longhand only: reading a shorthand such
 * as `border` back from `getComputedStyle` returns an empty string in Chrome,
 * so a shorthand here would silently normalise nothing.
 */
export const COLOR_PROPERTIES = [
    'color',
    'backgroundColor',
    'borderTopColor',
    'borderRightColor',
    'borderBottomColor',
    'borderLeftColor',
    'outlineColor',
    'textDecorationColor',
    'columnRuleColor',
    'caretColor',
    'fill',
    'stroke',
];
/**
 * Converts any colour the browser understands into `rgb()`/`rgba()`, by painting
 * one pixel and reading the bytes back.
 *
 * Reading `ctx.fillStyle` back is the obvious approach and does not work:
 * current Chrome preserves the authored colour space, so assigning `oklch(...)`
 * returns `oklch(...)` unchanged. Rasterising is what forces a real sRGB value.
 */
export function createCanvasColorConverter() {
    const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    if (!ctx)
        return () => null;
    ctx.canvas.width = 1;
    ctx.canvas.height = 1;
    return (value) => {
        try {
            ctx.clearRect(0, 0, 1, 1);
            // An unparseable value leaves fillStyle at the previous assignment rather
            // than throwing, so seed a known sentinel and treat it as a failure.
            ctx.fillStyle = '#000000';
            ctx.fillStyle = value;
            if (ctx.fillStyle === '#000000' && !/^#0{3,8}$|\bblack\b/i.test(value.trim()))
                return null;
            ctx.fillRect(0, 0, 1, 1);
            const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
            return a === 255 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(3)})`;
        }
        catch {
            return null;
        }
    };
}
/**
 * Rewrites every modern colour declaration in `doc` to its sRGB equivalent and
 * returns how many were changed. Pass this html2canvas's cloned document from
 * its `onclone` hook; never the live one.
 *
 * The converter is injected so the walk can be tested without a canvas.
 */
export function normalizeModernColors(doc, convert) {
    const view = doc.defaultView;
    if (!view)
        return 0;
    let changed = 0;
    for (const element of Array.from(doc.querySelectorAll('*'))) {
        let computed;
        try {
            computed = view.getComputedStyle(element);
        }
        catch {
            continue;
        }
        for (const property of COLOR_PROPERTIES) {
            const value = computed[property];
            if (typeof value !== 'string' || !MODERN_COLOR_FUNCTION.test(value))
                continue;
            const rgb = convert(value);
            // A colour we cannot convert is left alone deliberately: html2canvas will
            // throw on it, the caller reports that, and the reporter attaches a file
            // by hand. Guessing a replacement would put a wrong colour in evidence.
            if (rgb) {
                element.style.setProperty(cssName(property), rgb, 'important');
                changed++;
            }
        }
    }
    return changed;
}
function cssName(property) {
    return property.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}
