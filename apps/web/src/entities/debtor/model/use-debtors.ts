import { SYNC_QUERY_KEY_ROOTS } from '@trata/local-data'
import { useMutation, useQuery, useQueryCache } from '@pinia/colada'
import {
  useDebtorRepository,
  type CreateDebtorPayload,
  type UpdateDebtorPayload,
} from '../api/repository'

export const useDebtors = () => {
  const debtors = useDebtorRepository()
  return useQuery({
    key: () => ['debtors'],
    query: () => debtors.getAll(),
  })
}

export const useCreateDebtor = () => {
  const queryCache = useQueryCache()
  const debtors = useDebtorRepository()
  return useMutation({
    mutation: (payload: CreateDebtorPayload) => debtors.create(payload),
    onSettled: () => {
      queryCache.invalidateQueries({ key: SYNC_QUERY_KEY_ROOTS.debtors })
    },
  })
}

export const useUpdateDebtor = () => {
  const queryCache = useQueryCache()
  const debtors = useDebtorRepository()
  return useMutation({
    mutation: ({ id, payload }: { id: string; payload: UpdateDebtorPayload }) =>
      debtors.update(id, payload),
    onSettled: () => {
      queryCache.invalidateQueries({ key: SYNC_QUERY_KEY_ROOTS.debtors })
    },
  })
}

export const useDeleteDebtor = () => {
  const queryCache = useQueryCache()
  const debtors = useDebtorRepository()
  return useMutation({
    mutation: (id: string) => debtors.remove(id),
    onSettled: () => {
      queryCache.invalidateQueries({ key: SYNC_QUERY_KEY_ROOTS.debtors })
    },
  })
}
