import { describe, it, expect } from 'vitest';
import { needsScreenshot } from '../src/lib/needs-screenshot';

// EXPERTTECH-201: when the wording is visual, push the screenshot prompt harder.
describe('needsScreenshot', () => {
  it('detects visual complaints', () => {
    for (const s of [
      'this looks wrong',
      'the button is in the wrong place',
      'this page shows the wrong number',
      'the layout is broken',
      'I get a 404 here',
      'see this screen',
    ]) {
      expect(needsScreenshot(s)).toBe(true);
    }
  });

  it('leaves non-visual reports alone', () => {
    for (const s of [
      'generation took ten minutes',
      'I cannot sign in',
      'the email never arrived',
    ]) {
      expect(needsScreenshot(s)).toBe(false);
    }
  });

  it('is case insensitive and ignores empty input', () => {
    expect(needsScreenshot('This LOOKS odd')).toBe(true);
    expect(needsScreenshot('')).toBe(false);
  });
});
