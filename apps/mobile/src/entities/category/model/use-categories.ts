import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { SYNC_QUERY_KEY_ROOTS } from '@trata/local-data'
import type {
  Category,
  CategoryType,
  CreateCategoryPayload,
  UpdateCategoryPayload,
} from '@trata/api'
import { useCategoryRepository } from '../api/repository'

export function useCategories(type?: CategoryType) {
  const repository = useCategoryRepository()
  const query = useQuery({
    queryKey: SYNC_QUERY_KEY_ROOTS.categories,
    queryFn: () => repository.getAll(),
  })

  if (!type) return query
  return { ...query, data: query.data?.filter((category) => category.type === type) }
}

/** All non-deleted categories, archived included: history joins and period
 * breakdowns keep displaying archived categories with their transactions
 * (only pickers exclude them). */
export function useCategoriesIncludingArchived(type?: CategoryType) {
  const repository = useCategoryRepository()
  const query = useQuery({
    queryKey: ['categories', 'including-archived'],
    queryFn: () => repository.getAllIncludingArchived(),
  })

  if (!type) return query
  return { ...query, data: query.data?.filter((category) => category.type === type) }
}

export function useCreateCategory() {
  const repository = useCategoryRepository()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: CreateCategoryPayload) => repository.create(payload),
    onSettled: () => queryClient.invalidateQueries({ queryKey: SYNC_QUERY_KEY_ROOTS.categories }),
  })
}

export function useUpdateCategory() {
  const repository = useCategoryRepository()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: UpdateCategoryPayload }) =>
      repository.update(id, payload),
    onSettled: () => queryClient.invalidateQueries({ queryKey: SYNC_QUERY_KEY_ROOTS.categories }),
  })
}

export function useDeleteCategory() {
  const repository = useCategoryRepository()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => repository.remove(id),
    onSettled: () => queryClient.invalidateQueries({ queryKey: SYNC_QUERY_KEY_ROOTS.categories }),
  })
}

export type { Category }
