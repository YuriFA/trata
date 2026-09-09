# Tasks: unify-sync-policy

## 1. Shared packages (additive, no app changes)

- [x] 1.1 Create `packages/local-data/src/sync/ownership.ts`:
  `ownershipGateDecision(ownerUserId, authenticatedUserId)` (pure decision
  table), `adoptUnowned(db, userId)`, `rebindOwner(db, userId)` (wipe +
  rebind in one transaction, documented caller-must-invalidate contract);
  unit tests over `createTestDatabase()` pinning the decision matrix,
  adopt-is-noop-when-owned, and rebind ending wiped-and-owned.
- [x] 1.2 Create `packages/local-data/src/sync/restore.ts`:
  `canRestoreAsNew(conflict)` (moved from web), the strict per-entity
  decoder table `Record<SyncEntity, Decoder>` producing
  `Create*Payload` values (adjustment included, no substitutions), and
  `restoreConflictAsNew(db, conflictId)` → result type
  (`ok/createdId` | `conflict-missing`/`no-local-state`/`invalid-state` with
  `entity`/`field`), internally: `getConflictById` → decode → repository
  `create` → `markConflictResolved`; unit tests over `createTestDatabase()`
  covering every entity's happy path, the adjustment-restore regression
  case (new id, same type/amount/account), and each refusal reason leaving
  the conflict unresolved with no outbox row added.
- [x] 1.3 Export `conflictSubject(conflict)` from
  `packages/local-data/src/sync/conflicts.ts` (logic moved verbatim from
  `use-sync-conflicts.ts:39–46`), with unit tests for the
  localState-preferred / serverState-fallback / empty cases.
- [x] 1.4 Export the new modules from `packages/local-data/src/index.ts`
  and verify `pnpm --filter @trata/local-data type-check` and
  `test` are green.
- [x] 1.5 Move `authorLabel` byte-identical to
  `packages/api/src/domain/author-label.ts` (+ export from the package
  entry), move the existing 64-line test file to the package, and verify
  `pnpm --filter @trata/api type-check` and `test` are green.

## 2. Web delegation

- [x] 2.1 Extend the Comlink bridge: add `sync.rebindOwner(userId)` and
  `sync.restoreConflictAsNew(conflictId)` to `LocalDbApi`
  (`apps/web/src/shared/lib/local-db/local-db-api.ts`) and the worker
  implementation, delegating to the package; verify the worker type-checks
  and the bridge surface test (if present) is updated.
- [x] 2.2 `use-auth-store.ts`: `passOwnershipGate` delegates to
  `ownershipGateDecision` (direct import, owner still read via
  `meta.getOwnerUserId`), `completeAuthentication` uses `adoptUnowned`,
  `confirmOwnershipGateDelete` uses `rebindOwner` + invalidate-all;
  existing gate tests in `use-auth-store.test.ts` keep passing unmodified
  (behavior unchanged).
- [x] 2.3 Shrink `restore-as-new.ts` to the `useRestoreConflictAsNew`
  composable calling `api.sync.restoreConflictAsNew(conflict.id)` via the
  bridge (delete the decoder body and local `canRestoreAsNew`);
  on failure surface `notification.mutationError` and leave the conflict
  unresolved; update `ConflictCenter.test.ts` to drive the mocked bridge
  method, including a refused-restore case.
- [x] 2.4 Delete the local `conflictSubject` from
  `features/sync-conflicts/model/use-sync-conflicts.ts` and re-export from
  `@trata/local-data` for `ConflictCenter.vue`; delete
  `entities/household/model/author-label.ts` and update its call sites +
  barrel to import from `@trata/api`; move/keep
  `author-label.test.ts` coverage via the package tests and delete the app
  copy; verify web `pnpm type-check` + unit tests green.

## 3. Mobile delegation + restore fixes

- [x] 3.1 `use-auth.tsx`: `passOwnershipGate` delegates to
  `ownershipGateDecision`/`adoptUnowned`/`rebindOwner` (Alert presentation,
  server logout on cancel, and invalidate-all stay app-side); the nine
  existing `use-auth.test.tsx` cases keep passing unmodified.
- [x] 3.2 `conflict-center.tsx`: replace the inline decoders
  (`asCreate*Payload`, `toMinorUnits`, ~:49–152) with
  `restoreConflictAsNew(db, conflict.id)` + `conflictSubject` imported from
  local-data; on `ok: false` keep the existing error Alert and leave the
  conflict unresolved; the delete-restore test in
  `conflict-center.test.tsx` keeps passing.
- [x] 3.3 Add regression tests pinning the fixed behavior: restoring a
  deleted conflict whose local state is an adjustment transaction creates
  an adjustment (not an expense) with a new id; an incomplete state (e.g.
  account without currency) is refused with the conflict left unresolved.
- [x] 3.4 Delete `entities/household/model/author-label.ts` and update its
  call sites (`features/edit-transaction`, cashflow/debts/plans selectors)
  to import from `@trata/api`; verify mobile `pnpm type-check` +
  jest suites green.

## 4. Docs cleanup

- [x] 4.1 `packages/local-data/README.md`: document the new policy surface
  (ownership gate decision/rebind, restore-as-new, `conflictSubject`).
- [x] 4.2 `apps/mobile/docs/conventions/components-and-state.md` §6: remove
  the dead `conflict-center.tsx` `toMinorUnits` deviation entry (and the
  `use-auth.tsx` `statusRef` entry only if that dead code is removed as
  part of 3.1 — otherwise leave it).
- [x] 4.3 Update the code-map lines in `apps/web/AGENTS.md` and
  `apps/mobile/AGENTS.md` that describe the gate/restore locations to
  mention the package-owned policy with app adapters.

## 5. Verification

- [x] 5.1 `pnpm --filter @trata/local-data test && pnpm
  --filter @trata/api test` green (new policy tests included).
- [x] 5.2 Web: `pnpm --filter web type-check && pnpm --filter web test`
  green; `pnpm exec steiger` stays green (FSD).
- [x] 5.3 Mobile: `pnpm --filter mobile type-check && pnpm --filter mobile
  test` green (including the new adjustment/invalid-state regression
  tests).
- [x] 5.4 Root gates: `pnpm arch:check` (package purity/FSD rules) and
  `pnpm knip` (no dangling exports after the deletions) pass.
- [x] 5.5 Env-gated e2e sanity (`SYNC_INTEGRATION_API`): two new cases added
  to `backend-integration.test.ts` — adjustment restore (full cycle: create →
  sync → remote delete → local edit → sync → conflict → `restoreConflictAsNew`
  → push → server verify) and refused-restore on incomplete state. Both skip
  without the env var and run as `pnpm test backend-integration` against a
  live backend.
