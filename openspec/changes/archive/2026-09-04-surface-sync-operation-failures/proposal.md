# Proposal: surface-sync-operation-failures

## Why

Per-item `error` results from sync push are stored in the outbox
(`syncOutbox.lastError`) and retried forever, but nothing surfaces them: the
sync status badge counts every outbox row as «Ожидает отправки» ("pending
upload"), which reads as "not sent yet" while the server is in fact rejecting
the operations on every cycle. A user hit exactly this (49 ops rejected with
`INVALID_REFS` after a client/server version skew) with no way to discover why
except reading raw network responses.

## What Changes

- The sync status snapshot (`readSyncStatus` in `@trata/local-data`)
  gains `failingOperations` (count of outbox rows with a `lastError`) and
  `lastError` (the stored error string of the most recent failing operation).
- The web sync status badge renders a distinct failing state (warning tint,
  its own label with the failing count and the last error as a tooltip)
  between the conflict and paused states; plain pending keeps meaning "queued,
  nothing rejected".
- The mobile sync status badge and the settings sync card render the same
  distinction (failing count shown as an error, not as pending).
- New `sync.status.failing` locales (ru/en).

## Capabilities

- **Modified Capabilities**:
  - `web-local-data` - the "Sync status visibility and conflict surfacing"
    requirement gains the rejected-operations scenario.
  - `mobile-local-data` - the sync status surface requirement gains the same
    scenario.

## Impact

- `packages/local-data/src/sync/sync-status.ts` (snapshot shape; additive).
- `apps/web/src/widgets/sync-status/ui/SyncStatusBadge.vue` + tests, locales
  in `packages/i18n`.
- `apps/mobile/src/widgets/sync-status/ui/sync-status-badge.tsx`,
  `apps/mobile/src/pages/settings/ui/sync-section.tsx` (+ tests).
- No transport, schema, or backend changes: the data (`lastError`) already
  exists and is maintained by the engine.
