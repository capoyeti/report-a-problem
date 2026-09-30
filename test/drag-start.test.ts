// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { startsDrag } from '../src/lib/panel-position';

function header() {
  const handle = document.createElement('div');
  handle.innerHTML = '<div><svg></svg><h2>Report a problem</h2></div><button aria-label="Close"><svg><path></path></svg></button>';
  return handle;
}

describe('startsDrag', () => {
  it('drags from the title and grip', () => {
    const h = header();
    expect(startsDrag(h)).toBe(true);
    expect(startsDrag(h.querySelector('h2'))).toBe(true);
  });

  // Capturing the pointer on the handle retargets pointerup to the handle, so
  // the Close button never received its click (CLEVERCONN, 2026-09-30).
  it('never drags from the Close button or its icon', () => {
    const h = header();
    expect(startsDrag(h.querySelector('button'))).toBe(false);
    expect(startsDrag(h.querySelector('path'))).toBe(false);
  });

  it('ignores non-element targets', () => {
    expect(startsDrag(null)).toBe(false);
  });
});
