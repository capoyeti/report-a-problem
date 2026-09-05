// src/lib/needs-screenshot.ts
//
// EXPERTTECH-201: a screenshot is worth asking for loudly when the complaint is
// visual ("this looks wrong", "the button is in the wrong place"). It is noise
// when it is not ("the email never arrived"). A word list is enough; this only
// changes how hard we nudge, never whether the report can be sent.
const VISUAL = /\b(look|looks|looking|shows?|showing|display|screen|page|here|this|button|layout|column|table|chart|blank|empty|404|wrong place|cut off|overlap)\b/i;
export function needsScreenshot(text) {
    if (!text.trim())
        return false;
    return VISUAL.test(text);
}
