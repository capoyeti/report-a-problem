# Shared page review mobile verification

Local renderer proof is recorded in [results](review-renderer-evidence/results.json).
It uses synthetic records on loopback with Chromium touch emulation. It does not
establish iPhone Safari, Android Chrome, real keyboard or Rhona acceptance.

Run `npm ci`, `npm run build`, `npm test`, `npx tsc --noEmit`, then
`npx tsx scripts/review-renderer-verify.ts`. No environment file or production
credential is needed. The harness destroys browser contexts and closes its
loopback fixture server on completion. All screenshots contain synthetic data.

Before pilot acceptance, record the actual device, OS/browser version, tested
package/service/host build, actor, date and observed result for these journeys:

1. Open Feedback from the normal signed-in dashboard. Choose Mark this page,
   swipe the page, tap a public link or button, adjust parent/child, confirm and
   write a description. Confirm the underlying action did not activate.
2. With the software keyboard open, reach Comment, Cancel and Close and keep
   draft. Dismiss the keyboard, rotate, change browser-bar height, background
   and return. Resume the same draft without losing words or target identity.
3. Use Browse to open a menu, then mark its item. Cancel with the visible control
   and verify normal navigation, scrolling, text selection and pinch zoom resume.
4. Select text with native handles in Highlight mode. Confirm public text works
   and a selection crossing private, excluded, form or editable content is refused.
5. Draw a pen mark with a description. Interrupt one stroke, cancel another,
   then read the saved mark on a different layout and after target removal.
   Confirm Original description only and Anchor unavailable are truthful.
6. Use keyboard and screen reader equivalents for target confirmation, text-only
   notes, comment-list navigation, close/resume and replying. Record focus order
   and accessible names. Check touch controls are at least 44 CSS px.
7. Lose connection, edit or reply, reload, change accounts and return as the
   original actor. Confirm no draft appears or replays for the other actor.
   A conflict must offer current shared words and an explicit retry/discard choice.
8. Read the same thread in a second authorised browser. Record actual elapsed
   visibility time. Do not substitute a Shared label for stored server evidence.

Physical iPhone Safari, Android Chrome, tablet, screen-reader and Rhona evidence
are pending. The integration coordinator owns service/sidecar integration,
permission matrix, deployment identity and end-to-end pilot acceptance.
