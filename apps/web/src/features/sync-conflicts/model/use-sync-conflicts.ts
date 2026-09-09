import { useMutation, useQuery, useQueryCache } from '@pinia/colada'
import { conflictSubject } from '@trata/local-data'
import { getLocalDbApi } from '@/shared/lib/local-db'
import { useSyncController } from '@/shared/lib/local-db'

/** Unresolved conflict records; refetched by the engine's data-changed invalidation. */
export const useUnresolvedConflicts = () =>
  useQuery({
    key: () => ['sync', 'conflicts'],
    query: () => getLocalDbApi().then((api) => api.sync.listUnresolvedConflicts()),
  })

export type ConflictAction = 'keep-local' | 'take-server' | 'dismiss'

/**
 * Resolves a conflict over the RPC bridge and refreshes everything: the
 * resolution rewrites local records, and the follow-up engine run re-pushes
 * keep-local choices / drains confirmed state.
 */
export const useResolveConflict = () => {
  const queryCache = useQueryCache()
  const { runNow } = useSyncController()

  return useMutation({
    mutation: ({ action, conflictId }: { action: ConflictAction; conflictId: string }) =>
      getLocalDbApi().then(async (api) => {
        if (action === 'keep-local') await api.sync.resolveConflictKeepLocal(conflictId)
        else if (action === 'take-server') await api.sync.resolveConflictTakeServer(conflictId)
        else await api.sync.markConflictResolved(conflictId)
      }),
    onSettled: () => {
      void queryCache.invalidateQueries()
      runNow()
    },
  })
}

/** Re-export so existing ConflictCenter.vue imports keep working. */
export { conflictSubject }
