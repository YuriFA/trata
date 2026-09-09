# Design: unify-sync-policy

## Context

Four pieces of sync/session policy are hand-duplicated in the two apps'
UI layers (see `proposal.md` for the motivation and the shipped drift):

- **Ownership gate**: web `apps/web/src/entities/session/model/use-auth-store.ts`
  (`passOwnershipGate` :48–58 parks a promise in a pinia ref behind
  `OwnershipGateDialog.vue`; delete = `wipeLocalData` + `setOwnerUserId` +
  invalidate-all + complete; cancel = server logout + anonymous) and mobile
  `apps/mobile/src/entities/session/model/use-auth.tsx` (:74–113, the same
  table resolved inside `Alert.alert` buttons). Both call the local-data
  primitives separately, so wipe+rebind is two transactions, not one.
- **Restore-as-new decoders**: web
  `apps/web/src/features/sync-conflicts/model/restore-as-new.ts` (typed
  guards, throws on incomplete state, decodes `adjustment`) vs mobile inline
  decoders in `apps/mobile/src/features/sync-conflicts/ui/conflict-center.tsx`
  (:62–152 — coerces currency to `'USD'`, transaction type to `expense`,
  next-due to `'2026-01-01'`, plus a local `toMinorUnits` shadowing
  `@trata/money`). The restore flow itself (repository create →
  `markConflictResolved`) is also duplicated; outbox enqueue already lives
  inside the local repositories.
- **conflictSubject**: web `use-sync-conflicts.ts:39–46` (exported) vs mobile
  `conflict-center.tsx:49–56` (private), same logic.
- **authorLabel**: byte-identical 43-line files in both apps'
  `entities/household/model/author-label.ts`, pure over
  `HouseholdMember` from `@trata/api`.

Constraints that shape the design:

- Web never imports local-data db operations directly: everything goes
  through the Comlink worker bridge (`LocalDbApi` with `meta.*` / `sync.*`
  method groups in `apps/web/src/shared/lib/local-db/`). Pure functions may
  be imported directly — the package is platform-neutral TS bundled in both
  threads.
- Mobile calls local-data directly (no worker).
- Package purity: `local-data → {api, dates, money}` are the only
  cross-package edges; no DOM/Vue/RN imports; enforced by `pnpm arch:check`.
- The preserved `localState` on a conflict record is `rowToPayload` output
  (the local-data domain payload shape, author field excluded), so decoding
  it is local-data's own concern.
- Conflicts are persistent rows polled via query invalidation after engine
  runs — there is no subscription API to hook into.
- FSD conventions in both apps pin where app-side glue may live
  (`entities/session`, `features/sync-conflicts`; seam rules in
  `apps/web/docs/conventions/vue-patterns.md` and
  `apps/mobile/docs/conventions/components-and-state.md`).

## Goals / Non-Goals

**Goals:**

- Each policy piece has exactly one home; apps keep thin adapters
  (dialog/Alert, server logout, cache invalidation, status transitions).
- Restore semantics are loud on both platforms and pinned by a regression
  test (adjustment restored as adjustment; invalid state refused).
- The per-entity decoder table is shaped as a plain record keyed by
  `SyncEntity`, so the future entity registry (review candidate C2) can
  absorb it without reshaping.
- Zero observable change to the ownership gate's behavior
  (bind / wipe-and-rebind / cancel-with-server-logout, `blockedByOwner`).

**Non-Goals:**

- The household-join carry/clean gate (`use-household-join.ts`) — a
  separate flow and a possible future consumer of `rebindOwner`.
- The entity registry itself (C2), the sync run-policy (C6), and the
  backend sync-engine tail (C8).
- Any change to `AuthResult`, auth status machines, gate/conflict UI copy,
  i18n keys, or the sync-protocol spec beyond the restore semantics delta.
- A web e2e for the different-owner dialog (a known, pre-existing e2e gap).

## Decisions

### D1. Gate policy = pure decision + db effects in local-data; presentation and control-plane stay app-side

New `packages/local-data/src/sync/ownership.ts`:

- `ownershipGateDecision(ownerUserId: string | null, authenticatedUserId: string):`
  `{ kind: 'pass' } | { kind: 'foreign-owner'; ownerUserId: string }` — the
  decision table's single home (pass iff unowned or same owner).
- `adoptUnowned(db, userId)` — sets the owner only when the db is unowned
  (the bind half of both apps' `completeAuthentication`).
- `rebindOwner(db, userId)` — wipe + rebind **in one transaction**
  (today two sequential calls in both apps), with the documented contract
  that the caller must invalidate every UI cache afterwards (the same
  contract `wipeLocalData` already carries).

The app adapters keep what is genuinely theirs: presenting the choice
(AlertDialog vs `Alert.alert`), the server-side logout of the just-created
session on cancel (control-plane API), query-cache invalidation, and auth
state transitions.

Alternatives considered: moving the whole gate flow into the package
(rejected — it would drag UI and session API into a platform-neutral
package) and leaving the table duplicated (the status quo the drift came
from).

### D2. Restore-as-new is one id-based function in local-data, returning a result type

New `packages/local-data/src/sync/restore.ts`:

- `canRestoreAsNew(conflict)` — true iff `localState` is a non-null object
  (moved verbatim from the web module).
- `restoreConflictAsNew(db, conflictId)`:
  1. re-read the conflict by id (`getConflictById`) and refuse if missing —
     mobile's race-safe pattern becomes the shared one; the web composable
     currently passes the possibly-stale list object;
  2. decode `localState` through the per-entity decoder table;
  3. create the new record via the entity's local repository (which owns
     validation, author stamping, versioning, and the atomic row+outbox
     enqueue);
  4. `markConflictResolved` only after a successful create.
- Return `{ ok: true; entity; createdId } | { ok: false; reason:
  'conflict-missing' | 'no-local-state' | 'invalid-state'; entity?; field? }`
  — no throws across the seam.

Alternatives: throwing (the web status quo — apps cannot branch on the
failure reason without parsing messages) and taking the conflict object
instead of the id (stale-object race the mobile path already avoids).

### D3. Loud restore semantics; no value substitution

The shared decoder is strict in the web style: a required field that is
missing or invalid refuses the restore. The mobile coercions die. Rationale:
the coercions can only fire on preserved state that is already corrupt
(`localState` is the payload of a row that passed local validation when it
was written — valid values decode identically in both implementations), so
the substitution never "saves" good data; it silently fabricates wrong data
(adjustment→expense, currency→'USD', next-due→a hardcoded date) and marks
the conflict resolved. A refusal keeps the conflict available for retry or
dismissal, and the mobile UI already has the failure path (error Alert,
conflict stays unresolved and re-prompts).

### D4. Homes: `conflictSubject` → local-data, `authorLabel` → api

- `conflictSubject` reads `LocalSyncConflict.localState`/`serverState`
  shapes — it becomes an export of
  `packages/local-data/src/sync/conflicts.ts`.
- `authorLabel` operates on `HouseholdMember` (an `@trata/api`
  domain type) and knows nothing about local data — it moves verbatim to
  `packages/api/src/domain/author-label.ts`, beside the domain types. Both
  apps' copies and barrels are deleted; call sites (~4 per app) import from
  the package. Model-layer imports of the api package are already
  established in both apps.
- Alternative considered: both into local-data (wrong home for
  `authorLabel`; it would also grow local-data's api surface for a
  household-display concern).

### D5. Web bridge carries the two db-backed operations

`LocalDbApi` gains `sync.rebindOwner(userId)` and
`sync.restoreConflictAsNew(conflictId)` — thin worker delegates to the
package functions. Pure helpers (`ownershipGateDecision`,
`canRestoreAsNew`, `conflictSubject`) are imported directly by web code
(main-thread-safe, no db handle). The web auth store keeps reading the
owner marker through the existing `meta.getOwnerUserId` RPC, then applies
the pure decision.

### D6. Decoder table, not a registry

The decoders live in one `Record<SyncEntity, (state) => DecodeResult>`
inside `restore.ts`. No shared descriptor interface is invented now — C2's
registry can absorb the table later because the key set (`SyncEntity`) and
the module boundary already match.

## Risks / Trade-offs

- [Mobile restores that previously "succeeded" on corrupt state now refuse]
  → The refusal path already exists in the mobile UI; corrupt `localState`
  requires a row that failed validation when written; regression tests pin
  both directions (adjustment restored faithfully; invalid state refused).
- [Two homes coexist while only one app has migrated] → Strangler order
  below: package lands with its own tests before any app touches it; each
  app migrates in one self-contained step; no behavior flags.
- [Comlink bridge changes regress the worker protocol] → Additive methods
  only; web unit tests mock the bridge surface and the existing
  ConflictCenter tests keep pinning end-to-end behavior.
- [Many mechanical call-site edits for `authorLabel`] → The function moves
  byte-identical; the existing per-app tests move to the package unchanged
  and keep passing, proving the move.

## Migration Plan

1. Package first: `ownership.ts` and `restore.ts` + `conflictSubject`
   export in `local-data`, `author-label.ts` in `api`, with in-package
   tests (real `node:sqlite` via `createTestDatabase()`). No app changes —
   additive only, nothing consumes the new surface yet.
2. Web delegation: bridge methods, auth store delegates, restore composable
   shrinks to a mutation wrapper (invalidate + `runNow`), local copies
   deleted, tests updated.
3. Mobile delegation: auth provider delegates, conflict-center decoders
   removed, behavior fixes land here, new regression tests.
4. Docs cleanup: local-data README (policy surface), mobile conventions §6
   (drop the dead `toMinorUnits` deviation), apps' `AGENTS.md` code-map
   notes.

Each step is independently revertible; the package modules are dead-simple
to roll back (delete) until an app consumes them, and each app's step is a
self-contained commit.

## Open Questions

None — the remaining unknowns (exact i18n phrasing of the refused-restore
notification on each platform) are presentation details that do not affect
the specs, the seam, or the task breakdown.
