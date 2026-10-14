# SD-49 — No public way to open/focus a review card from code

## Summary

An integrator (a custom toolbar button, a keyboard shortcut, or an LLM agent driving the
document) cannot reliably open or focus a specific comment/tracked-change card from code.
`setActive()` reports success but never opens anything. The list/navigate surface a "next/previous
change" button would use only sees whatever is in the currently-rendered page window, not the
whole document, so a document with changes on both early and late pages effectively hides most of
them from navigation. This matters for any custom review toolbar (e.g. a Word-ribbon-style
"Next"/"Previous" button) built on top of SuperDoc's public API.

## Environment

- **superdoc 2.23.0: all four findings below REPRODUCE** (this report; no prior repro existed for
  this bundle of findings).
- Browser: Chromium via Playwright (headless), 1280×900.
- Mount: bare `new SuperDoc(...)`, `documentMode: "editing"`, `ui.comments.layout: "inline"`.

## Fixture

`spread-changes-and-comments.docx` (`make-fixture.mjs`): one tracked insertion + one comment near
the top (page 1), ~100 filler pages, then one more tracked insertion + one more comment near the
bottom.

## Findings

### 1. `setActive()` returns success but never opens a card

**Steps:** call `ui.trackChanges.setActive(id)` for a real, currently-listed tracked-change id;
wait; check the DOM for the comment/tracked-change dialog (`[data-sd-part="comment-thread"]`).
Repeat for `ui.comments.setActive(id)`.

**Expected:** the corresponding card opens, matching what a real click on that entity would show.

**Actual:** both calls return `true`/success. `ui.trackChanges.getSnapshot().activeId` *does*
update to the id passed in; `ui.comments.getSnapshot().activeId` also updates. But in neither case
does any card dialog appear in the DOM. The reactive "this entity is active" state and the actual
visible card are decoupled — `setActive` moves the former but not the latter.

### 2. `trackChanges.list()` only reaches changes in the currently-painted page window

**Steps:** read `ui.trackChanges.list()` right after load (viewport at the top, page 1 painted);
scroll to the very bottom; read it again.

**Expected:** `list()` returns all tracked changes in the document regardless of scroll position
(the fixture has exactly 2, one near the top, one near the bottom).

**Actual:** `list()` returns exactly **1** item at all times — the one on the painted page(s) —
never both. At the top it returns only the early change's id; after scrolling to the bottom it
returns only the late change's id. The early one drops out of the list entirely once its page is
no longer painted. This is the same windowing effect reported in SD-52 for comments, confirmed
here to affect tracked changes too (SD-52's REPRO.md flagged this as worth checking as a
follow-up).

### 3. `navigateNext()` resolves successfully but is a no-op when the next change is off-window

**Steps:** `setActive()` the one tracked change visible in the current window; call
`ui.trackChanges.navigateNext()`; check whether its promise settles within 4 seconds, and whether
`activeId` actually changes afterward.

**Expected:** navigates to the document's next tracked change (which exists — it's just off the
currently-painted window) and opens its card.

**Actual:** the promise **does settle** within 4 seconds and reports `{success: true}` — this
differs from an older report of this same area describing `navigateNext()` as never settling; on
2.23.0 it resolves promptly. However, it is a **no-op**: `activeId` before and after are
identical, and no card appears. Because `list()` (finding 2) cannot see the off-window change,
`navigateNext()` has nothing to navigate to, even though the "next" change genuinely exists later
in the document.

### 4. An integrator's own "next change" button, wired the normal way, visibly does nothing

**Steps:** append a plain HTML `<button>` outside SuperDoc's own DOM (fixed-positioned, not part
of the editor), with an `onclick` handler that calls `setActive()` on the current item and then
`ui.trackChanges.navigateNext()` — exactly the integration pattern a host application's custom
review toolbar would use for a "Next" control. Click it.

```js
button.onclick = () => {
  window.__ui.trackChanges.navigateNext().then((result) => {
    window.__integratorNavigateResult = result;
  });
};
```

**Expected:** the card for the next tracked change opens and becomes active.

**Actual:** the button's click handler resolves with `{success: true}`, but `activeId` is
unchanged and no card opens — from the end user's point of view, clicking "Next" did nothing.

## Evidence

`results-2.23.0.json` (full raw output, all four findings, each run against a fresh page load to
avoid cross-contamination between findings):

| finding | result |
|---|---|
| `trackChanges.setActive(id)` → card present? | `true` (success) → **no card** |
| `comments.setActive(id)` → card present? | `true` (success) → **no card** |
| `trackChanges.list()` at top | 1 item (the early change only) |
| `trackChanges.list()` at bottom | 1 item (the late change only, early one gone) |
| `navigateNext()` toward an off-window target | settles within 4s, `{success:true}`, **`activeId` unchanged, no card** |
| integrator's own "Next" button click | resolves `{success:true}`, **`activeId` unchanged, no card** |

Screenshots (`screenshots/`):
- `01-after-trackchanges-setactive.png` / `02-after-comments-setactive.png` — no card visible
  despite `setActive` reporting success.
- `03-trackchanges-at-top.png` / `04-trackchanges-at-bottom.png` — the painted-window effect.
- `05-after-navigatenext-off-window-target.png` — no visible change after `navigateNext()`.
- `06-integrator-next-change-button-clicked.png` — the integrator's own button, visibly having
  done nothing after being clicked.

No exceptions or console errors in any finding — these are all silent no-ops, not crashes.

## Root cause / analysis

**Hypothesis**, based on the shape of the public API and the symptoms above (not verified against
minified 2.23.0 source): the card that actually renders on screen appears to be driven by private,
internal state distinct from the public `ui.comments`/`ui.trackChanges` reactive snapshots —
`setActive()` can update the public snapshot's `activeId` without that update propagating to
whatever decides to mount a card in the DOM. Separately, `list()` (and therefore anything built on
top of it, including `navigateNext()`/`navigatePrevious()`) appears to enumerate only entities
within SuperDoc's current rendering window rather than the full document, so any entity outside
that window is invisible to the public API even though it exists in the document.

## Suggested fix

As analysis, not a patch: `ui.comments.list()` / `ui.trackChanges.list()` should enumerate every
comment/tracked change in the document regardless of what is currently rendered, with the rendered
window being a separate, explicit concern (e.g. a `visible: boolean` flag per item, rather than
omission). `setActive()` should either actually open the corresponding card, or the API should
expose a distinct method that does (e.g. `focus()` / `scrollTo()` already exists per the type
surface — if that is the intended mechanism for opening a card, it should be documented as such
and `setActive()`'s doc comment should not imply it affects visibility).

**Possible workaround:** none identified that reliably opens a specific card from code — an
integrator would need to resort to undocumented internals to drive a card open, which is brittle
across versions and was explicitly out of scope to investigate or recommend here.

## Related

SD-52 (the same painted-window effect, confirmed there for comments and extended here to tracked
changes), SD-47 (the DOM card and the public `activeId` snapshot disagreeing about what is
"active"), SD-55 (`ui.comments.reply()` failure) — all point to the same underlying pattern: the
visible card and the public reactive API are two different, loosely-coupled sources of truth.
