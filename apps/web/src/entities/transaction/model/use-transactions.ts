import type { Transaction } from './types'
import {
  useTransactionRepository,
  type CreateTransactionPayload,
  type TransactionQuery,
  type UpdateTransactionPayload,
} from '../api/repository'
import { SYNC_QUERY_KEY_ROOTS } from '@trata/local-data'
import { useMutation, useQuery, useQueryCache } from '@pinia/colada'
import { toValue, type MaybeRefOrGetter } from 'vue'
import { useOptimisticMutation } from '@/shared/lib/use-optimistic-mutation'

type GetTransactionsOptions = TransactionQuery

export const useTransactions = (
  options: MaybeRefOrGetter<GetTransactionsOptions> = {},
  queryOptions: { enabled?: MaybeRefOrGetter<boolean> } = {},
) => {
  const transactions = useTransactionRepository()
  return useQuery({
    key: () => ['transactions', toValue(options)],
    query: () => {
      return transactions.query(toValue(options))
    },
    // `toValue(undefined)` disables a colada query, so default to true.
    enabled: queryOptions.enabled ?? true,
  })
}

export const useTransaction = (id: MaybeRefOrGetter<string | undefined>) => {
  const transactions = useTransactionRepository()
  return useQuery({
    key: () => ['transactions', toValue(id) ?? null],
    query: () => {
      return transactions.getById(toValue(id)!)
    },
    enabled: () => !!toValue(id),
  })
}

export const useCreateTransaction = <T extends Transaction>() => {
  const queryCache = useQueryCache()
  const transactions = useTransactionRepository()
  return useMutation({
    mutation: (payload: CreateTransactionPayload<T>) => {
      return transactions.create(payload)
    },
    onSettled: () => {
      queryCache.invalidateQueries({ key: SYNC_QUERY_KEY_ROOTS.transactions })
      queryCache.invalidateQueries({ key: SYNC_QUERY_KEY_ROOTS.accounts })
    },
  })
}

export const useUpdateTransaction = <T extends Transaction>() => {
  const queryCache = useQueryCache()
  const transactions = useTransactionRepository()
  return useMutation({
    mutation: ({ id, payload }: { id: string; payload: UpdateTransactionPayload<T> }) => {
      return transactions.update(id, payload)
    },
    onSettled: () => {
      queryCache.invalidateQueries({ key: SYNC_QUERY_KEY_ROOTS.transactions })
      queryCache.invalidateQueries({ key: SYNC_QUERY_KEY_ROOTS.accounts })
    },
  })
}

export const useDeleteTransaction = () => {
  const transactions = useTransactionRepository()
  return useOptimisticMutation<string, void>({
    mutation: (id) => transactions.remove(id),
    optimistic: (id) => [
      {
        keyPrefix: ['transactions'],
        updater: (current) =>
          Array.isArray(current) ? current.filter((transaction) => transaction.id !== id) : current,
      },
      {
        key: ['transactions', id],
        updater: () => undefined,
      },
    ],
    invalidateKeys: () => [['accounts']],
  })
}
