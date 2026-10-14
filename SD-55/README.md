# SD-55 — `ui.comments.reply()` fails with INVALID_CONTEXT, so replies never reach export

## Summary

Replying to an existing comment fails outright, both through the public `ui.comments.reply()`
API and through the built-in comment-card "Reply" button in the UI — neither path ever creates
the reply, and no error is shown to the end user through the UI path. Any counterparty or
internal reviewer who expects to discuss a comment thread on a contract (the single most common
redlining workflow) silently loses their reply: they type it, click "Reply", the composer just
sits there, and nothing is saved or exported.

## Environment

- **superdoc 2.23.0 / @superdoc/sdk 2.20.0: REPRODUCES** (this report; see below).
- superdoc 2.20.0 and 2.21.0: REPRODUCES (prior research, identical error code/message).
- Browser: Chromium via Playwright (headless), 1280×900.
- Mount: bare `new SuperDoc(...)`, no collaboration/room config — plain local `documentMode: "editing"`.

## Video

[`video/SD-55.mp4`](video/SD-55.mp4) (SuperDoc 2.23.0, Chrome, local harness). Submitting a reply leaves the text in the composer and adds no reply. The comment count stays at 2. Step-by-step timestamps: [`video/TIMESTAMPS.md`](video/TIMESTAMPS.md).

## Steps to reproduce

### UI steps
1. Open a document with an existing comment anchored to some text (see Fixture below).
2. Click directly on the commented text to open its comment card.
3. Click the "Reply or add others with @" pill at the bottom of the card.
4. Type a reply in the composer that appears (e.g. "Reply typed through the UI composer").
5. Click the "Reply" submit button.
6. **Observe:** nothing happens. The composer stays open with the typed text still in it, no
   new reply appears in the thread, and no error or toast is shown.

### Script
```bash
node SD-55/repro.mjs
```
Runs two independent sessions against the fixture below:
- **API path**: mounts SuperDoc, reads `ui.comments.list()`, calls
  `ui.comments.reply("1", { text: "Reply to first comment" })`, re-reads the list, calls
  `ui.comments.resolve("2")` as a control (a different, non-text comment mutation), exports the
  document, and inspects `word/comments.xml` / `word/commentsExtended.xml` in the result.
- **UI-card path**: clicks the commented text, opens the reply composer, types a reply, clicks
  the "Reply" button, and checks whether the composer closed and whether a reply was recorded.

## Expected / Actual

**Expected:** `ui.comments.reply()` succeeds, the reply shows up in `ui.comments.list()[...].replyCount`,
and round-trips into the exported `.docx`'s comments part. The UI composer closes and the reply
appears under the comment. (Note: this fixture also carries a *second*, independent comment
sharing the same anchor; loading and exporting it works correctly, so this one-liner is only
about the reply/threading path, not anchor sharing.)

**Actual** (2.23.0):
- `ui.comments.reply("1", { text: "Reply to first comment" })` →
  `{ "success": false, "failure": { "code": "INVALID_CONTEXT", "message": "unsupported-context" } }`.
  `replyCount` on comment "1" stays `0`, and the total comment count is unchanged (`2`).
- `ui.comments.resolve("2")` on the same live session **succeeds**
  (`{"success":true,"updated":[...],"txId":"tx-..."}`) — so comment mutations are not categorically
  blocked; specifically the reply/threading path is.
- The exported `.docx` (`exported.docx`) has exactly the original 2 `<w:comment>` entries in
  `word/comments.xml`, no reply thread. `word/commentsExtended.xml` is present (it was not emitted
  on 2.20.0/2.21.0) but only records the `resolve("2")` call (`w15:done="1"`) — no
  `w15:paraIdParent`, i.e. no threading relationship, since no reply was ever created.
- Through the UI composer: clicking "Reply" after typing text produces **no visible error, no
  console error, no `onException`**. The composer simply stays open with the typed text still in
  the textarea, and `ui.comments.list()` afterward shows `replyCount: 0` — i.e. the UI path hits
  the same failure as the API path, just swallowed silently instead of surfacing the
  `WorkflowReceipt` failure anywhere a user could see it.

## Evidence

`results-2.23.0.json` (full raw output). Key figures:

| check | value |
|---|---|
| comments loaded before reply | 2 (`commentId` "1" and "2", both anchored to the same text) |
| `reply("1", {...})` result | `{success:false, failure:{code:"INVALID_CONTEXT", message:"unsupported-context"}}` |
| `replyCount` on comment "1" after reply attempt | 0 |
| `resolve("2")` result (control) | `{success:true, ...}` |
| exported `<w:comment>` count | 2 (unchanged) |
| exported `commentsExtended.xml` | present, 1 entry, `w15:done="1"` only (resolve, not a reply) |
| UI composer after clicking "Reply" | still open, still contains the typed text |
| `replyCount` on comment "1" after UI submit attempt | 0 |
| console/`onException` errors (either path) | none |

Screenshots (`screenshots/`):
- `01-loaded.png` — document loaded, both comments present.
- `02-after-api-reply.png` — same view after the failed `reply()` API call (unchanged).
- `03-card-opened-by-click.png` — the real comment card, opened by clicking the commented text,
  showing "First comment" and the "Reply or add others with @" pill.
- `04-reply-composer-filled.png` — the reply composer expanded with "Reply typed through the UI
  composer" typed in, "Reply" button enabled.
- `05-after-clicking-reply-button.png` — after clicking "Reply": byte-for-byte the same state as
  `04-reply-composer-filled.png` (composer still open, text still there, no reply added, no error
  shown).

## Root cause / analysis

`ui.comments.reply()` returns a typed `WorkflowReceipt` failure with `code: "INVALID_CONTEXT"` and
`message: "unsupported-context"` rather than throwing or calling `onException`. This happens in a
plain, non-collaboration, local-editing session — no room, no server, no `collaboration` config
at all. Every other comment mutation tried in the same session (`resolve`) succeeds normally, so
this is not a blanket "comment mutations disabled" gate; it is specific to the reply/threading
code path. The built-in comment-card "Reply" button goes through the same code path and gets the
same failure, but the card's own UI does not surface the `WorkflowReceipt`'s `failure` to the
user in any way (no toast, no inline error, no disabled state) — it just silently no-ops, which
from an end user's perspective looks like "I clicked Reply and nothing happened."

**Hypothesis:** `reply()` may be routed through the same byte-apply/mutation gate that is
documented elsewhere as collaboration-room-specific (`unsupported-context` has been seen
blocking some mutations only inside v2 collaboration rooms). This repro shows the gate — or at
least this error code/message — also fires in a session with no collaboration room configured at
all, which would mean either the gate's scope is broader than documented, or `reply()`
unconditionally routes through a context check that assumes a collaboration context exists.

## Suggested fix

As analysis, not a patch: `ui.comments.reply()` should succeed in a plain local-editing session
(no collaboration room), the same way `resolve()` already does. Whatever context check is
raising `unsupported-context` should either not apply to local sessions, or should be fixed to
recognize a valid local editing context. Separately, the comment-card UI should surface a
`WorkflowReceipt` failure to the user (toast/inline error) instead of leaving the composer open
with no feedback — a silent no-op on a primary interaction (clicking the only visible "Reply"
button) is a worse user experience than a loud failure.

**Possible workaround:** none identified that preserves normal reply semantics; an integrator
could poll `replyCount` after calling `reply()` and surface their own error toast to the user
when it does not increase, since SuperDoc's own card gives no indication of the failure.

## Related

None in this batch.
