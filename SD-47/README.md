# SD-47 — Clicking a tracked change inside commented text opens the comment card instead

## Summary

When a tracked-change run sits fully inside a comment's anchor range, clicking that text opens
the **comment** card, never the tracked-change card — so a reviewer can never get to the
accept/reject controls for a change that happens to also be commented on, which is a common
redlining pattern (a reviewer leaves a comment explaining why they changed something). Vendor
ticket IT-1479, previously claimed fixed at 2.8.0 but still broken as of 2026-08-23; this report
confirms it is still broken at 2.23.0.

## Environment

- **superdoc 2.23.0: REPRODUCES** (this report).
- superdoc 2.20.0 and 2.21.0: REPRODUCES (prior research, identical behavior).
- Browser: Chromium via Playwright (headless), 1280×900.
- Mount: bare `new SuperDoc(...)`, `documentMode: "editing"`, `ui.comments.layout: "inline"`.

## Video

[`video/SD-47.mp4`](video/SD-47.mp4) (SuperDoc 2.23.0, Chrome, local harness). Clicking a tracked insertion inside a commented range opens the comment card instead of the tracked-change card. A standalone insertion opens its tracked-change card normally. Step-by-step timestamps: [`video/TIMESTAMPS.md`](video/TIMESTAMPS.md).

## Steps to reproduce

### UI steps
1. Open a document containing a comment range that fully wraps a tracked-insertion run (see
   Fixture below: paragraph 4, comment range wraps "Before nested. " + an inserted run "Nested
   tracked change inside comment.").
2. Click directly on the tracked-change (inserted) text that is nested inside the comment range.
3. **Observe:** the comment card opens ("Reviewer: Nested comment"), not the tracked-change card
   (which would show "Jane Doe" / "IMPORTED" / "Added ..." and accept/reject controls).

For contrast, click text that is *only* a comment (no tracked change) and text that is *only* a
tracked change (no comment) — each opens its own correct card, confirming the bug is specific to
the overlapping/nested case.

### Script
```bash
node SD-47/repro.mjs
```
Mounts the fixture, clicks each of the three paragraphs in turn (comment-only, tracked-change-only,
nested), and for each click reads: whether a card is present, its `aria-label` and body text (to
identify which kind of card rendered), and `ui.comments.getSnapshot().activeId` /
`ui.trackChanges.getSnapshot().activeId`.

## Expected / Actual

**Expected:** clicking text that is a tracked insertion should open the tracked-change card
(author, accept/reject controls), since that's the more specific/innermost mark at the click
point — the user's intent is almost always to review the change itself.

**Actual** (2.23.0, identical to 2.20.0/2.21.0):
- Click on comment-only text → comment card opens, `aria-label="Comment by Reviewer"`,
  `ui.comments.getSnapshot().activeId === "1"`, `ui.trackChanges.getSnapshot().activeId === null`.
  Correct.
- Click on tracked-change-only text → tracked-change card opens,
  `aria-label="Tracked change discussion"`, `ui.trackChanges.getSnapshot().activeId` is set,
  `ui.comments.getSnapshot().activeId === null`. Correct.
- Click on the **nested** text (tracked change fully inside a comment range) → **comment card
  opens** (`aria-label="Comment by Reviewer"`, body "Nested comment"), never the tracked-change
  card. Additionally, **both** `ui.comments.getSnapshot().activeId` and
  `ui.trackChanges.getSnapshot().activeId` are `null` at this moment — the DOM card that actually
  rendered does not agree with either public reactive snapshot about what is "active". This
  divergence between the click-to-card resolution path and the `ui.*`/`activeId` selection state
  is itself a bug surface worth flagging separately from the card-choice bug.

No exceptions or console errors in any case — this is a pure click-resolution/precedence bug, not
a crash.

## Evidence

`results-2.23.0.json` (full raw output). Key figures:

| click target | card `aria-label` | card body | `comments.activeId` | `trackChanges.activeId` |
|---|---|---|---|---|
| comment-only | `Comment by Reviewer` | "First comment" | `"1"` | `null` |
| tracked-change-only | `Tracked change discussion` | "Jane Doe ... Added ..." | `null` | the TC's id |
| **nested (both)** | `Comment by Reviewer` | "Nested comment" | `null` | `null` |

Screenshots (`screenshots/`):
- `01-click-comment-only.png` — correct comment card for comment-only text.
- `02-click-tc-only.png` — correct tracked-change card for tracked-change-only text.
- `03-click-nested.png` — the bug: comment card for text that is a tracked change nested inside a
  comment range.

## Root cause / analysis

**Hypothesis**, based on the shared internal mechanism described in prior research (not verified
against 2.23.0 source directly — the bundle is minified): SuperDoc appears to keep comments and
tracked changes in one shared list and resolve a click's target id via something equivalent to
`items.find(item => readEntityId(item) === id)`, where `readEntityId` reads `id ?? commentId ??
changeId` for **both** kinds of entity. Because comments and tracked changes are numbered
independently starting from a low integer, and a tie-break appears to favor comments when two
entities could match the same click position, a tracked change nested inside a comment's range
resolves to the comment, not the change. This is consistent with what the repro shows: the
comment card always wins when both a comment and a tracked change are anchored at/around the
same point, regardless of which one is the more specific (innermost) match.

The `activeId` divergence (both public snapshots report `null` on the nested click, even though a
card visibly rendered) suggests the click→card rendering path is driven by separate, private
state from the state `ui.comments`/`ui.trackChanges` expose publicly — i.e. the reactive
`getSnapshot().activeId` cannot be used as a reliable signal for "which card, if any, is
currently showing" in this overlapping case.

## Suggested fix

As analysis, not a patch: the click-resolution path should prefer the most specific (innermost)
mark at the click point rather than a fixed type-based tie-break. Where both a comment and a
tracked change are plausible targets at the same position, disambiguating by document structure
(which mark's range is narrower / nested inside the other) would resolve to the tracked change in
this case. Separately, `ui.comments.getSnapshot().activeId` / `ui.trackChanges.getSnapshot().activeId`
should reflect whichever card is actually showing, so integrators have one reliable public signal
instead of two that can both read `null` while a card is visible.

**Possible workaround:** none identified — an integrator cannot distinguish "no card open" from
"comment card open because of a tie-break" using the public snapshot APIs alone; they would need
to inspect the rendered DOM (e.g. the dialog's `aria-label`) to know which card actually opened.

## Related

SD-52 (comment rail/snapshot state also diverges from reality in this same `ui.comments`
surface), SD-55 (`ui.comments.reply()` failure), SD-49 (no reliable way to open/focus a specific
card from code) — all comments/tracked-changes API and click-resolution bugs in the same area.
