# Proposal: unify-sync-policy

## Why

The ownership gate, conflict restore-as-new decoding, conflict subject
labeling, and authorship labeling are domain policy duplicated by hand in the
UI layers of both apps — and the copies have already drifted into a shipped
behavioral defect: the web restore decoder understands `adjustment`
transactions while the mobile decoder silently coerces an adjustment back to
`expense`, substitutes a missing currency with `'USD'`, and falls back to a
`2026-01-01` next-due date. The same conflict therefore restores as different
data on different platforms. This is the top recommendation of the
2026-09-02 architecture review (candidate C3).

## What Changes

- `@trata/local-data` gains a single ownership-gate policy module:
  the pass/foreign-owner decision table, an atomic wipe-and-rebind
  (`rebindOwner`), and adopt-if-unowned (`adoptUnowned`). Both apps'
  auth flows delegate to it; app layers keep only presentation (dialog vs
  Alert) and control-plane side effects (server logout, cache invalidation).
- `@trata/local-data` gains a single restore-as-new module
  (`canRestoreAsNew`, `restoreConflictAsNew(db, conflictId)`): re-reads the
  conflict by id, decodes the preserved local state per entity through one
  shared decoder table, creates the new record via the local repository, and
  marks the conflict resolved. Both apps' hand-copied decoders are deleted.
- **Restore semantics become loud everywhere** (the web behavior): when the
  preserved state cannot produce a valid create payload, the restore is
  refused — no record is created, the conflict stays unresolved, and the user
  is informed. This removes the mobile-only silent coercions
  (adjustment→expense, currency→'USD', next-due fallback), which are not
  pinned by any spec or test.
- `conflictSubject` (the human label of what a conflict is about) moves into
  `@trata/local-data`; the two per-app copies are deleted.
- `authorLabel` moves byte-identical into `@trata/api`
  (`domain/author-label.ts`), next to the `HouseholdMember` type it operates
  on; both apps' copies are deleted.
- The web Comlink RPC bridge (`LocalDbApi`) exposes the two new db-backed
  operations (`sync.rebindOwner`, `sync.restoreConflictAsNew`).

No backend, OpenAPI, schema, or transport changes. The ownership gate's
observable behavior (bind / wipe-and-rebind / cancel-with-server-logout),
`AuthResult.blockedByOwner`, auth status machines, and the gate UIs are
unchanged — the only observable behavior change is the mobile restore fix
above, which aligns mobile with the platform-neutral restore requirement.

## Capabilities

- **New Capabilities**: none.
- **Modified Capabilities**:
  - `sync-protocol` — the "Conflict resolution flows" requirement gains the
    restore-as-new validation semantics: a restore SHALL create a new record
    with a new id carrying the preserved local state faithfully (including
    the transaction's type, e.g. `adjustment`), and SHALL be refused — leaving
    the conflict unresolved — when the preserved state cannot produce a valid
    create payload. This is behavior currently implied but unstated, and
    violated by the mobile decoder.

## Impact

- `packages/local-data/src/sync/ownership.ts` (new): decision table +
  `rebindOwner` + `adoptUnowned`, with in-package tests.
- `packages/local-data/src/sync/restore.ts` (new): decoder table per
  `SyncEntity` (shaped as a plain record, foreshadowing the future entity
  registry), `canRestoreAsNew`, `restoreConflictAsNew`; in-package tests
  against `createTestDatabase()`, including the adjustment-restore regression
  case.
- `packages/local-data/src/sync/conflicts.ts`: export `conflictSubject`.
- `packages/api/src/domain/author-label.ts` (new, moved verbatim) + moved
  tests.
- `apps/web`: `entities/session/model/use-auth-store.ts` delegates gate
  decisions; `shared/lib/local-db/local-db-api.ts` (+ worker) gains the two
  RPC methods; `features/sync-conflicts/model/restore-as-new.ts` shrinks to a
  mutation composable over the package call; local `conflictSubject` and
  `author-label` copies deleted with call-site updates; existing tests
  updated.
- `apps/mobile`: `entities/session/model/use-auth.tsx` delegates; ~100 lines
  of decoders + the shadowing `toMinorUnits` deleted from
  `features/sync-conflicts/ui/conflict-center.tsx`; new regression test for
  adjustment restore and the refused-restore path.
- Docs: `packages/local-data/README.md` (new policy surface),
  `apps/mobile/docs/conventions/components-and-state.md` §6 (the
  `toMinorUnits` deviation entry dies with the decoder), apps' `AGENTS.md`
  code-map lines.
