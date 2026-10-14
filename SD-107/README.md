# SD-107 — No `getRect` by id for tracked changes or bookmarks, and no positional path from a range/bookmark to the tracked changes inside it

## Summary
Comments and content controls each have an id-addressable "give me this entity's painted
rectangle" API. Tracked changes and bookmarks don't: tracked changes can be scrolled-to by
id but not measured by id, and bookmarks can only be navigated-to (scroll + select a
range), never measured or geometrically queried at all. Separately, there is no way to ask
"which tracked changes fall inside this range/bookmark" — `trackChanges.list({in})` only
takes a whole story (body, a header/footer slot, a footnote, etc.) or `"all"`, never a
range or bookmark locator, and the per-change address (`TrackChangeInfo`/`address`) carries
no text offsets, only coarse container/story information.

## Why it matters
A redlining UI that draws its own boxes/connectors around tracked changes near a clause
boundary, or that wants to answer "are there any undecided tracked changes inside this
bookmarked clause before I let the user delete it", has no API path to either question. It
has to resolve geometry a different way (scroll there, then read painted DOM) and has to
cross-reference positions itself (read the whole story's blocks/offsets and intersect them
against tracked-change containers) instead of asking either API directly.

## What we tried / closest APIs (superdoc 2.23.0 / `@superdoc/sdk` 2.20.0)
Live-verified independently in this folder's own `repro.mjs` → `results-2.23.0.json`
(`node SD-107/repro.mjs`), and corroborated by `SD-83/repro.mjs` (same `window.__ui`
surface, a different fixture):

- `ui.contentControls.getRect({id})` / `scrollIntoView({id})` exist
  (`ContentControlsHandle`, `node_modules/superdoc/dist/superdoc/src/public/ui/types.d.ts`).
- `ui.viewport.getRect({target})` **declares** support for a tracked-change or comment
  entity address (`ViewportGetRectTarget` includes `ViewportEntityAddress =
  EntityAddress | ContentControlViewportAddress`, and `EntityAddress = CommentAddress |
  TrackedChangeAddress` from the document-api package), but at runtime it rejects every
  entity address with `{found:false, reason:"invalid-target"}` — for a real tracked-change
  id taken verbatim from `trackChanges.list()` and for a nonexistent comment id alike. So
  in practice there is still no working `getRect`-by-id for tracked changes (see SD-83 for
  the full repro and evidence).
- `ui.trackChanges.scrollTo(id)` and `ui.viewport.scrollIntoView({target: entityAddress})`
  **do** work (verified: both resolve `success:true` for the same id/address that
  `getRect` rejects) — so navigation-by-id is solved, measurement-by-id is not.
- `ui.bookmarks` (`BookmarksHandle`) exposes exactly one method, `navigateTo(name |
  BookmarkAddress)` — it reveals and selects the bookmark's range, but there is no
  `getRect`/`scrollIntoView`-only variant and no way to read a rectangle without also
  moving the live selection.
- `trackChanges.list({in})` (`DocTrackChangesListParams.in`,
  `node_modules/@superdoc/sdk/dist/generated/client.d.ts`) only accepts a story locator
  (`body`, a header/footer slot or part, a footnote, an endnote, a textbox) or the literal
  `"all"` — no range or bookmark-scoped locator exists. `TrackChangeInfo`'s own address
  (`navigationTarget: {kind:"block", story, blockId, role}`) carries a block id and story,
  not a text offset/range, so even a caller that already has a range or bookmark can't
  intersect it against a change's position without separately resolving that block's
  offsets.

## Proposed API
- Wire `ui.viewport.getRect` to actually honor the `EntityAddress` shapes its own
  `ViewportGetRectTarget` type already declares (tracked changes and comments), so it
  matches `scrollIntoView`'s behavior instead of contradicting its own types.
- Add `ui.bookmarks.getRect(input: {name} | {address})` /
  `scrollIntoView(...)` alongside the existing `navigateTo`, so geometry can be read
  without moving the live selection.
- Extend `trackChanges.list({in})` to accept a range or bookmark locator (e.g. `{kind:
  "range", ...}` / `{kind:"bookmark", name | address}`), or add offsets to
  `TrackChangeInfo`'s address so a caller holding a range/bookmark can intersect it against
  the change list itself instead of walking the whole story.

## Related
SD-83 (document-wide geometry — carries the live 2.23.0 repro and evidence this folder's
`getRect`/`scrollIntoView` claims are based on).
