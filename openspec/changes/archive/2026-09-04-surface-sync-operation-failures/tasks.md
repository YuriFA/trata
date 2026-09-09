# Tasks: surface-sync-operation-failures

## 1. Snapshot

- [x] 1.1 Extend `readSyncStatus` (`packages/local-data/src/sync/sync-status.ts`)
  with `failingOperations` (count of outbox rows with `lastError` set) and
  `lastError` (newest failing row's stored string); unit tests for empty,
  pending-only, failing, and mixed outboxes.

## 2. Web

- [x] 2.1 Add `sync.status.failing` to `packages/i18n` locales (ru/en).
- [x] 2.2 `SyncStatusBadge.vue`: insert the failing state between conflicts and
  paused (warning tint, `title` tooltip with `lastError`, compact variant
  accent); update `SyncStatusBadge.test.ts` covering the failing state and
  its priority over pending.

## 3. Mobile

- [x] 3.1 `sync-status-badge.tsx`: add the failing state (alert icon, destructive
  accent, failing count) with priority between conflicts and paused; update
  or add component tests.
- [x] 3.2 `sync-section.tsx`: report the rejected count as an error line when
  `failingOperations > 0`.

## 4. Verification

- [x] 4.1 `pnpm --filter @trata/local-data test` (or workspace test
  command) green; web `pnpm --filter web test` for the badge; mobile tests
  for the touched files.
- [x] 4.2 E2E sanity on the local backend: reproduce the rejected-op badge state
  and verify the distinct label + tooltip, and that a successful re-push
  drains it back to pending/synced.
