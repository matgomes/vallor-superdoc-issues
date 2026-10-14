# SD-52 — Comment rail disappears once scrolled away from the only comment's anchor

## Summary

In a long document whose only comment sits near the top, scrolling to the bottom makes the
comment rail go completely empty — not just scrolled out of view, but the public
`ui.comments.getSnapshot().total` itself reports **0**. The comment was never deleted; it is
simply unreachable while its anchor is outside whatever page window SuperDoc currently has
painted. Any code that queries comment state while a reviewer is scrolled through a long
contract — including a host app's own comment-count badge, or an agent tool call that lists
comments — gets an incomplete or empty answer.

## Environment

- **superdoc 2.23.0: REPRODUCES** (this report).
- superdoc 2.20.0 and 2.21.0: REPRODUCES (prior research, identical behavior).
- Browser: Chromium via Playwright (headless), 1280×900.
- Mount: bare `new SuperDoc(...)`, `documentMode: "editing"`, `ui.comments.layout: "sidebar"`
  (a persistent comment rail, not inline popovers).

## Fixture

`long-doc-early-comment.docx` (`make-fixture.mjs`): 220 "pages" (page-break-separated filler
paragraphs), with exactly **one** comment, anchored on the very first paragraph (page 1). No
comments or tracked changes anywhere else in the document.

## Video

[`video/SD-52.mp4`](video/SD-52.mp4) (SuperDoc 2.23.0, Chrome, local harness). Scrolling away from the commented text removes the comment card from the sidebar. It comes back only after scrolling back to the anchor. The document still holds the comment (count 1). Step-by-step timestamps: [`video/TIMESTAMPS.md`](video/TIMESTAMPS.md).

## Steps to reproduce

### UI steps
1. Open the fixture with the comments sidebar enabled.
2. Note the sidebar shows the one comment ("Reviewer: Early comment near the top").
3. Scroll to the very bottom of the document.
4. **Observe:** the sidebar is now completely empty.
5. Scroll back to the top.
6. **Observe:** the comment reappears in the sidebar.

### Script
```bash
node SD-52/repro.mjs
```
Mounts the fixture, reads `ui.comments.getSnapshot()` at the top, scrolls to the bottom
(`window.scrollTo` + a large `page.mouse.wheel`), re-reads the snapshot, then scrolls back to the
top and reads it a third time.

## Expected / Actual

**Expected:** the comment rail may scroll its own list or show the comment's card out of the
current page's viewport, but the comment should still exist and be listable — `total` should
remain 1 regardless of scroll position.

**Actual** (2.23.0, identical to 2.20.0/2.21.0):
- **At top**: `{ listStatus: "ready", total: 1 }`. Sidebar shows the one comment card.
- **At bottom**: `{ listStatus: "ready", total: 0 }`. Sidebar is completely empty — not
  "loading", not scrolled, `status: "ready"` but reporting **zero** comments.
- **Back at top**: `{ listStatus: "ready", total: 1 }` — the comment reappears. This confirms the
  comment is being **pruned from the live view**, not destroyed; it is a windowing defect, not
  data loss.

No exceptions or console errors — this is a silent state-management defect, not a crash.

(`ui.trackChanges.getSnapshot()` reads `total: 0` throughout this run because this fixture has no
tracked changes. The underlying mechanism this report attributes the bug to —
`pruneStaleTrackedChangeComments` — is named for tracked changes specifically, so the same
windowing effect likely also affects a long document's tracked-change list; this was not
exercised here and is worth a follow-up repro with a fixture that has both an early comment and
early tracked changes.)

## Evidence

`results-2.23.0.json` (full raw output):

| scroll position | `ui.comments.getSnapshot().total` | `listStatus` |
|---|---|---|
| top | 1 | ready |
| bottom | **0** | ready |
| back at top | 1 | ready |

Screenshots (`screenshots/`):
- `01-at-top.png` — sidebar showing the one comment card, anchor text highlighted.
- `02-at-bottom.png` — sidebar completely empty.
- `03-back-at-top.png` — sidebar restored after scrolling back up.

## Root cause / analysis

**Hypothesis**, per prior internal research into this behavior (not re-derived from 2.23.0
source, which is minified): SuperDoc's v2 comment rail is fed by a reconciliation step
(`reconcileTrackedChangesFromV2` → `pruneStaleTrackedChangeComments` in that research) that drops
rows whose ids are not present in the *live* set the current render window has published. As the
user scrolls, SuperDoc only keeps a window of pages "painted"/hydrated at a time; once the page
carrying the comment's anchor falls outside that window, the reconciliation step treats the
comment as stale and removes it from the store entirely, rather than merely not rendering its
card. Scrolling back until the anchor's page re-enters the painted window restores it, which is
consistent with "pruned from view," not "destroyed."

## Suggested fix

As analysis, not a patch: the comment store should not drop reachable comments that are merely
outside the currently-painted page window — it should distinguish "not currently rendered" from
"does not exist." `getSnapshot().total` / `list()` should reflect the full set of comments in the
document regardless of scroll position; only the rail's rendered cards need be windowed for
performance.

**Possible workaround:** none identified that preserves correct `total` counts at all scroll
positions — an integrator relying on `ui.comments.getSnapshot().total` for a badge or count
elsewhere in their UI would need to track the document's real comment count independently (e.g.
from the exported/parsed document) rather than trusting this API while the user may be scrolled.

## Related

SD-47 (same `ui.comments`/`ui.trackChanges` surface diverging from the visible/actual state),
SD-49 (no reliable way to drive card focus/visibility from code), SD-55 (`ui.comments.reply()`
failure) — all comments-API reliability bugs in the same area.
