import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { SYNC_QUERY_KEY_ROOTS } from '@trata/local-data'
import type {
  CreateTransactionPayload,
  Transaction,
  TransactionQuery,
  UpdateTransactionPayload,
} from '@trata/api'
import { useTransactionRepository } from '../api/repository'

export function useTransactions(
  options: TransactionQuery = {},
  { enabled = true }: { enabled?: boolean } = {},
) {
  const repository = useTransactionRepository()
  return useQuery({
    queryKey: ['transactions', options],
    queryFn: () => repository.query(options),
    enabled,
  })
}

export function useTransaction(id: string | undefined) {
  const repository = useTransactionRepository()
  return useQuery({
    queryKey: ['transactions', 'detail', id ?? null],
    queryFn: () => repository.getById(id as string),
    enabled: id !== undefined,
  })
}

export function useCreateTransaction() {
  const repository = useTransactionRepository()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: CreateTransactionPayload) => repository.create(payload),
    onSettled: () => {
      // Transactions change account balances, so both caches go stale.
      queryClient.invalidateQueries({ queryKey: SYNC_QUERY_KEY_ROOTS.transactions })
      queryClient.invalidateQueries({ queryKey: ['accounts'] })
    },
  })
}

export function useUpdateTransaction() {
  const repository = useTransactionRepository()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: UpdateTransactionPayload }) =>
      repository.update(id, payload),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: SYNC_QUERY_KEY_ROOTS.transactions })
      queryClient.invalidateQueries({ queryKey: ['accounts'] })
    },
  })
}

export function useDeleteTransaction() {
  const repository = useTransactionRepository()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => repository.remove(id),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: SYNC_QUERY_KEY_ROOTS.transactions })
      queryClient.invalidateQueries({ queryKey: ['accounts'] })
    },
  })
}

export type { Transaction, TransactionQuery }
