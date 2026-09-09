# @trata/local-data

The platform-neutral local-first data layer shared by the clients: the drizzle
SQLite schema (6 entity tables + outbox/conflicts/meta plumbing), the outbox
mechanics, the sync engine with persistent conflict records, the local
repositories for every entity, the recurrence math for planned payments, and
the migrations journal. The web app (roadmap stage 4) consumes the same layer
over a browser SQLite driver.

## Platform seams (the package stays DOM/RN-free)

- **Database type** (`src/types.ts`): `LocalDatabase` is the generic drizzle
  SQLite surface (`BaseSQLiteDatabase<'sync', RunResult, typeof schema>`).
  Apps open their own driver and satisfy the type structurally - no expo
  types here.
- **Id factory** (`src/id-factory.ts`): defaults to WebCrypto
  `crypto.randomUUID()`; Hermes (React Native) has no WebCrypto, so the mobile
  bootstrap calls `configureIdFactory(expoCrypto.randomUUID)` before any
  database work.
- **Transport**: the sync engine takes an injected `SyncTransport`; the app
  binds it to the shared API client (`createApiTransport`).
- **Run policy** (`src/sync/run-policy.ts`): `createSyncRunPolicy` owns WHEN
  the engine runs - the 2 500 ms post-mutation debounce, the gate order
  (authenticated → household-current → run), resume-on-auth, and the
  post-cycle invalidation rule (`['sync']` always, `LOCAL_DATA_QUERY_KEY_ROOTS`
  only when the cycle wrote local rows). Apps adapt platform event sources to
  the imperative `notifyAuthChange` / `notifySessionBoundary` /
  `notifyLocalMutation` surface and supply `isAuthenticated`,
  `ensureHouseholdCurrent?`, `invalidateKeys`, and the engine's
  `onRunComplete` completion source. Household currency is checked at session
  boundaries (start, foreground, reconnect, auth); a check that cannot
  complete (offline) skips the run - it is never executed un-gated.

## Ownership gate policy (`src/sync/ownership.ts`)

Single source of truth for the "which user owns this database?" decision:

- `ownershipGateDecision(ownerUserId, authenticatedUserId)` - pure decision
  table: `{ kind: 'pass' }` when unowned or same owner; `{ kind:
  'foreign-owner', ownerUserId }` otherwise. Takes no db handle; callers
  read the owner and pass it in.
- `adoptUnowned(db, userId)` - binds the owner only when the db is
  currently unowned (the bind half of `completeAuthentication`); no-op when
  already owned.
- `rebindOwner(db, userId)` - wipes ALL local data and rebinds to a new
  owner **in one transaction**. Callers must invalidate every UI cache
  afterwards (the wipe clears all entity rows, the outbox, conflicts, and
  sync meta).

App adapters keep what is genuinely theirs: presenting the choice (AlertDialog
vs Alert.alert), server-side logout on cancel, query-cache invalidation, and
auth state transitions.

## Restore-as-new policy (`src/sync/restore.ts`)

Single source of truth for re-creating a deleted conflict as a fresh record:

- `canRestoreAsNew(conflict)` - true when `localState` is a non-null object
  (a quick gate for UI display).
- `restoreConflictAsNew(db, conflictId)` - id-based restore (race-safe):
  re-reads the conflict, decodes `localState` through a per-entity decoder
  table (strict, no silent value substitution), creates the new record via
  the entity's local repository, marks the conflict resolved only on success.
  Returns `{ ok: true; entity; createdId }` or `{ ok: false; reason;
  entity?; field? }` with reasons `conflict-missing`, `no-local-state`, or
  `invalid-state`. Never throws across the seam.

The decoder is strict in the web style: a missing or invalid required field
refuses the restore (returns `invalid-state`), leaves the conflict unresolved,
and the user can retry or dismiss. No silent coercions (no fallback currency,
no hardcoded dates, no type coercions).

## Conflict subject labeling (`src/sync/conflicts.ts`)

- `conflictSubject(conflict)` - returns the human label of the conflicting
  record (name / description), preferring `localState` over `serverState.data`.
  Empty string when neither carries text.

## What stays in the apps

Driver opening + migrations call (expo-sqlite on mobile), the API-client
transport binding, background sync (expo), React contexts, and UI.

## Commands

- `pnpm type-check` - tsc, no emit.
- `pnpm test` - vitest over real SQLite (`node:sqlite`; Node >= 22.5).
- `pnpm db:generate` - drizzle-kit generate + inline the journal into
  `src/migrations.generated.ts`. Run after changing `src/schema.ts`; consumers
  apply the exported `migrations` through their own drizzle migrator.

## Testing entry

`@trata/local-data/testing` exports `createTestDatabase()` for
app-side test suites (mobile jest maps it in `jest.config.js`).
