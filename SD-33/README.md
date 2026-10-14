# SD-33 — Export is refused inside a collaborative session, but the documented save path works fine

**Summary:** `document.export.toDocx()` is refused for every mode while a document is open in a live
collaboration session, which is expected and still true. However, the documented alternative —
`document.save({ mode })` — is not broken: `mode: "review-preserving"` succeeds quickly from inside
a room, and only `mode: "final"` / `mode: "original"` are refused, each with a clear, actionable
error. The previously-reported "the suggested path hangs" and "no clean/final export from a live
room at all" claims do not hold on 2.23.0.

## Environment

- superdoc 2.23.0 / @superdoc/sdk 2.20.0 (bare SDK, `createSuperDocClient({ runtime: "v2" })`), Node (see repo `package.json`), headless — no browser needed for this repro.
- Collaboration: bare in-memory `@hocuspocus/server` via `harness/lib/collab-server.mjs`.
- Prior results referenced from background notes: 2.7.1 → ≥2.9.0 and sdk 2.16.0 saw `export.toDocx` throw `CAPABILITY_UNSUPPORTED: "export.toDocx is not supported on collaborative sessions; use the collaborative save path"`, with the suggested path reported to hang.
- **2.23.0 / sdk 2.20.0 result:** the `export.toDocx` refusal reproduces (message text has changed, see Actual); the "hangs" and "no export at all" claims do **not** reproduce — see Verdict.

## Steps to reproduce

UI-equivalent steps (bare SuperDoc, no integrator code):
1. Start a bare Hocuspocus room and seed it from a `.docx` file.
2. Open the same document a second time, joining that room (`roomMode: "join"`).
3. From the joined session, call `document.export.toDocx({ mode })` for `"original"`, `"review-preserving"`, and `"final"`.
4. Call `document.save({ mode: "final", out: <path>, force: true })`.
5. Call `document.save({ mode: "review-preserving", out: <path>, force: true })`.
6. Call `document.save({ mode: "original", out: <path>, force: true })`.
7. Close the room, open the same fixture standalone (no collaboration), and call `export.toDocx({ mode: "final" })` for contrast.

Script: `node SD-33/repro.mjs` (run from the repo root).

## Expected / Actual

| Call (in a live v2 room) | Expected (per background) | Actual on 2.23.0 |
|---|---|---|
| `export.toDocx({mode:"original"\|"review-preserving"\|"final"})` | Refused | Refused. `code: "CAPABILITY_UNSUPPORTED"`, `message: "The operation is unavailable while collaboration is active."` for all three modes — generic text, no longer literally says "use the collaborative save path" (wording has changed since the version this was first reported against). |
| `document.save({mode:"final"})` ("the collaborative save path") | Reported to hang | Resolves **instantly** (single-digit ms) by **throwing**, not hanging: `code: "CAPABILITY_UNSUPPORTED"`, `message: "V2 collaborative export does not support mode \"final\". Use mode \"review-preserving\" or a non-collaborative session."` |
| `document.save({mode:"review-preserving"})` | Not previously tested distinctly | **Succeeds** in ~20ms: `{saved:true, mode:"review-preserving", output:{byteLength:283539, report:{warnings:[]}}}`. A real, readable `.docx` is written to disk while still joined to the room. |
| `document.save({mode:"original"})` | Not previously tested distinctly | Refused the same way as `"final"`: `"V2 collaborative export does not support mode \"original\". Use mode \"review-preserving\" or a non-collaborative session."` |
| Standalone (no collaboration) `export.toDocx({mode:"final"})`, same fixture | N/A (contrast) | Succeeds normally (45395 bytes, no warnings) — confirms the restriction is collaboration-specific, not a general regression. |

## Evidence

Full captured output: `results-2.23.0.json`. Saved output file from the successful in-room call:
`sd33-save-review-preserving.docx` (283,539 bytes, `w:ins`/`w:del` counts 0/0 on this clean fixture,
`report.warnings: []`).

Exact error for the `export.toDocx` refusal (identical shape for all three modes):
```json
{ "message": "The operation is unavailable while collaboration is active.", "code": "CAPABILITY_UNSUPPORTED" }
```

Exact error for `document.save({mode:"final"})`:
```json
{ "message": "V2 collaborative export does not support mode \"final\". Use mode \"review-preserving\" or a non-collaborative session.", "code": "CAPABILITY_UNSUPPORTED" }
```

## Root cause / analysis

- `document.export.toDocx()` is a document-API-level call that is unconditionally disabled once a
  session is backed by collaboration (`requiresDocumentContext: true` operations appear to be
  gated as a class). This matches the original report and is presumably intentional: the document
  API mutates the in-memory story directly, which a collaboration session cannot safely reconcile
  with Yjs-backed shared state.
- The **documented alternative** is the SDK's session-level `doc.save` contract operation
  (protocol features `document.save` / `document.save.source`; exposed as `document.save(params)`
  with `{ sessionId?, out?, force?, mode?, inPlace? }`), described by the SDK's own contract
  introspection as: *"Save the current session to the original file or a new path. Supports
  explicit review-preserving, final, and original export modes."* On 2.23.0 this correctly
  special-cases the collaboration-unsafe modes (`final`, `original`) with a clear error, and
  **does** support the safe mode (`review-preserving`) from inside a live room.
- The earlier "hangs >25s" observation is not reproducible against bare SuperDoc's own documented
  save path on 2.23.0. (Hypothesis, not verified here: that symptom likely came from an
  integrator-side pattern — e.g. mounting a second, non-collaborative editor instance to work
  around the `export.toDocx` refusal, rather than calling the SDK's own `document.save` — which is
  out of scope for a bare-SuperDoc repro.)

## Suggested fix

As analysis, not a request: the `export.toDocx` error message on 2.23.0 ("The operation is
unavailable while collaboration is active.") no longer names the alternative the way the
older message did ("...use the collaborative save path"). Restoring that pointer in the error
text (or in the thrown error's `details`) would help integrators discover `document.save()`
without needing to read the CLI contract introspection, since the document-API object and the
session-level `save` operation live on the same `document` handle but aren't connected by the
error itself. Possible workaround for integrators in the meantime: call `document.save({mode:
"review-preserving", out, force: true})` for an in-room export, and leave the room (or open a
second, non-collaborative session on the same file) only when a true clean/`"final"` export is
needed.

## Related

SD-31 (browser `isFinalDoc` no-op), SD-32 (table-structure revisions surviving `mode:"final"`),
SD-24 (`doc.extract()` revision bump in collaboration).
