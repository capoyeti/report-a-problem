import { describe, expect, it, vi } from 'vitest';
import {
  COLOR_PROPERTIES,
  MODERN_COLOR_FUNCTION,
  normalizeModernColors,
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
    const one = Object.fromEntries(COLOR_PROPERTIES.map((p) => [p, 'oklch(0.9 0.03 255)']));
    expect(normalizeModernColors(fakeDoc([one]), toRgb)).toBe(COLOR_PROPERTIES.length);
  });

  it('returns 0 for a document with no view rather than throwing', () => {
    expect(normalizeModernColors({ defaultView: null } as unknown as Document, toRgb)).toBe(0);
  });
});
