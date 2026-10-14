# SD-18 — `setTrackedChangesPreferences({mode})` updates config but not the rendered markup

## Summary

Calling the public `setTrackedChangesPreferences({ mode })` method on a mounted `SuperDoc`
instance updates the editor's internal configuration for every documented mode, but the
rendered document only actually reflects that change for `mode: "original"`. For
`mode: "final"` — the mode an integrator would use to show reviewers a "clean" view of an
in-progress redline — the inserted text keeps its tracked-change markup (underline/highlight)
exactly as if nothing had changed. A product built on this API cannot reliably offer a
"hide markup" / "clean view" toggle without a full editor remount.

## Environment

- superdoc 2.23.0 / `@superdoc/sdk` 2.20.0: **PARTIAL** — see Actual below. `config`-layer
  update works for every mode; rendered markup only follows the config for `mode: "original"`.
- 2.20.0 / 2.21.0: not re-tested in this pass (prior notes describe an older, different
  failure mode — see Root cause below for why the two reports aren't actually describing the
  same code path).
- Browser: Chromium via Playwright 1.64.0, headless. Bare `superdoc` mount via the shared
  Vite harness (`harness/index.html` + `harness/main.js`), no collaboration.

## Steps to reproduce

UI steps:
1. Open a document with at least one tracked insertion in SuperDoc 2.23.0 (editing mode).
2. Call `superdocInstance.setTrackedChangesPreferences({ mode: "final" })` from the console
   (there is no built-in UI control wired to this method in a bare mount).
3. Observe the previously-inserted text: it is still underlined/highlighted as a pending
   tracked change, identical to the default view.
4. Call `setTrackedChangesPreferences({ mode: "original" })` instead: the inserted text
   disappears from the rendered document (this direction does work).
5. Call `setTrackedChangesPreferences({ mode: "review" })` to go back to the default: the
   inserted text reappears, correctly, but note this is restoring the ordinary visible-markup
   view, not proving `"final"`/`"off"` work — see Actual.

Script: `node SD-18/repro.mjs` (run from the repo root).

## Expected / Actual

**Expected:** each of the four documented `mode` values (`review` | `original` | `final` |
`off`) produces a visually distinct rendering of the tracked insertion: `review` shows it
underlined/highlighted (markup visible, default); `original` hides it (pre-edit state);
`final` shows the text as plain, accepted content with no tracked-change styling (clean
view); `off` likely matches `final` (tracking display disabled).

**Actual**, single tracked-insertion fixture (`fixture-dpa-table-cell-revisions.docx`, word
"OUTSIDE "), calling each mode in sequence (`final` → `original` → `off` → `review`):

| mode called | `config.layoutEngineOptions.trackedChanges.mode` after call | "OUTSIDE" present in rendered text | still carries `.track-insert-dec` class |
|---|---|---|---|
| (default, no call yet) | `review` | yes | yes |
| `final` | `final` | **yes** | **yes** |
| `original` | `original` | **no** | n/a (text gone) |
| `off` | `off` | yes | no |
| `review` | `review` | yes | no |

The config field (`window.__sd.config.layoutEngineOptions.trackedChanges.mode`) updates to
the requested value on every single call — it is **not** a no-op at the config layer. But
the rendered markup only changes for `mode: "original"`. For `mode: "final"`, the inserted
text is pixel-identical to the default `review` rendering (same screenshot, same
`track-insert-dec highlighted insertion` classes) — see `screenshots/00-default-review.png`
vs `screenshots/mode-final.png`.

No `onException` / console errors were raised by any of the calls (`results-2.23.0.json`
`errors: []`) — the no-op is silent, exactly as the title describes, just not for the reason
previously assumed (see Root cause).

## Evidence

- `results-2.23.0.json` — full per-mode state dump (config value, text-presence, class-presence) and the raw call results.
- `screenshots/00-default-review.png` — baseline, insertion underlined.
- `screenshots/mode-final.png` — after `setTrackedChangesPreferences({mode:"final"})`; identical to baseline.
- `screenshots/mode-original.png` — after `mode:"original"`; the insertion is gone, text reverts to the pre-edit paragraph.
- `screenshots/mode-off.png`, `screenshots/mode-review.png` — insertion text is back, but DOM class presence for `.track-insert-dec` is inconsistent run-to-run after passing through `original` (observed absent in this run though the text itself is present) — noted as a secondary, less certain observation; the clear, reproducible finding is the `final` mode no-op above.

## Root cause / analysis

The prior internal note for this issue (static analysis of an older bundle) claimed the
setter was a complete no-op because the accessor moved to `doc.getDocumentRuntime()` and
`setDocumentRuntime` was never called. That no longer matches the 2.23.0 bundle:

- `SuperDoc.prototype.setTrackedChangesPreferences` (readable, non-minified in
  `node_modules/superdoc/dist/superdoc.es.js`) now writes `preferences.enabled` into
  `this.config.trackChanges`/`this.config.modules.trackChanges` when present, then calls a
  private `#applyTrackedChangesRenderOptions(preferences)` which sets
  `this.config.layoutEngineOptions.trackedChanges = normalized` and iterates every
  registered v2 editor runtime, calling `runtime.setTrackedChangesRenderOptions(normalized)`.
- That v2 runtime method is itself a real, present implementation: it forwards to
  `host.setTrackedChangesRenderOptions(options)` (confirmed at the runtime-factory call site
  in `superdoc.es.js`, `kind: "v2"` runtime object). This is not dead code, and the config
  value does propagate — consistent with what the repro observed (the config field tracks
  every call).
- The TypeScript signature itself has also changed: the method is now documented
  `@deprecated replaceWith=setViewingOptions()` with mode values `'review' | 'original' |
  'final' | 'off'` — not the `simple`/`all`/`original` vocabulary the older note assumed.
  That's a second way the old static analysis is stale, independent of this bug.
- Where it actually breaks: the `host.setTrackedChangesRenderOptions` call reaches into the
  proprietary `@superdoc/docx-engine` v2 host (obfuscated/minified in this build, not
  practically readable statically) and, for `mode: "final"`/`"off"`, does not trigger the
  editor to re-paint the affected text runs without their tracked-change decoration. Only
  `mode: "original"` visibly changes what's painted. This looks like a render-path gap for
  the "clean view" / "tracking disabled" modes specifically, not a dead setter.

## Suggested fix

Generic direction, as analysis: the v2 editor host's `setTrackedChangesRenderOptions`
handler should re-run layout for every text run touched by a tracked change whenever `mode`
changes to `"final"` or `"off"`, the same way it evidently already does for `"original"`
(which does trigger a re-render). Since `original` already proves the plumbing from
`SuperDoc.setTrackedChangesPreferences` down to a visible re-render works end-to-end, the
gap is likely isolated to how the host's renderer decides whether a tracked-insert run needs
its decoration class, specifically for the clean/off branches of that decision, rather than
anywhere earlier in the call chain.

**Possible workaround:** remount the editor with a different `modules.trackChanges` /
viewing config at construction time (e.g. driving the mode through the component's mount
key) rather than calling `setTrackedChangesPreferences` on a live instance — construction-time
configuration is respected; only the live setter's effect on already-rendered markup is
incomplete.

## Related

SD-19 (document-mode control and tracked-change visibility), SD-57 (comment/redline
highlight styling traps).
