# SD-103 — Ribbon/command gaps in the headless UI

## Summary
A mixed bag of small command-surface gaps reported against earlier SuperDoc versions
(2.13.0 → 2.19.0). On 2.23.0, the public `createSuperDocUI()` surface (`superdoc/ui`,
exposed here as `window.__ui`) has been substantially reworked and documented. Re-checking
against its current `.d.ts` plus one live run shows most sub-claims **still hold**, but one
— the "caret in table" reactive state — is **now available** and fixed.

## Why it matters
An integrator building a Word-style ribbon on top of SuperDoc (grow/shrink font, format
painter, image insert, table repair, contextual table controls) needs these primitives to
exist and behave predictably; several still don't, which means building a complete ribbon
still requires workarounds for specific commands.

## What we tried / closest APIs
Checked `node_modules/superdoc/dist/superdoc/src/public/ui/types.d.ts` and
`.../ui/commands.d.ts` (the full built-in command registry, `ALL_BUILT_IN_COMMAND_IDS`) on
`superdoc@2.23.0`, plus one live browser run via the harness (`repro.mjs`).

- **No grow/shrink-font command — still missing.** The only font-related command ids in
  the registry are `font-family` and `font-size` (plus their `apply-font-family` /
  `apply-font-size` aliases); there is no increment/decrement id.
- **Format painter "only arms" — still true, but the apply path is now a documented,
  structured API, not ad hoc event forwarding.** The `copy-format` command (`mutates:
  false`) only arms the painter. Applying it is handled by a dedicated
  `window.__ui.formatPainter` handle (`FormatPainterHandle`:
  `setPointerSelecting`/`notifyPointerUp`/`setKeyboardSelecting`/`notifyKeyUp`/`cancel`/
  `onModeChange`) — the host still has to forward pointer/keyboard notifications itself
  (there's still no single "apply-format" command id), but it's a real, typed, documented
  controller rather than reverse-engineered event plumbing.
- **Image command is base64-`src`-only — still true.** `DocCreateImageParams.src: string`
  (`node_modules/@superdoc/sdk/dist/generated/client.d.ts`); no blob/File/upload-handle
  variant exists in the params type.
- **`table-fix` permanently unsupported — still true.** Its command descriptor is
  `{ id: "table-fix", family: "tables", disposition: "unsupported", mutates: true, reason:
  "command-unsupported" }` — a static, unconditional disposition, not a runtime capability
  check.
- **No reactive "caret in table" state / document-readonly masking table context — FIXED,
  now available.** `window.__ui.tables` (`TablesHandle`) now exposes
  `getContext(): TableContextInfo` (`inTable`, `tableNodeId`, `rowIndex`, `columnIndex`,
  `cellNodeId`, `rows`, `columns`) and `isInTable(): boolean`. Verified live on 2.23.0
  (`repro.mjs`, fixture `_fixtures/dpa-table-bearing-agreement.docx`): placing a selection
  inside a table cell and switching the document to `"viewing"` (read-only) mode resolves
  `getContext()` to `{ inTable: true, tableNodeId: "tbl:02000001", rowIndex: 0,
  columnIndex: 0, cellNodeId: "tc:02000001", rows: 6, columns: 2 }` — it does **not**
  report a blanket read-only/unresolved state. (The facade does take one reactive tick,
  roughly 0-50ms, to settle after any selection change, in both editing and viewing mode —
  that's normal async settling, not the old bug.)

## Proposed API
For the items still missing:
- `format.fontSize.step` / dedicated `grow-font` / `shrink-font` command ids that apply the
  next/previous size in the current font's standard size ladder.
- A blob/File-accepting variant of `create.image` (or an upload-then-reference two-step:
  mint a reference id for an uploaded blob, then pass that id instead of a data URI).
- A real capability behind `table-fix`, or at minimum a documented reason code distinct
  from the generic `command-unsupported` so hosts can decide whether to hide or grey out
  the control.

## Evidence
`repro.mjs` (run against `superdoc@2.23.0`) → `results-2.23.0.json`:
`viewingModeTableContextImmediate: { inTable: true, tableNodeId: "tbl:02000001", rowIndex:
0, columnIndex: 0, cellNodeId: "tc:02000001", rows: 6, columns: 2 }`. Screenshot:
`screenshot-viewing-mode-table-context.png`.

## Related
SD-83 (document-wide geometry — the same `ui.viewport`/`ui.tables` surface this folder
reads from).
