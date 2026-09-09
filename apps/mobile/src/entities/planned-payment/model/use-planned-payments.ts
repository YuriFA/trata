import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { SYNC_QUERY_KEY_ROOTS, type ConfirmPlannedPaymentInput } from '@trata/local-data'
import type { CreatePlannedPaymentPayload, UpdatePlannedPaymentPayload } from '@trata/api'
import { usePlannedPaymentRepository } from '../api/repository'

/**
 * Loads ALL live plans in ONE query: card figures, per-type lists, and
 * reminders derive in-memory (type split happens in selectors — no per-type
 * queries, design D6/D7 performance invariant).
 */
export function usePlannedPayments() {
  const repository = usePlannedPaymentRepository()
  return useQuery({
    queryKey: SYNC_QUERY_KEY_ROOTS.plannedPayments,
    queryFn: () => repository.getAll(),
  })
}

export function useCreatePlannedPayment() {
  const repository = usePlannedPaymentRepository()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: CreatePlannedPaymentPayload) => repository.create(payload),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: SYNC_QUERY_KEY_ROOTS.plannedPayments }),
  })
}

export function useUpdatePlannedPayment() {
  const repository = usePlannedPaymentRepository()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: UpdatePlannedPaymentPayload }) =>
      repository.update(id, payload),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: SYNC_QUERY_KEY_ROOTS.plannedPayments }),
  })
}

export function useDeletePlannedPayment() {
  const repository = usePlannedPaymentRepository()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => repository.remove(id),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: SYNC_QUERY_KEY_ROOTS.plannedPayments }),
  })
}

/** Manual confirmation: invalidates both the plan and the transaction caches. */
export function useConfirmPlannedPayment() {
  const repository = usePlannedPaymentRepository()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: ConfirmPlannedPaymentInput) => repository.confirmPlannedPayment(input),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: SYNC_QUERY_KEY_ROOTS.plannedPayments })
      void queryClient.invalidateQueries({ queryKey: SYNC_QUERY_KEY_ROOTS.transactions })
      void queryClient.invalidateQueries({ queryKey: SYNC_QUERY_KEY_ROOTS.accounts })
    },
  })
}
