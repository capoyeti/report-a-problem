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
  // html2canvas 1.4.1 parses this for every text node, including on the
  // elements it builds for ::before/::after. Chrome computes it from `color`,
  // so any Tailwind text colour reaches it (CLEVERCONN-66 follow-up).
  'webkitTextStrokeColor',
] as const;

/**
 * Computed properties whose value can hold several colours among other tokens:
 * gradient stops, and one colour per shadow layer. Each colour function inside
 * the value is converted in place. Tailwind v4 puts oklab/lab colours here via
 * `from-*`/`to-*` gradients and `ring-*` or `shadow-*` with an opacity modifier.
 */
export const COMPOUND_COLOR_PROPERTIES = ['backgroundImage', 'boxShadow', 'textShadow'] as const;

export type ColorConverter = (value: string) => string | null;

// `url(` is matched only so its contents can be skipped: a path such as
// `/lab(1).png` must not be mistaken for a colour.
const FUNCTION_TOKEN = /\b(?:url|oklch|oklab|lab|lch|hwb|color|color-mix)\(/gi;

/**
 * Replaces every modern colour function inside a compound value, such as a
 * gradient or a multi-layer shadow, with its sRGB equivalent. Nested functions
 * like `color-mix(in oklab, oklch(...) 50%, ...)` are converted as one unit.
 * Returns the value unchanged when it holds no modern colour, and null when any
 * one of them fails to convert, so the caller never writes a half-fixed value.
 */
export function replaceColorFunctions(value: string, convert: ColorConverter): string | null {
  let out = '';
  let last = 0;
  FUNCTION_TOKEN.lastIndex = 0;
  for (let match = FUNCTION_TOKEN.exec(value); match; match = FUNCTION_TOKEN.exec(value)) {
    const end = closingParen(value, match.index + match[0].length - 1);
    // Unbalanced parentheses: not a value we understand, so do not touch it.
    if (end < 0) return null;
    FUNCTION_TOKEN.lastIndex = end + 1;
    if (match[0].toLowerCase() === 'url(') continue;
    const rgb = convert(value.slice(match.index, end + 1));
    if (!rgb) return null;
    out += value.slice(last, match.index) + rgb;
    last = end + 1;
  }
  return last === 0 ? value : out + value.slice(last);
}

function closingParen(value: string, open: number): number {
  let depth = 0;
  let quote = '';
  for (let i = open; i < value.length; i++) {
    const c = value[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = '';
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '(') depth++;
    else if (c === ')' && --depth === 0) return i;
  }
  return -1;
}

/**
 * Converts any colour the browser understands into `rgb()`/`rgba()`, by painting
 * one pixel and reading the bytes back.
 *
 * Reading `ctx.fillStyle` back is the obvious approach and does not work:
 * current Chrome preserves the authored colour space, so assigning `oklch(...)`
 * returns `oklch(...)` unchanged. Rasterising is what forces a real sRGB value.
 */
export function createCanvasColorConverter(): ColorConverter {
  const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  if (!ctx) return () => null;
  ctx.canvas.width = 1;
  ctx.canvas.height = 1;

  return (value: string): string | null => {
    try {
      ctx.clearRect(0, 0, 1, 1);
      // An unparseable value leaves fillStyle at the previous assignment rather
      // than throwing, so seed a known sentinel and treat it as a failure.
      ctx.fillStyle = '#000000';
      ctx.fillStyle = value;
      if (ctx.fillStyle === '#000000' && !/^#0{3,8}$|\bblack\b/i.test(value.trim())) return null;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
      return a === 255 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(3)})`;
    } catch {
      return null;
    }
  };
}

/**
 * Rewrites every modern colour declaration in `doc` to its sRGB equivalent and
 * returns how many were changed. Pass this html2canvas's cloned document from
 * its `onclone` hook; never the live one. By then html2canvas has already
 * turned ::before/::after into real child elements, so the element walk covers
 * pseudo-element content too.
 *
 * The converter is injected so the walk can be tested without a canvas.
 */
export function normalizeModernColors(doc: Document, convert: ColorConverter): number {
  const view = doc.defaultView;
  if (!view) return 0;

  let changed = 0;
  for (const element of Array.from(doc.querySelectorAll<HTMLElement>('*'))) {
    let computed: CSSStyleDeclaration;
    try {
      computed = view.getComputedStyle(element);
    } catch {
      continue;
    }
    for (const property of COLOR_PROPERTIES) {
      const value = computed[property as unknown as number] as unknown as string;
      if (typeof value !== 'string' || !MODERN_COLOR_FUNCTION.test(value)) continue;
      const rgb = convert(value);
      // A colour we cannot convert is left alone deliberately: html2canvas will
      // throw on it, the caller reports that, and the reporter attaches a file
      // by hand. Guessing a replacement would put a wrong colour in evidence.
      if (rgb) {
        element.style.setProperty(cssName(property), rgb, 'important');
        changed++;
      }
    }
    for (const property of COMPOUND_COLOR_PROPERTIES) {
      const value = computed[property as unknown as number] as unknown as string;
      if (typeof value !== 'string' || !MODERN_COLOR_FUNCTION.test(value)) continue;
      const next = replaceColorFunctions(value, convert);
      if (next && next !== value) {
        element.style.setProperty(cssName(property), next, 'important');
        changed++;
      }
    }
  }
  return changed;
}

function cssName(property: string): string {
  const name = property.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
  // `webkitTextStrokeColor` is the CSSOM name for `-webkit-text-stroke-color`.
  return name.startsWith('webkit-') ? `-${name}` : name;
}
