import { useMutation, useQueryCache, type EntryKey } from '@pinia/colada'

type Updater = (current: unknown) => unknown

export type OptimisticPatch =
  | { key: EntryKey; updater: Updater }
  | { keyPrefix: EntryKey; updater: Updater }

export interface UseOptimisticMutationOptions<TPayload, TResult> {
  mutation: (payload: TPayload) => Promise<TResult>
  optimistic: (payload: TPayload) => OptimisticPatch[] | OptimisticPatch
  invalidateKeys?: (payload: TPayload) => EntryKey[]
}

interface Snapshot {
  key: EntryKey
  previous: unknown
}

interface OptimisticContext {
  snapshots: Snapshot[]
  invalidateKeys: EntryKey[]
}

function normalizePatches(patches: OptimisticPatch[] | OptimisticPatch): OptimisticPatch[] {
  return Array.isArray(patches) ? patches : [patches]
}

function isPrefixPatch(patch: OptimisticPatch): patch is { keyPrefix: EntryKey; updater: Updater } {
  return 'keyPrefix' in patch
}

export function useOptimisticMutation<TPayload, TResult>(
  options: UseOptimisticMutationOptions<TPayload, TResult>,
) {
  const queryCache = useQueryCache()

  return useMutation<TResult, TPayload, Error, OptimisticContext>({
    mutation: (payload: TPayload) => options.mutation(payload),
    onMutate: (payload) => {
      const patches = normalizePatches(options.optimistic(payload))
      const snapshots: Snapshot[] = []
      const invalidateKeys: EntryKey[] = []

      for (const patch of patches) {
        if (isPrefixPatch(patch)) {
          queryCache.cancelQueries({ key: patch.keyPrefix })
          const entries = queryCache.getEntries({ key: patch.keyPrefix })
          for (const entry of entries) {
            snapshots.push({ key: entry.key, previous: entry.state.value.data })
            queryCache.setQueryData(entry.key, patch.updater(entry.state.value.data))
          }
          invalidateKeys.push(patch.keyPrefix)
        } else {
          queryCache.cancelQueries({ key: patch.key })
          const previous = queryCache.getQueryData<unknown>(patch.key)
          // No cached entry (e.g. a detail key nothing has fetched yet):
          // nothing to patch optimistically - writing data into a fresh
          // entry would only create a phantom cache record whose lifecycle
          // trips the query plugins. Invalidation alone refreshes it.
          if (previous === undefined) {
            invalidateKeys.push(patch.key)
            continue
          }
          snapshots.push({ key: patch.key, previous })
          queryCache.setQueryData(patch.key, patch.updater(previous))
          invalidateKeys.push(patch.key)
        }
      }

      const extraKeys = options.invalidateKeys?.(payload) ?? []
      for (const key of extraKeys) {
        invalidateKeys.push(key)
      }

      return { snapshots, invalidateKeys }
    },
    onError: (_error, _payload, context) => {
      if (!context?.snapshots) return
      for (const { key, previous } of context.snapshots) {
        queryCache.setQueryData(key, previous)
      }
    },
    onSettled: async (_data, _error, _payload, context) => {
      if (!context?.invalidateKeys) return
      await Promise.all(context.invalidateKeys.map((key) => queryCache.invalidateQueries({ key })))
    },
  })
}
