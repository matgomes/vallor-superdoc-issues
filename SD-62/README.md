# SD-62 — Collaboration room tooling: no delete/evict, no initial-sync barrier, no per-edit durability ack

## Summary
Four related gaps make collaboration-room lifecycle management hard to build correctly on
top of SuperDoc: there is no API to delete or evict a room (a "reset" has to rotate the
room name instead), there is no awaited barrier for "this room has finished its initial
sync" before a headless client safely acts on it, and there is no per-edit acknowledgement
that an edit is durable (persisted/broadcast), only that it was applied locally. One
closely related claim — "no client-side liveness/connection-status signal" — **is now
available** in 2.23.0 and is reported separately below rather than folded into the gap.

## Why it matters
An integrator (e.g. a contract-redlining product) that runs a collaboration room per
document and wants to let a background agent safely read/write a freshly-created or
freshly-joined room, or wants to "reset" a document's live session (e.g. after a bad
edit or to force a clean reseed), has no first-class way to do either. Both have to be
built as application-level conventions (rotate the room name on reset; poll/guess when a
room is "ready enough") instead of calling a SuperDoc/Hocuspocus API.

## What we tried / closest APIs

### 1. No room delete/evict (still missing)
`@hocuspocus/server` 2.15.3 (the version SuperDoc pins) exposes document lookup only
through `Hocuspocus`'s internal documents map — `get` / `getDocument` / `has` /
`releaseConnection` (see `node_modules/@hocuspocus/server/dist/packages/server/src/Hocuspocus.d.ts`
and `Document.d.ts`). There is no `delete`/`evict`/`destroyDocument` call. The only way to
stop serving the current contents of a room is to close every connection and let the
in-memory document get garbage-collected (bare server, no persistence extension) — or, in
a persisted deployment, to rotate to a new room name so the old one is never joined again.
On the SuperDoc/SDK side, `roomMode` is only `'join' | 'create'` end to end (confirmed in
both `node_modules/superdoc/dist/superdoc/src/core/types/index.d.ts` and
`node_modules/@superdoc/sdk/dist/generated/client.d.ts`) — no `'delete'`/`'reset'` value
exists.

### 2. No client-side liveness/connection-status signal — **now available in 2.23.0**
This sub-claim is **fixed / now available**. `node_modules/superdoc/dist/superdoc.es.js`
bridges a v2 editor's `connection.subscribe(...)` into a public, multi-fire
`collaboration-connection-change` event (`Config.onCollaborationConnectionChange`, and a
synchronous `superdoc.getCollaborationConnectionState()` getter for late readers) — see
`SuperDoc.d.ts:89,355-357` and the `#startV2ConnectionBridge` implementation around
`superdoc.es.js:46844-46880`. Payloads carry `state` (`'synced' | 'degraded' | 'failed' | …`),
`previousState`, and a derived `kind` of `'initial' | 'recovered' | 'reconnecting' | 'lost' | 'failed'`
(`deriveCollaborationConnectionKind`, `superdoc.es.js:46027`). This supersedes the old
one-shot `collaboration-ready` event this gap used to be limited to. (Related: SD-65,
which is specifically about this sub-claim and is owned by another folder/fork — flag it
there as fixed too.)

### 3. No initial-sync barrier before a headless client acts (still missing)
Architecture-level finding, not independently reproducible bare: `@hocuspocus/extension-redis`
is not an installed runtime dependency of this harness at all — only its TypeScript
declaration leaked into `@hocuspocus/server`'s bundled `.d.ts` tree from the monorepo build
(`node_modules/@hocuspocus/server/dist/packages/extension-redis/src/Redis.d.ts`); `ioredis`
and `redlock` (its own dependencies) are not installed, so the extension cannot be
constructed or exercised here. Its declared surface does confirm the shape of the gap:
`private publishFirstSyncStep(): Promise<unknown>` is called internally and its result is
not surfaced to the host application — there is no `awaitInitialSync()`-equivalent call
anywhere in `@hocuspocus/server`'s public `Hocuspocus`/`Server`/`Document` types, and
`@superdoc/sdk`'s `roomMode:"join"` resolves once the client-side doc is usable, not once a
multi-instance deployment's cross-instance sync has settled. An agent that joins a room
immediately after another instance created/updated it has no API to wait for that
propagation before reading or deciding.

### 4. No per-edit durability acknowledgement (still missing)
`document.replace(...)` (and the other document-mutation calls) resolve to a rich local
result — e.g. `DocReplaceResult` (`node_modules/@superdoc/sdk/dist/generated/client.d.ts`,
`DocReplaceResult` type) carries `success`, an `outcome` enum
(`'preserved' | 'preserved-with-warnings' | 'simplified' | 'rejected' | 'no-op' | 'invalid-target' | 'outdated'`)
and a `resolution` describing what was matched — but nothing describing whether the edit
has been persisted or broadcast to other collaborators/storage. The promise resolves as
soon as the local operation is applied; there is no separate "durable" acknowledgement a
caller can await.

## Proposed API
- `collaboration.rooms.delete(documentId)` (or equivalent evict call) on the server side,
  and a matching `roomMode: "reset"` the client could request.
- An `awaitInitialSync(documentId)` (or a resolved promise returned alongside `roomMode:"join"`)
  that only settles once the room's backing store (Redis-backed or otherwise) has caught up.
- A durability acknowledgement on mutating calls — e.g. an optional
  `{ awaitDurable: true }` option on `document.replace`/`mutations.apply` that only resolves
  once the edit is confirmed persisted/broadcast, or a separate `onDurable`/`committed`
  event carrying the originating call's id.

## Related
SD-65 (client-side collaboration liveness — the connection-status half of this gap; now
fixed by the same `collaboration-connection-change` event described above), SD-68 (initial
sync barrier, same root cause as sub-item 3), SD-75 (per-edit durability, same as sub-item 4).
