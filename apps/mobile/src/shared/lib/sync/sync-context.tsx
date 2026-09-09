// Sync controller context: the seam between the app-layer provider (which
// composes the engine with auth/db/api wiring - see src/app/_layout.tsx)
// and the pages/widgets/features that consume sync state. Lives in shared
// so every layer can import it downward (invariants #15/#16).

import { createContext, useContext } from 'react'
import type { SyncEngine, SyncEngineState } from '@trata/local-data'

export interface SyncController {
  engine: SyncEngine
  engineState: SyncEngineState
  /** Manual refresh: bypasses backoff and runs a full cycle now. */
  runNow: () => Promise<void>
  /** Asks the mounted conflict presenter to surface unresolved conflicts. */
  presentConflicts: () => void
  /** Registers the conflict presenter (the conflict center mounts it). */
  registerConflictPresenter: (presenter: (() => void) | null) => void
}

export const SyncContext = createContext<SyncController | null>(null)

/** Injects the sync controller; throws when the provider is missing. */
export function useSyncController(): SyncController {
  const controller = useContext(SyncContext)
  if (!controller) {
    throw new Error('useSyncController requires <SyncProvider> in the tree')
  }
  return controller
}
