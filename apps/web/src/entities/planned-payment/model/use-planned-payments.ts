import { SYNC_QUERY_KEY_ROOTS } from '@trata/local-data'
import { useMutation, useQuery, useQueryCache } from '@pinia/colada'
import { toValue, type MaybeRefOrGetter } from 'vue'
import {
  usePlannedPaymentRepository,
  type ConfirmPlannedPaymentInput,
  type CreatePlannedPaymentPayload,
  type PlannedPaymentQuery,
  type UpdatePlannedPaymentPayload,
} from '../api/repository'

export const usePlannedPayments = (options: MaybeRefOrGetter<PlannedPaymentQuery> = {}) => {
  const plannedPayments = usePlannedPaymentRepository()
  return useQuery({
    key: () => ['planned-payments', toValue(options)],
    query: () => plannedPayments.query(toValue(options)),
  })
}

export const useCreatePlannedPayment = () => {
  const queryCache = useQueryCache()
  const plannedPayments = usePlannedPaymentRepository()
  return useMutation({
    mutation: (payload: CreatePlannedPaymentPayload) => plannedPayments.create(payload),
    onSettled: () => {
      queryCache.invalidateQueries({ key: SYNC_QUERY_KEY_ROOTS.plannedPayments })
    },
  })
}

export const useUpdatePlannedPayment = () => {
  const queryCache = useQueryCache()
  const plannedPayments = usePlannedPaymentRepository()
  return useMutation({
    mutation: ({ id, payload }: { id: string; payload: UpdatePlannedPaymentPayload }) =>
      plannedPayments.update(id, payload),
    onSettled: () => {
      queryCache.invalidateQueries({ key: SYNC_QUERY_KEY_ROOTS.plannedPayments })
    },
  })
}

export const useDeletePlannedPayment = () => {
  const queryCache = useQueryCache()
  const plannedPayments = usePlannedPaymentRepository()
  return useMutation({
    mutation: (id: string) => plannedPayments.remove(id),
    onSettled: () => {
      queryCache.invalidateQueries({ key: SYNC_QUERY_KEY_ROOTS.plannedPayments })
    },
  })
}

// Confirming materializes a real transaction (balances change) and advances
// the plan, so both caches are stale afterwards - mobile invalidates the same
// three keys.
export const useConfirmPlannedPayment = () => {
  const queryCache = useQueryCache()
  const plannedPayments = usePlannedPaymentRepository()
  return useMutation({
    mutation: (input: ConfirmPlannedPaymentInput) => plannedPayments.confirmPlannedPayment(input),
    onSettled: () => {
      queryCache.invalidateQueries({ key: SYNC_QUERY_KEY_ROOTS.plannedPayments })
      queryCache.invalidateQueries({ key: SYNC_QUERY_KEY_ROOTS.transactions })
      queryCache.invalidateQueries({ key: SYNC_QUERY_KEY_ROOTS.accounts })
    },
  })
}
