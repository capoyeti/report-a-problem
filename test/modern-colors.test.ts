import { describe, expect, it, vi } from 'vitest';
import {
  COLOR_PROPERTIES,
  COMPOUND_COLOR_PROPERTIES,
  MODERN_COLOR_FUNCTION,
  normalizeModernColors,
  replaceColorFunctions,
  type ColorConverter,
} from '../src/lib/modern-colors.js';

/**
 * The canvas converter needs a real browser, so these cover the walk: which
 * declarations get rewritten, which are left alone, and what happens when a
 * conversion fails. `scripts/report-panel-verify.ts` covers the browser half.
 */

function fakeDoc(elements: Array<Record<string, string>>): Document {
  const made = elements.map((computed) => {
    const applied: Record<string, string> = {};
    return {
      node: {
        style: { setProperty: (name: string, value: string) => { applied[name] = value; } },
      },
      computed,
      applied,
    };
  });
  const doc = {
    querySelectorAll: () => made.map((m) => m.node),
    defaultView: {
      getComputedStyle: (node: unknown) => made.find((m) => m.node === node)!.computed,
    },
  };
  return Object.assign(doc as unknown as Document, { __made: made });
}

const applied = (doc: Document) =>
  (doc as unknown as { __made: Array<{ applied: Record<string, string> }> }).__made.map((m) => m.applied);

const toRgb: ColorConverter = () => 'rgb(219, 234, 254)';

describe('MODERN_COLOR_FUNCTION', () => {
  it.each(['oklch(0.9 0.03 255)', 'lab(60% 40 30)', 'color(display-p3 0.2 0.7 0.5)', 'color-mix(in oklab, red, blue)'])(
    'matches %s',
    (value) => expect(MODERN_COLOR_FUNCTION.test(value)).toBe(true),
  );

  it.each(['rgb(1, 2, 3)', 'rgba(1, 2, 3, 0.5)', 'hsl(200 50% 50%)', '#aabbcc', 'transparent'])(
    'leaves %s alone',
    (value) => expect(MODERN_COLOR_FUNCTION.test(value)).toBe(false),
  );
});

describe('normalizeModernColors', () => {
  it('rewrites a modern colour and reports the count', () => {
    const doc = fakeDoc([{ backgroundColor: 'oklch(0.932 0.032 255.585)', color: 'rgb(0, 0, 0)' }]);
    expect(normalizeModernColors(doc, toRgb)).toBe(1);
    expect(applied(doc)[0]).toEqual({ 'background-color': 'rgb(219, 234, 254)' });
  });

  it('camelCase properties become CSS names', () => {
    const doc = fakeDoc([{ borderTopColor: 'lab(60% 40 30)' }]);
    normalizeModernColors(doc, toRgb);
    expect(Object.keys(applied(doc)[0])).toEqual(['border-top-color']);
  });

  it('leaves a colour alone when conversion fails, rather than guessing', () => {
    const doc = fakeDoc([{ color: 'oklch(0.4 0.1 20)' }]);
    expect(normalizeModernColors(doc, () => null)).toBe(0);
    expect(applied(doc)[0]).toEqual({});
  });

  it('never calls the converter for colours html2canvas already parses', () => {
    const convert = vi.fn(toRgb);
    normalizeModernColors(fakeDoc([{ color: 'rgb(1, 2, 3)', backgroundColor: 'hsl(200 50% 50%)' }]), convert);
    expect(convert).not.toHaveBeenCalled();
  });

  it('covers every declared property', () => {
    const one = Object.fromEntries(
      [...COLOR_PROPERTIES, ...COMPOUND_COLOR_PROPERTIES].map((p) => [p, 'oklch(0.9 0.03 255)']),
    );
    expect(normalizeModernColors(fakeDoc([one]), toRgb)).toBe(
      COLOR_PROPERTIES.length + COMPOUND_COLOR_PROPERTIES.length,
    );
  });

  it('writes the vendor-prefixed stroke colour under its real CSS name', () => {
    // The /dashboard repro: html2canvas threw on `lab(...)` here, on an icon and
    // on the elements it builds for ::before/::after.
    const doc = fakeDoc([{ webkitTextStrokeColor: 'lab(56.1 26.2 63.9)' }]);
    normalizeModernColors(doc, toRgb);
    expect(applied(doc)[0]).toEqual({ '-webkit-text-stroke-color': 'rgb(219, 234, 254)' });
  });

  it('rewrites each colour inside a gradient and a shadow', () => {
    const doc = fakeDoc([
      {
        backgroundImage: 'linear-gradient(to right, oklch(0.585 0.233 277.117) 0%, oklch(0.627 0.265 303.9) 100%)',
        boxShadow: 'oklab(0.7 -0.1 0.1 / 0.3) 0px 0px 0px 2px, rgba(0, 0, 0, 0) 0px 0px 0px 0px',
      },
    ]);
    expect(normalizeModernColors(doc, toRgb)).toBe(2);
    expect(applied(doc)[0]).toEqual({
      'background-image': 'linear-gradient(to right, rgb(219, 234, 254) 0%, rgb(219, 234, 254) 100%)',
      'box-shadow': 'rgb(219, 234, 254) 0px 0px 0px 2px, rgba(0, 0, 0, 0) 0px 0px 0px 0px',
    });
  });

  it('leaves a compound value alone when any colour in it fails to convert', () => {
    const doc = fakeDoc([{ backgroundImage: 'linear-gradient(oklch(0.5 0.1 20), lab(60% 40 30))' }]);
    const convert: ColorConverter = (v) => (v.startsWith('lab') ? null : 'rgb(1, 2, 3)');
    expect(normalizeModernColors(doc, convert)).toBe(0);
    expect(applied(doc)[0]).toEqual({});
  });

  it('ignores compound values that hold no modern colour', () => {
    const convert = vi.fn(toRgb);
    const doc = fakeDoc([{ backgroundImage: 'url("/a.png")', boxShadow: 'none', textShadow: 'rgb(0, 0, 0) 1px 1px 2px' }]);
    expect(normalizeModernColors(doc, convert)).toBe(0);
    expect(convert).not.toHaveBeenCalled();
  });

  it('returns 0 for a document with no view rather than throwing', () => {
    expect(normalizeModernColors({ defaultView: null } as unknown as Document, toRgb)).toBe(0);
  });
});

describe('replaceColorFunctions', () => {
  // Echoes which source it was asked to convert, so the output shows exactly
  // which spans were treated as one colour.
  const tag: ColorConverter = (v) => `rgb(<${v}>)`;

  it('converts every stop of a multi-stop gradient', () => {
    expect(
      replaceColorFunctions(
        'linear-gradient(to right, oklch(0.6 0.2 277) 0%, lab(50 20 -60) 50%, rgb(1, 2, 3) 75%, oklab(0.7 0.1 -0.1) 100%)',
        tag,
      ),
    ).toBe(
      'linear-gradient(to right, rgb(<oklch(0.6 0.2 277)>) 0%, rgb(<lab(50 20 -60)>) 50%, rgb(1, 2, 3) 75%, rgb(<oklab(0.7 0.1 -0.1)>) 100%)',
    );
  });

  it('converts each layer of a multi-layer shadow and keeps the offsets', () => {
    expect(
      replaceColorFunctions(
        'oklab(0.62 -0.05 -0.18 / 0.5) 0px 0px 0px 2px, rgba(0, 0, 0, 0.1) 0px 1px 3px 0px, oklch(0.3 0.02 260 / 0.25) 0px 4px 6px -4px',
        tag,
      ),
    ).toBe(
      'rgb(<oklab(0.62 -0.05 -0.18 / 0.5)>) 0px 0px 0px 2px, rgba(0, 0, 0, 0.1) 0px 1px 3px 0px, rgb(<oklch(0.3 0.02 260 / 0.25)>) 0px 4px 6px -4px',
    );
  });

  it('treats a nested color-mix as one colour, matching the outer parenthesis', () => {
    expect(
      replaceColorFunctions(
        'linear-gradient(color-mix(in oklab, oklch(0.6 0.2 277) 40%, lab(50 20 -60)), color(display-p3 0.2 0.7 0.5))',
        tag,
      ),
    ).toBe(
      'linear-gradient(rgb(<color-mix(in oklab, oklch(0.6 0.2 277) 40%, lab(50 20 -60))>), rgb(<color(display-p3 0.2 0.7 0.5)>))',
    );
  });

  it('handles several gradients in one background-image', () => {
    expect(replaceColorFunctions('linear-gradient(lab(1 2 3), red), radial-gradient(oklch(0.1 0 0), blue)', tag)).toBe(
      'linear-gradient(rgb(<lab(1 2 3)>), red), radial-gradient(rgb(<oklch(0.1 0 0)>), blue)',
    );
  });

  it.each([
    'none',
    'linear-gradient(to right, rgb(1, 2, 3) 0%, rgba(4, 5, 6, 0.5) 100%)',
    'rgba(0, 0, 0, 0.1) 0px 1px 3px 0px, rgb(0, 0, 0) 0px 0px 0px 0px',
    'url("/a.png")',
    '',
  ])('returns %j unchanged and never calls the converter', (value) => {
    const convert = vi.fn(tag);
    expect(replaceColorFunctions(value, convert)).toBe(value);
    expect(convert).not.toHaveBeenCalled();
  });

  it('does not mistake a colour-like name inside url() for a colour', () => {
    const convert = vi.fn(tag);
    expect(replaceColorFunctions('url("/img/lab(1).png"), linear-gradient(lab(1 2 3), red)', convert)).toBe(
      'url("/img/lab(1).png"), linear-gradient(rgb(<lab(1 2 3)>), red)',
    );
    expect(convert).toHaveBeenCalledTimes(1);
  });

  it('returns null when any colour fails, rather than a half-converted value', () => {
    const convert: ColorConverter = (v) => (v.startsWith('lab') ? null : 'rgb(1, 2, 3)');
    expect(replaceColorFunctions('linear-gradient(oklch(0.5 0.1 20), lab(60% 40 30))', convert)).toBeNull();
  });

  it('returns null for unbalanced parentheses', () => {
    expect(replaceColorFunctions('linear-gradient(oklch(0.5 0.1 20', tag)).toBeNull();
  });

  it('is case-insensitive and safe to call repeatedly', () => {
    expect(replaceColorFunctions('LAB(1 2 3) 0px 0px', tag)).toBe('rgb(<LAB(1 2 3)>) 0px 0px');
    expect(replaceColorFunctions('LAB(1 2 3) 0px 0px', tag)).toBe('rgb(<LAB(1 2 3)>) 0px 0px');
  });
});
