# SD-60 — Wrong `roomMode` gives a typed error, not the originally-reported blank editor

## Summary

Opening a collaboration room with the wrong `roomMode` (creating one that already exists, or
joining one that was never created) fails with a clear, typed exception and a proper "Couldn't
open document" error card in both cases on 2.23.0. This matches the *error codes* from the
original report but **not** the originally-reported symptom of a blank editor with no visible
error — that part looks fixed. Still worth reporting because `roomMode` mismatches are an easy
integrator mistake (e.g. a remount reusing stale room-existence state) and the failure mode is
worth the vendor's documentation/stability attention even though the UX around it has improved.

## Environment

- **superdoc 2.23.0 / @superdoc/sdk 2.20.0: both scenarios below REPRODUCE the error code**; the
  "blank editor, no visible error" half does **not** reproduce — a clean error card renders
  instead (this report).
- superdoc 2.20.0 and 2.21.0: same as 2.23.0 (prior research) — error codes present, error card
  renders, no blank-editor symptom.
- Original report (sdk 2.7.1): `{code: "collaboration-v2-room-already-exists", editor: null}`
  with a blank editor and no visible error for the create-on-existing-room case; `worker-init-failed`
  / "browser worker failed to start" for the join-unseeded case.
- Hocuspocus: bare `@hocuspocus/server` 2.15.3 (`harness/lib/collab-server.mjs`), no Redis, no
  persistence extension, no auth.
- Browser: Chromium via Playwright (headless), 1000×700.

## Steps to reproduce

### UI steps
1. Start a bare Hocuspocus server with no persisted rooms.
2. Open SuperDoc against a brand-new room id with `roomMode: "join"` (nothing was ever created
   there) and local seed data alongside the collaboration config.
3. **Observe:** a red "Couldn't open document" card: "No v2-format collaborative document was
   found in this room."
4. Open SuperDoc against a different, fresh room id with `roomMode: "create"` — this succeeds and
   the editor loads normally. Keep that session's connection open.
5. In a second session, open SuperDoc against the **same** room id from step 4, again with
   `roomMode: "create"`.
6. **Observe:** a red "Couldn't open document" card: "This collaboration room already exists and
   must be joined instead of created."

### Script
```bash
node SD-60/repro.mjs
```
Starts a bare Hocuspocus server and three browser sessions: join an unseeded room, create a fresh
room (kept open), then create again on that same room id. Captures `onException` payload,
`activeEditor == null`, and a screenshot for each.

**Collab gotcha applied here:** the bare Hocuspocus server has no persistence extension, so a room
only exists while at least one client stays connected to it. The "create first" session's browser
is kept open through the "create again" attempt and only closed afterward — closing it first
would make the room disappear and the second `create` would silently succeed on a fresh room
instead of hitting `collaboration-v2-room-already-exists`.

## Expected / Actual

**`roomMode: "create"` on an existing room**
Expected (per the original report, sdk 2.7.1): `{code: "collaboration-v2-room-already-exists",
editor: null}`, blank editor, no visible error.
Actual (2.23.0): **error code matches.** `onException` fires with
`{"code":"collaboration-v2-room-already-exists","message":"SuperDoc v2 was asked to create a
collaboration room that already exists. Use roomMode: \"join\" to open it."}`. `activeEditor` is
`null`. But a proper error card renders ("Couldn't open document" / "This collaboration room
already exists and must be joined instead of created.") — **not** the blank-editor-with-no-visible-error
originally reported.

**`roomMode: "join"` on an unseeded room**
Expected (per the original report, sdk 2.7.1): `code: "worker-init-failed"`, "SuperDoc could not
load the document editor because the browser worker failed to start", `editor: null`.
Actual (2.23.0): a **different, more specific** error fires:
`{"code":"collaboration-v2-room-missing","message":"SuperDoc v2 could not find a committed v2
collaboration room. No changes were made. Use roomMode: \"create\" only when creating a new
room."}`. `activeEditor` is `null`, and a proper error card renders. No `worker-init-failed` code
or "browser worker failed to start" string appears anywhere.

## Evidence

`results-2.23.0.json` (full raw output):

| scenario | code | `activeEditor == null` | error card shown |
|---|---|---|---|
| join unseeded room | `collaboration-v2-room-missing` | true | yes |
| create on existing room | `collaboration-v2-room-already-exists` | true | yes |

Screenshots (`screenshots/`):
- `01-join-unseeded.png` — "Couldn't open document" / "No v2-format collaborative document was
  found in this room."
- `02-create-first.png` — editor loads normally (this session creates the room).
- `03-create-again.png` — "Couldn't open document" / "This collaboration room already exists and
  must be joined instead of created."

## Root cause / analysis

Both failure modes share one underlying shape: a transport error surfaced with a `reason`/`code`
field that discriminates `collaboration-v2-room-already-exists` from `collaboration-v2-room-missing`.
This is a cleaner, more consistent, and more specific error contract than the two previously
unrelated-looking symptoms in the original report (a vague `worker-init-failed` for one case, a
blank editor for the other) — this looks like a genuine diagnostic/UX-quality improvement that
landed between sdk 2.7.1 and the versions tested here. The remaining integrator-facing risk is not
in SuperDoc's error handling itself but in whatever causes a caller to pick the wrong `roomMode`
in the first place — e.g., a client-side remount that reuses a stale "does this room exist yet"
flag across a prop/key change, calling `create` on a room it already created earlier in the same
session. That is an integration pattern to avoid, not a SuperDoc defect, so it is out of scope for
this report.

## Suggested fix

As analysis: the current behavior (typed error code + user-facing error card) already addresses
the originally-reported "blank editor, no visible error" complaint. No further vendor-side fix is
indicated by this report; the error codes and messages are clear and actionable. If anything,
documenting the full `roomMode` error contract (`collaboration-v2-room-already-exists`,
`collaboration-v2-room-missing`, and whatever other `reason` values exist) would help integrators
build correct retry/UX logic around them.

**Possible workaround:** none needed for SuperDoc's behavior itself. An integrator who wants to
avoid ever hitting `roomMode` mismatches should have the server mint the room (and know definitively
whether it already exists) before telling any client whether to `create` or `join`, rather than
letting client-side state decide.

## Related

SD-70 (another collaboration room lifecycle timing bug — `onReady` firing before the room has
actually committed its first mutation).
