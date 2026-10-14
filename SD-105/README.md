# SD-105 — Documents with many tracked insertions freeze the editor (scroll, clicking a change, editing)

## Summary
On a document carrying a large block of tracked insertions (a multi-page schedule pasted with track changes on, including an 8-row table), scrolling the whole document takes ~14 seconds (vs ~2 seconds for the same document with every insertion accepted, or an untracked control), typing/deleting inside the tracked text takes seconds per keystroke batch instead of milliseconds, and the JS heap grows several times over while scrolling. For end users this means any contract or redline with a sizeable batch of tracked changes — a common outcome of pasting a schedule or exhibit with track changes on — becomes effectively unusable: the editor stutters on every scroll, and typing inside the reviewed text lags by multiple seconds per character batch.

## Environment
- **superdoc 2.23.0** (pinned in this repo's `package.json`, paired with `@superdoc/sdk` 2.20.0): **REPRODUCES** — see Evidence below. Bare `new SuperDoc(...)` mount via this repo's `harness/`, no collaboration, no custom UI.
- **superdoc 2.20.0**: reproduces as well, per prior research (not re-run in this repo; see `results-scroll-2.20.0.json`-equivalent figures cited in Evidence — numbers are close to 2.23.0, within ~5%).
- Browser: Chromium (Playwright, headless), 1280×900. Node 24.
- **Hardware: every number in this folder was measured on an Apple MacBook M4, a fast machine.** On weaker machines, which is what our customers use, the results are **far worse**: the editor becomes unusable and the browser tab crashes. The 13–14 s scroll and the multi-second stalls here are a best case.
- Fixtures are bare `.docx` files mounted directly; no Vallor application code is involved.

## Video

SuperDoc 2.23.0, Chrome, local harness, **MacBook M4**. Both takes do the same thing: click **Scroll to end** (a harness button that scrolls the whole document in 60 steps as fast as the page can draw and prints the time), scroll up to the schedule table, click a redline, then click **Scroll to top**. The overlay shows frame time and the number of frames over 500 ms ("stalls").

| Take | Scroll to end | Scroll to top | Stalls > 500 ms |
|---|---|---|---|
| [`video/SD-105-a.mp4`](video/SD-105-a.mp4): 1,629 tracked insertions ([timestamps](video/TIMESTAMPS-a.md)) | **12.2 s** | **14.5 s** | **14** |
| [`video/SD-105-b.mp4`](video/SD-105-b.mp4): same document, insertions accepted ([timestamps](video/TIMESTAMPS-b.md)) | 3.8 s | 3.8 s | 0 |

On weaker machines than the M4, which is what our customers use, it is far worse: the editor becomes unusable and the browser tab crashes.

## Steps to reproduce

**UI steps:**
1. Open the harness on `SD-105/tracked-paste-schedule.docx` in `editing` mode (`harness/index.html?doc=SD-105/tracked-paste-schedule.docx&mode=editing`).
2. Scroll from the top of the document to the bottom. Observe stuttering and multi-second frame stalls partway through.
3. Open the same harness in `suggesting` mode. Click into a table cell inside the pasted schedule table (e.g. the cell containing "Disclosure Or Transfer") and type a few characters, then press Backspace a few times. Observe a multi-second delay between each keystroke batch and the character actually appearing/disappearing.
4. Repeat steps 1–3 against `SD-105/tracked-paste-schedule-accepted.docx` (same content, all insertions accepted) and notice scrolling and typing are both near-instant.

**Script:** `node SD-105/repro.mjs` (run from the repo root). It runs, in order:
1. A 60-step top-to-bottom scroll on the tracked fixture, the accepted-baseline fixture, and an untracked control, recording total scroll time, per-frame timings, Long Tasks, JS heap, DOM node counts, and tracked-change element/alias counts.
2. Typing 10 characters and pressing Backspace 5× inside the pasted table, in `suggesting` mode, on the tracked fixture and the accepted baseline, measuring time from first keydown to the DOM settling.
3. Scrolling to the bottom of the document and clicking the last visible tracked-change element (preferring a grouped/table-type change), with `ui.comments.layout: "auto"` enabled, measuring settle time, max frame, and Long Tasks in the click→settle window.
4. A stepped (20-step) scroll of a synthetic 2,000-tracked-insertion file, with a time budget so a runaway step doesn't block the suite indefinitely.

Writes `results-2.23.0.json` and prints a PASS/FAIL line per measurement.

## Expected / Actual

**Expected:** scrolling, clicking a change, and editing cost roughly the same regardless of how much tracked-change markup is on the painted pages — comparable to the accepted/untracked baselines (~2 s full scroll, no multi-second frames, edits in tens to low hundreds of milliseconds).

**Actual (2.23.0, this run):**

| Measurement | Tracked (158 review items) | Accepted baseline | Untracked control |
|---|---|---|---|
| Full scroll, 60 steps | **13.7 s** | 2.0 s | 2.0 s |
| Scroll frame p95 / max | **1194 / 1430 ms** | 41 / — ms | 34 / — ms |
| Long tasks during scroll | **42, totaling 11.8 s** | 1, 58 ms | 1, 57 ms |
| JS heap before → after scroll | **122 → 351 MB** | 121 → 145 MB | 103 → 119 MB |
| Typing 10 chars, settle time (suggesting mode) | **2656 ms** | 1551 ms | n/a |
| Backspace ×5, settle time | **4694 ms** | 753 ms | n/a |

Typing/backspace settle time includes the deliberate per-keystroke delay used to drive the keyboard (so the accepted-baseline numbers are not themselves near-zero), but the tracked-vs-accepted ratio isolates the extra engine cost: **~6× slower on Backspace**, consistent with prior research's 2.20.0/2.23.0 numbers (there: 6010–6700 ms tracked vs 753–768 ms accepted baseline).

A synthetic 2,000-tracked-insertion file (worse than any real document we've seen) makes the degradation severe enough to threaten the renderer: stepping through a 20-step scroll, frame times reach **8–34 seconds per step** from step 8 onward, and the JS heap climbs past **1.1 GB** before the run's time budget stops it.

**Click a cell of the pasted table (headful re-check, `node SD-105/click-table-change.mjs`):** the clicked element carries **273 aliased revision ids**, yet on a bare mount the click settles in ~313 ms with no Long Tasks (max frame 75 ms, tab visible). So on 2.23.0 the multi-second click stall needs an integrator's review UI that reads the active tracked change/comment through the comments store (the alias-scan path described in Root cause #5). Bare SuperDoc doesn't trigger it on its own. Raw output: `results-click-2.23.0.json`.

**Click a tracked change near the bottom of the document:** attempted on a bare mount (editing mode, `ui.comments.layout: "auto"`, no custom review-sidebar wiring) — settle time ~5 ms, max frame ~18 ms, no Long Tasks in the click→settle window. This specific sub-symptom (multi-second stall on click) did **not** reproduce via a bare mount on 2.23.0. Prior research notes this measurement specifically needed a host application embedding SuperDoc with its own review/comments-sidebar UI active; a bare `new SuperDoc(...)` mount, even with the comments layout config set, does not appear to exercise the same code path. We cannot confirm from this harness alone whether the click-stall is fixed on 2.23.0 or whether it still requires host-app sidebar wiring to trigger — flagging as unresolved rather than claiming either verdict.

No `onException` crashes were observed (`window.__errors` stayed empty aside from one unrelated, non-fatal `onException` — `"section identity metadata could not be resolved from source signals"` — that fires on every document open regardless of tracked-change content, so it is not specific to this bug).

## Evidence
Raw output: `results-2.23.0.json`. Screenshots: `screenshots/tracked-table-with-insertions.png` (the pasted schedule table mid-document, with tracked-insertion decoration visible), `screenshots/click-bottom-tracked.png` (state after scrolling to the bottom and clicking the last tracked change).

Full numeric detail (DOM node counts, layout/recalc-style counts, per-step synthetic-scroll timings) is in `results-2.23.0.json`. Selected rows from that file:
- Tracked fixture: 59 DOM elements carry tracked-change data attributes; one element accumulated 41 aliased revision ids after a single scroll pass (prior research, which repeatedly scrolled the same session, saw this grow into the hundreds — the growth is directional and session-cumulative, not a fixed count).
- `layoutCount`/`recalcStyleCount` deltas during the tracked-fixture scroll (299 / 342) dwarf the accepted baseline (69 / 88) and the untracked control (26 / 27) even though all three fixtures scroll the same viewport distance.

## Root cause / analysis
*(Carried over from prior research; code-level findings from CPU-profile and precise-coverage analysis of the bundled `@superdoc/docx-engine`. Internal function names are minified and given here only as hypothesis-level pointers for the vendor's own source, not confirmed against original source.)*

1. **Tracked-change decoration refresh scales as items × painted elements × aliases.** A refresh routine runs on every visible-window commit (i.e., every scroll-triggered paint). For each review item it walks every painted tracked-change element and, per alias id, re-reads and re-splits a `data-track-change-ids` attribute rather than using a precomputed index. This turns a single top-to-bottom scroll into tens of millions of comparison calls.
2. **Decoration rewrites every class/CSS custom property on every pass, even when nothing changed.** The decoration layer appears to strip and reapply tracked-change classes and inline custom properties unconditionally on each paint rather than diffing against the previous state, producing a large number of attribute mutations (the large majority no-ops) that each invalidate style and force recalculation across the whole mounted DOM.
3. **Alias explosion.** A grouped/structural change (e.g. a table insertion) appears to stamp all of its raw revision ids onto every element it paints, and these id lists appear to grow (merge) across repeated paints rather than being recomputed from scratch, so the same element can accumulate hundreds to thousands of aliased ids over a session.
4. **Geometry sweep appears quadratic in aliases.** The DOM sweep that positions review/change anchors appears to dedupe an element's ids with an O(n) `includes`-style check per id (making the dedupe step itself quadratic), then measures and walks the DOM once per `(story, id)` group rather than once per element — with thousands of aliases this becomes millions of pairwise operations per sweep, which is consistent with the multi-second to tens-of-seconds frames seen on the synthetic 2,000-insertion fixture.
5. **Clicking a change** is hypothesized (per prior research, not independently confirmed via the bare mount in this pass) to route through a comments-store lookup that scans every comment × every alias and, on a miss, falls back to a full scan of a reactive position map — repeated on every subsequent "active comment" recalculation. This was only observed to cause multi-second stalls in a host application with an active review sidebar; it did not reproduce via a bare mount with just `ui.comments.layout: "auto"` set (see Expected/Actual above).
6. **A floating review sidebar, when present,** appears to mount/unmount a large number of card elements on every scroll pass and force-measure each one (`getBoundingClientRect`, `scrollHeight`, `getComputedStyle` walks) — again only observed in a host application with that UI active, not reproduced via the bare harness here.
7. **A permanent per-frame poll** appears to run for the life of the editor, checking a render-epoch value every animation frame rather than being driven by an event.
8. **Editing inside tracked text is slow in the document-processing path itself**, independent of collaboration, table structure, or revision granularity (all ruled out by prior controlled variants) — the cost looks proportional to the size of the tracked insertion being split around the edit point.

## Suggested fix
Fix directions (from our analysis):
- Build an id → elements index once per decoration pass instead of re-deriving it per item × element × alias.
- Compute the target decoration state and write only the attributes that actually differ, instead of unconditionally stripping and reapplying every class/property on every pass.
- Track one logical id per element (with a side lookup table), or deduplicate/cap aliases per logical change, instead of accumulating and merging raw ids onto every painted element.
- Use a `Set` for id dedupe in the geometry sweep, cache page-index lookups per sweep, and measure each element once regardless of how many aliases it carries.
- If the comments-store position lookup is indeed the cause of click stalls, replace the per-click full scan with a precomputed (e.g. memoized/computed) alias → position index.
- Keep review-sidebar cards mounted (windowed/overscan) rather than mounting and unmounting on every scroll pass, and batch their geometry measurements.
- Replace the per-frame render-epoch poll with an event fired only when the epoch actually changes.
- Consider incremental handling of edits that split an existing tracked insertion, rather than reprocessing proportional to the full insertion's size.

**Possible workaround for integrators:** where acceptable, prompt the end user to accept or reject large batches of tracked insertions (e.g. right after a bulk paste) rather than leaving thousands of insertions live in the document; the accepted-baseline measurements above show the editor is fast once that markup is gone. For review-heavy workflows, consider disabling the floating review sidebar (`ui.comments.layout`) on very large tracked-change counts as a stopgap, per the sidebar-churn hypothesis above.

## Related
SD-83 (document-wide geometry / painter DOM limitations), SD-85 (typing is slow in the engine generally — this issue isolates the specific, much larger tracked-insertion case with a measured, reproducible cause).
