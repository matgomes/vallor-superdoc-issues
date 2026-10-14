# SD-06: manual steps (built-in "Accept change" on a multi-paragraph selection)

Verified by hand on superdoc 2.23.0, bare mount, Chrome.

1. `npm run setup`, then `npx vite --port 5199` from the repo root.
2. Open `http://localhost:5199/harness/index.html?doc=SD-06/whole-paragraph-deleted.docx&mode=suggesting`.
   The document has three paragraphs: "Intro paragraph that stays.", a fully deleted paragraph
   "This whole paragraph was deleted." (one tracked deletion, shown in the sidebar), and
   "Closing paragraph that stays."
3. Drag-select from the start of "Intro paragraph that stays." to the end of "Closing paragraph that stays."
   The selection spans three paragraphs and contains exactly one tracked change.
4. Right-click inside the selection. SuperDoc's own context menu shows **Accept change** / **Reject change**
   (`screenshots/manual-1-context-menu-accept-change.jpg`).
5. Click **Accept change**.

**Expected:** the deletion is accepted. The deleted paragraph disappears and the sidebar card goes away.
**Actual:** nothing happens. The deletion stays, the card stays, `trackChanges.list().total` is still 1,
and nothing reaches `onException` or the console
(`screenshots/manual-2-after-accept-change-nothing-happened.jpg`). **Reject change** is also a silent no-op
(verified the same way: `total` stays 1, no error).

The table-cell variant of this (a selection across several cells holding one change) is the one reported
upstream as superdoc/docx-editor#4047; this folder shows the multi-paragraph variant on 2.23.0.
