# SD-83 — Document-wide geometry: off-screen content can't be measured, and entity-address `getRect` is declared but not wired

## Summary
SuperDoc virtualizes page rendering (only a window of pages around the viewport is
painted). The public geometry surface (`ui.viewport.getRect` / `scrollIntoView`,
`window.__ui` i.e. `createSuperDocUI()`) reflects that: a mounted/painted text range
resolves real pixel geometry, but the same call for unmounted content fails closed
instead of measuring it. Separately — and this was not fully appreciated in earlier
research — the public type declares `getRect`'s target as accepting a tracked-change or
comment **entity address**, but at runtime on 2.23.0 that shape always rejects with
`invalid-target`, for both a real and a nonexistent id. `scrollIntoView` and
`trackChanges.scrollTo(id)` accept and correctly honor the exact same entity address /
id, so navigation-by-id works; only rect-by-id does not.

## Why it matters
Any overlay UI that needs to draw its own markers over tracked changes, comments, or
bookmarks (redline minimaps, connector lines, custom highlight chrome, "jump to this
change and show me where it is on the page" without first scrolling) cannot ask SuperDoc
directly for a rectangle by entity id. It has to scroll the entity into view first (which
works), then re-resolve geometry through some other path (a text/selection target, or
`getBoundingClientRect` on painted DOM) once it's known to be mounted.

## Environment
superdoc 2.23.0 / `@superdoc/sdk` 2.20.0, bare mount, Chromium (Playwright), harness
`window.__ui = createSuperDocUI({ superdoc: window.__sd })`.

## Steps to reproduce
UI steps: open a long (~200 page) document, stay scrolled to the top, then ask the host
geometry API for the rectangle of a paragraph far down the document (e.g. the last
paragraph) — it reports no geometry instead of measuring it (a real application would see
this as "can't draw an overlay for content I haven't scrolled to yet"). Separately, open
a document with tracked changes and ask for a tracked change's rectangle by its id — it is
refused, even though asking to scroll to or navigate to the same id works.

Script: `node SD-83/repro.mjs` — opens `_fixtures/msa-200-pages-template.docx` (2,159
blocks across ~200 pages) and `_fixtures/dpa-multi-redline.docx` (37 tracked changes) via
the harness.

## Expected / Actual
- **Expected:** `ui.viewport.getRect()` either measures off-screen content (forcing a
  layout pass) or at minimum behaves the same way for entity addresses as it does for
  `scrollIntoView`.
- **Actual:**
  - Near-top text block (painted): `{"found":true,"rects":[{"pageIndex":0,"left":191.7,
    "top":159.3,"width":59.25,"height":30,...}]}`.
  - Near-end text block of the same document, same call, scrolled to top (not painted):
    `{"found":false,"success":false,"rects":[],"reason":"unresolved"}`.
  - A tracked-change entity address (`{kind:"entity", entityType:"trackedChange",
    entityId}`, taken verbatim from `trackChanges.list()`'s own `.address` field):
    `{"found":false,"success":false,"rects":[],"reason":"invalid-target"}` — same result
    for a real id and for a nonexistent comment id, which is why we read this as "not
    wired" rather than "not found".
  - The identical entity address passed to `ui.viewport.scrollIntoView({target})`:
    `{"success":true}`. `ui.trackChanges.scrollTo(id)`: `{"success":true,"ok":true}`.
  - `ui.bookmarks` exposes only `navigateTo` — no `getRect` at all, for any shape.

## Evidence
`repro.mjs` → `results-2.23.0.json`; screenshots `screenshot-large-doc-scrolled-top.png`,
`screenshot-tracked-doc.png`. Fixtures used as-is from `_fixtures/` (no fixture authored
for this folder).

## Root cause / analysis
- The virtualization gap is architectural: the renderer only paints a window of pages
  around the viewport plus overscan; `getRect` can only resolve geometry for painted DOM,
  so it fails closed (`reason` drawn from a shared vocabulary: `not-mounted`, `unresolved`,
  `invalid-target`, `not-ready`, `unavailable` — we observed `unresolved` here, not
  `not-mounted`, but the practical effect is identical: no geometry without scrolling
  there first).
- The entity-address `getRect` gap looks like a types-ahead-of-implementation mismatch:
  `node_modules/superdoc/dist/superdoc/src/public/ui/types.d.ts` declares
  `ViewportGetRectTarget = SelectionTarget | TextAddress | TextTarget | ViewportEntityAddress`
  and `ViewportEntityAddress = EntityAddress | ContentControlViewportAddress`, where
  `EntityAddress` (imported from the document-api package) is
  `CommentAddress | TrackedChangeAddress` with `kind:"entity"`. The type system promises
  this is accepted; the runtime controller behind `getRect` rejects it outright. The same
  shape works for `scrollIntoView`, so the dispatch for `getRect` specifically hasn't been
  wired for entity addresses, or validates target `kind` more narrowly than its own
  declared type.
- The decoration-attribute-survives probe (hand-adding a DOM attribute to a painted
  tracked-change mark and re-reading it 500ms later) did **not** reproduce a wipe in this
  quick check — the attribute was still present. This claim needs a longer observation
  window or an actual scroll/edit to trigger a repaint before it can be confirmed either
  way; we did not spend further time on it here.

## Suggested fix
Wire `getRect` to accept the same `EntityAddress` shapes its own declared type promises
(route tracked-change/comment entity addresses to the same resolution path
`scrollIntoView` already uses, then measure). For the virtualization gap: either give
`getRect` a "force-measure" option that scrolls/lays out off-screen content just enough to
report a rectangle, or document the fail-closed contract explicitly so hosts know they
must `scrollIntoView` before `getRect` can succeed. Add `getRect`/`scrollIntoView` support
to `ui.bookmarks` to match `ui.contentControls`.

## Related
SD-107 (same gap, framed as a missing capability for tracked changes and bookmarks
specifically — this folder supersedes it with live 2.23.0 evidence), SD-89 (declared types
not matching runtime, a pre-existing pattern this finding is another instance of), SD-103
(same `window.__ui` surface).
