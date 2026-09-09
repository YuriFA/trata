import { SYNC_QUERY_KEY_ROOTS } from '@trata/local-data'
import { useMutation, useQuery, useQueryCache } from '@pinia/colada'
import { toValue, type MaybeRefOrGetter } from 'vue'
import {
  useDebtOperationRepository,
  type CreateDebtOperationPayload,
  type DebtOperationQuery,
  type UpdateDebtOperationPayload,
} from '../api/repository'

// The debts screens derive every figure from one full read (design D2 of the
// debts spec); `query` exists for single-debtor listings.
export const useDebtOperations = (options: MaybeRefOrGetter<DebtOperationQuery> = {}) => {
  const debtOperations = useDebtOperationRepository()
  return useQuery({
    key: () => ['debt-operations', toValue(options)],
    query: () => debtOperations.query(toValue(options)),
  })
}

export const useCreateDebtOperation = () => {
  const queryCache = useQueryCache()
  const debtOperations = useDebtOperationRepository()
  return useMutation({
    mutation: (payload: CreateDebtOperationPayload) => debtOperations.create(payload),
    onSettled: () => {
      queryCache.invalidateQueries({ key: SYNC_QUERY_KEY_ROOTS.debtOperations })
    },
  })
}

export const useUpdateDebtOperation = () => {
  const queryCache = useQueryCache()
  const debtOperations = useDebtOperationRepository()
  return useMutation({
    mutation: ({ id, payload }: { id: string; payload: UpdateDebtOperationPayload }) =>
      debtOperations.update(id, payload),
    onSettled: () => {
      queryCache.invalidateQueries({ key: SYNC_QUERY_KEY_ROOTS.debtOperations })
    },
  })
}

export const useDeleteDebtOperation = () => {
  const queryCache = useQueryCache()
  const debtOperations = useDebtOperationRepository()
  return useMutation({
    mutation: (id: string) => debtOperations.remove(id),
    onSettled: () => {
      queryCache.invalidateQueries({ key: SYNC_QUERY_KEY_ROOTS.debtOperations })
    },
  })
}
