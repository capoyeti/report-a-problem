// src/lib/needs-screenshot.ts

const VISUAL = /\b(look|looks|looking|shows?|showing|display|screen|page|here|this|button|layout|column|table|chart|blank|empty|404|wrong place|cut off|overlap)\b/i;

/**
 * True when the complaint sounds visual ("this looks wrong", "the button is in
 * the wrong place") and a screenshot would actually help, false when it does not
 * ("the email never arrived"). Deliberately a crude word list: it only decides
 * how hard the panel nudges, never whether a report can be sent, so a false
 * negative costs nothing and a heavier classifier would not earn its keep.
 * Originally EXPERTTECH-201.
 */
export function needsScreenshot(text: string): boolean {
  if (!text.trim()) return false;
  return VISUAL.test(text);
}
