import {
  useCategoryRepository,
  type CreateCategoryPayload,
  type UpdateCategoryPayload,
} from '../api/repository'
import { SYNC_QUERY_KEY_ROOTS } from '@trata/local-data'
import { useMutation, useQuery, useQueryCache } from '@pinia/colada'
import { toValue, type MaybeRefOrGetter } from 'vue'
import { useOptimisticMutation } from '@/shared/lib/use-optimistic-mutation'
import type { Category } from './types'
import { mapCategories, mapCategory } from './map-categories'

// Cache layout: `['categories']` (active-only list, picker default),
// `['categories', 'including-archived']` (management/join list), and
// `['categories', id]` (detail). Every mutation invalidates the shared
// `['categories']` prefix so all three stay coherent.
// The active-only list query (`getAll`) has no web consumer since every
// picker resolves from the including-archived list and filters to active at
// the view level (archive spec); the repository method stays part of the
// shared CategoryRepository contract.

export const useCategoriesIncludingArchived = () => {
  const categories = useCategoryRepository()
  return useQuery({
    key: () => ['categories', 'including-archived'],
    query: async () => {
      const items = await categories.getAllIncludingArchived()
      return mapCategories(items)
    },
  })
}

export const useCategory = (id: MaybeRefOrGetter<string | undefined>) => {
  const categories = useCategoryRepository()
  return useQuery({
    key: () => ['categories', toValue(id) ?? null],
    query: async () => {
      const item = await categories.getById(toValue(id)!)
      return item ? mapCategory(item) : item
    },
    enabled: () => !!toValue(id),
  })
}

export const useCreateCategory = () => {
  const queryCache = useQueryCache()
  const categories = useCategoryRepository()
  return useMutation({
    mutation: (payload: CreateCategoryPayload) => categories.create(payload),
    onSettled: () => {
      queryCache.invalidateQueries({ key: SYNC_QUERY_KEY_ROOTS.categories })
    },
  })
}

// Patch one cached category record: field updates apply as-is, the
// `archived` flag translates to the record's `archivedAt` timestamp.
const patchCategoryRecord = (category: Category, payload: UpdateCategoryPayload): Category => {
  const { archived, ...fields } = payload
  return {
    ...category,
    ...fields,
    ...(archived === undefined ? {} : { archivedAt: archived ? new Date().toISOString() : null }),
  }
}

export const useUpdateCategory = () => {
  const categories = useCategoryRepository()
  return useOptimisticMutation<{ id: string; payload: UpdateCategoryPayload }, Category>({
    mutation: ({ id, payload }) => categories.update(id, payload),
    // Prefix patch: the same record lives in the active list, the
    // including-archived list, and detail entries - patch every entry whose
    // data mentions the id. The active list drops the record on archive only
    // via the settled invalidation (optimistic removal would need the record
    // to already be in that cache, and archive flows use
    // useSetCategoryArchived instead).
    optimistic: ({ id, payload }) => [
      {
        keyPrefix: ['categories'],
        updater: (current) => {
          if (Array.isArray(current)) {
            return current.map((category) =>
              category.id === id ? patchCategoryRecord(category, payload) : category,
            )
          }
          const category = current as Category | null | undefined
          return category && category.id === id ? patchCategoryRecord(category, payload) : current
        },
      },
    ],
  })
}

// Archive/unarchive: no optimistic patch - the record moves between the
// active and including-archived lists, and the settled invalidation is the
// single source of the re-sort. Keeps the mutation obviously correct.
export const useSetCategoryArchived = () => {
  const queryCache = useQueryCache()
  const categories = useCategoryRepository()
  return useMutation({
    mutation: ({ id, version, archived }: { id: string; version: number; archived: boolean }) =>
      categories.update(id, { version, archived }),
    onSettled: () => {
      queryCache.invalidateQueries({ key: SYNC_QUERY_KEY_ROOTS.categories })
    },
  })
}

export type DeleteCategoryInput = { id: string; cascade?: boolean }

export const useDeleteCategory = () => {
  const categories = useCategoryRepository()
  return useOptimisticMutation<DeleteCategoryInput, void>({
    mutation: ({ id, cascade }) => categories.remove(id, cascade ? { cascade: true } : undefined),
    optimistic: ({ id }) => [
      {
        keyPrefix: ['categories'],
        updater: (current) => {
          if (Array.isArray(current)) {
            return current.filter((category) => category.id !== id)
          }
          const category = current as Category | null | undefined
          return category && category.id === id ? undefined : current
        },
      },
    ],
    // A cascaded delete tombstones the referencing transactions, so balances
    // change: transaction and account caches go stale with them.
    invalidateKeys: ({ cascade }) => (cascade ? [['transactions'], ['accounts']] : []),
  })
}
