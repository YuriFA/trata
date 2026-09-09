import { useMutation, useQueryCache } from '@pinia/colada'
import type { LocalSyncConflict, RestoreResult } from '@trata/local-data'
import { getLocalDbApi, useSyncController } from '@/shared/lib/local-db'

// Restore-as-new: delegates the decode + create + mark-resolved pipeline to
// the @trata/local-data package via the Comlink bridge
// (restoreConflictAsNew). The composable's role is cache refresh and sync kick;
// the calling component handles error presentation for refused restores.

/** Mutation-wrapped restore over the RPC bridge with cache refresh. */
export function useRestoreConflictAsNew() {
  const queryCache = useQueryCache()
  const { runNow } = useSyncController()

  return useMutation<RestoreResult, LocalSyncConflict>({
    mutation: async (conflict: LocalSyncConflict): Promise<RestoreResult> => {
      const api = await getLocalDbApi()
      return api.sync.restoreConflictAsNew(conflict.id)
    },
    onSettled: () => {
      void queryCache.invalidateQueries()
      runNow()
    },
  })
}

/** True when the preserved local state carries the fields a re-create needs. */
export { canRestoreAsNew } from '@trata/local-data'
