// Composition seam for the app-layer sync provider: binds the sync
// transport to the shared API client so src/app/_layout.tsx composes the
// engine without importing the client directly (invariant #16 — direct
// apiClient use stays confined to the session API and this folder).
// The dev offline gate (e2e-only) fails push/pull as a transport error when
// enabled, so the engine behaves exactly like a network outage: ops stay
// queued and retry under the standard backoff.

import { apiClient } from '@/shared/api/client'
import type { LocalDatabase } from '@/shared/lib/db/database'
import { createApiTransport, isOfflineGateEnabled, type SyncTransport } from '@trata/local-data'

export function createLocalSyncTransport(db: LocalDatabase): SyncTransport {
  const apiTransport = createApiTransport(apiClient)
  const gateError = () => new Error('dev offline gate: network blocked')

  return {
    push: (operations) =>
      isOfflineGateEnabled(db) ? Promise.reject(gateError()) : apiTransport.push(operations),
    pull: (cursor) =>
      isOfflineGateEnabled(db) ? Promise.reject(gateError()) : apiTransport.pull(cursor),
  }
}
