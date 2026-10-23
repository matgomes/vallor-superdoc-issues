# SD-109 — `@superdoc/sdk` 2.23.0-next can't join a collaboration room of some documents (`COLLAB_V2_PROJECTION_VALIDATOR_FAILED`)

## Summary

On `@superdoc/sdk` 2.23.0-next.11 and 2.23.0-next.13, a client can't **join** an existing v2 collaboration room
of the SD-105 contract. `client.open({ collaboration: { roomMode: "join" } })` rejects with
`COMMAND_FAILED: collaboration save barrier failed: COLLAB_V2_PROJECTION_VALIDATOR_FAILED`. The same calls succeed on
2.22.0.

Creating the room from the `.docx` works, and so does opening the file without a room. Only the join fails, so any
headless participant (an agent, a server-side editor) can no longer open a document once a room exists for it.

A room seeded by the SDK and a room created by the browser editor (superdoc 2.20.0 and 2.26.0-next.11) both fail
the same way.

## Environment

- **`@superdoc/sdk` 2.23.0-next.11 and 2.23.0-next.13: REPRODUCE**, see [`results.txt`](results.txt).
- **`@superdoc/sdk` 2.22.0 (this repo's pin): does not reproduce.**
- Node 24, headless `@superdoc/sdk` (native host, runtime v2), bare `@hocuspocus/server` room (no persistence, no
  auth). No integrator code involved.

## Fixture

The SD-105 contract, both versions:

- [`SD-105/tracked-paste-schedule.docx`](../SD-105/tracked-paste-schedule.docx): a 12-page contract with a multi-page
  schedule pasted in with track changes on (an 8-row table, 1,629 `w:ins`).
- [`SD-105/tracked-paste-schedule-accepted.docx`](../SD-105/tracked-paste-schedule-accepted.docx): the same content
  with every insertion accepted. **Fails too**, so tracked changes are not the trigger.
- Control: [`SD-105/synthetic-control-no-tracking.docx`](../SD-105/synthetic-control-no-tracking.docx) joins normally.

We ran the same join against 154 anonymised contracts with 2.23.0-next.11: only copies of this document fail.

## Steps to reproduce

### Any document
1. Open the document in a collaboration room (`roomMode: "create"`).
2. Join the same room from a second client (`roomMode: "join"`).
3. The join rejects with `COLLAB_V2_PROJECTION_VALIDATOR_FAILED`.

### Script
```sh
node SD-109/repro.mjs SD-105/tracked-paste-schedule.docx SD-105/tracked-paste-schedule-accepted.docx SD-105/synthetic-control-no-tracking.docx

# another SDK version, installed elsewhere:
mkdir /tmp/sdk-next && (cd /tmp/sdk-next && npm i @superdoc/sdk@2.23.0-next.13)
SDK_DIR=/tmp/sdk-next node SD-109/repro.mjs SD-105/tracked-paste-schedule.docx
```
For each file it opens the document without a room, creates a room from it with one client, then joins that room
with a second client.

## Expected / Actual

Expected: the second client joins the room, as on 2.22.0.

Actual:

```text
@superdoc/sdk 2.22.0
SD-105/tracked-paste-schedule.docx
  open without a room: ok
  create room: ok
  second client joins: ok (revision 1)

@superdoc/sdk 2.23.0-next.11   (2.23.0-next.13 is identical)
SD-105/tracked-paste-schedule.docx
  open without a room: ok
  create room: ok
  second client joins: COMMAND_FAILED: collaboration save barrier failed: COLLAB_V2_PROJECTION_VALIDATOR_FAILED
SD-105/tracked-paste-schedule-accepted.docx
  second client joins: COMMAND_FAILED: collaboration save barrier failed: COLLAB_V2_PROJECTION_VALIDATOR_FAILED
SD-105/synthetic-control-no-tracking.docx
  second client joins: ok (revision 1)
```

- `error.details` carries only `{ "name": "Error" }`, so nothing tells the integrator which part of the document the
  validator rejected.
- Joining a room that the browser editor created (superdoc 2.20.0 or 2.26.0-next.11) fails the same way. The browser
  editor itself opens those rooms normally.
- A headless participant that disconnects (for example after an idle timeout) can't rejoin: a fresh client joining
  after the room was seeded fails the same way.

## Root cause / analysis

Our reading: the failure is in the join path's save barrier, where the joining client projects the room content and
its validator refuses it. Creating the room from the same `.docx` succeeds, so the join path rejects content the create
path accepted. Because the accepted copy fails too, the trigger is in the
document's structure (the pasted schedule and its table are the likely area), not in the tracked revisions.

## Suggested fix

- Make the join-path projection agree with the create path for this document, or have the validator report what it
  rejected (block id, node type, reason) in `error.details`.
- 2.22.0 joins the same rooms and edits them without issue, so the regression is between 2.22.0 and 2.23.0-next.11.

## Related

- [SD-105](../SD-105/): same document; tracked insertions freeze the editor.
- [SD-62](../SD-62/): collaboration room tooling (initial-sync barrier for headless clients).
