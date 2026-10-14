# SD-51 — New comment markers invisible while a collaborator streams edits (NEEDS REPRO on 2.23.0)

## Summary

Internally reported symptom: while edits stream in from a collaborator faster than roughly every
6.5 seconds, a newly created comment's marker stays invisible to a browser client, because
`ui.comments`'s directory read is gated by an idle hold that each incoming remote change resets —
so a continuously-active collaboration session could leave a reviewer unable to see new
comments/markers until editing pauses. This would matter most for an AI agent actively editing a
shared document while a human reviewer watches the same room. This report could **not** trigger
the described invisibility on 2.23.0 after two different streaming approaches — see below — so the
verdict is NEEDS REPRO.

## Environment

- **superdoc 2.23.0 / @superdoc/sdk 2.20.0: NEEDS REPRO** — could not trigger sustained invisibility
  of a new comment via script (this report).
- Not previously tested on earlier versions with a script (originally observed around sdk ~2.7–2.8,
  no prior repro existed for this issue).
- Bare Hocuspocus 2.15.3 (`harness/lib/collab-server.mjs`), browser joiner + a separate headless
  `@superdoc/sdk` "collaborator" client joined to the same room, both via `roomMode: "join"`.

## Steps to reproduce (attempted)

```bash
node SD-51/repro.mjs
```

**Scenario 1 — text-edit stream:** a headless SDK client joins the room and creates a new comment,
then immediately begins inserting a few characters into a different paragraph every **2 seconds**
(faster than the claimed 6.5s idle window), 8 times (~16s of continuous streaming). Meanwhile a
browser client, joined to the same room, polls `ui.comments.getSnapshot().total` every 500ms
throughout the stream and for 8 seconds after it stops.

**Scenario 2 — comment-creation stream:** instead of plain text edits, the headless collaborator
creates 6 **new comments**, one every 1.5 seconds (faster than 6.5s), directly stressing the
comments-specific read path. The browser polls the same way.

## Expected / Actual

**Expected (if the bug reproduces):** in scenario 1, `ui.comments.getSnapshot().total` should stay
at its pre-stream value (not reflecting the new comment) for the whole ~16s of streaming, then
jump to include the new comment only once edits stop and ~6.5s of quiet has passed. In scenario 2,
the running comment count should lag well behind the true count while comments keep arriving every
1.5s.

**Actual:**
- **Scenario 1:** the new comment became visible (`total` went from 0 to 1) in well under a
  second after creation, and stayed visible for the rest of the stream and afterward — it was
  never invisible at any polled point, including during active text-edit streaming.
- **Scenario 2:** the comment count tracked the real count closely throughout — by the time the
  6th comment was created (~7.5s into the stream), `total` had already reached 6, and it stayed at
  6 (the fully correct count) for the rest of the observation window.

No exceptions or console errors in either scenario.

## Evidence

`results-2.23.0.json` (full raw output, both scenarios, full poll logs). Key figures:

| scenario | comment visible within | ever invisible once created | final total vs. expected |
|---|---|---|---|
| text-edit stream (edits every 2s, ~16s) | <1s | no | 1/1 (correct) |
| comment-creation stream (comments every 1.5s, 6 total) | tracked in near real time | no | 6/6 (correct) |

Screenshots (`screenshots/`): `01-text-stream-joined.png` (before the stream starts),
`02-text-stream-ended.png` (immediately after the 16s stream), `03-text-stream-after-quiet-period.png`
(after an 8s quiet period) — all three show the document in its expected state, with no visible
difference attributable to the stream.

## Root cause / analysis

Not confirmed on 2.23.0. The internally-reported mechanism describes `ui.comments` reads going
through an internal `readAsync("comments")`-style coordinator gated by a roughly 6.5-second idle
hold (`HEAVY_READ_IDLE_MS`), where any `collaboration:remote-changed` event resets the hold's
clock — meaning a continuously-streaming collaborator could keep the hold open indefinitely and
delay the comments directory's (re-)population. Two explanations for why this report did not
reproduce that:

1. **The hold may gate only the first/cold read**, not every subsequent read. If the comments
   directory, once populated, updates incrementally on each remote change (rather than being
   wholesale invalidated and re-fetched through the same gated path every time), then a comment
   created mid-stream would still show up promptly even while the hold is "open," because the
   update path for an already-warm cache may not be the same code path the hold protects.
2. **The originally-reported full symptom may depend on integrator-side code** layered on top of
   bare SuperDoc. The prior internal investigation that produced this hypothesis also named a
   specific client-side component (a marker-rendering layer that filters DOM marks through a
   "known comment ids" set, derived from `ui.comments.list()`) as part of the chain that makes a
   stale read visually manifest as "the marker never appears." That filtering layer is an
   integrator's own code, not part of bare SuperDoc, and is not present in this harness's bare
   mount — so even if the underlying `readAsync` hold does delay a read in some conditions, this
   report's bare-SuperDoc test would not show the downstream visual symptom the same way a host
   application with that extra layer would.

## Suggested fix

Not applicable until reproduced on bare SuperDoc. If the vendor can confirm the `readAsync` idle
hold does still gate the comments directory under some condition this report did not hit (e.g. a
higher remote-change rate, a different kind of remote change, or sustained local typing rather
than only remote edits), the general direction would be: a continuously-active collaboration
session should not indefinitely delay a read that has a legitimate, discrete trigger (a new
comment was created) — the hold's reset condition should distinguish "this change could invalidate
affected cached data" from "any remote activity happened, keep waiting."

**Possible workaround:** none needed, since the failure was not reproduced on bare SuperDoc in the
conditions tried. If an integrator's own marker-rendering layer filters against a cached
"known ids" set the way described above, that layer should refresh its known-ids set against
`listStatus`/explicit invalidation events rather than assuming a quiet period has occurred.

## Related

SD-70 (another collaboration-timing-sensitive report that also did not reproduce on 2.23.0),
SD-55/SD-52 (the separate, confirmed ~1s async-population delay in `ui.comments` on first read,
which is a real but much shorter and non-collaboration-specific timing quirk, distinct from the
multi-second "held open by streaming" mechanism this report describes).
