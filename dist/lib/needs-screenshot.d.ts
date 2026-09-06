/**
 * True when the complaint sounds visual ("this looks wrong", "the button is in
 * the wrong place") and a screenshot would actually help, false when it does not
 * ("the email never arrived"). Deliberately a crude word list: it only decides
 * how hard the panel nudges, never whether a report can be sent, so a false
 * negative costs nothing and a heavier classifier would not earn its keep.
 * Originally EXPERTTECH-201.
 */
export declare function needsScreenshot(text: string): boolean;
