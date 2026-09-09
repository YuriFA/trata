import {
  useAccountRepository,
  type CreateAccountPayload,
  type UpdateAccountPayload,
} from '../api/repository'
import { SYNC_QUERY_KEY_ROOTS } from '@trata/local-data'
import { useMutation, useQuery, useQueryCache } from '@pinia/colada'
import { toValue, type MaybeRefOrGetter } from 'vue'
import { useOptimisticMutation, type OptimisticPatch } from '@/shared/lib/use-optimistic-mutation'
import type { AccountWithBalance } from './types'

export const useAccounts = () => {
  const accounts = useAccountRepository()
  return useQuery({
    key: () => ['accounts'],
    query: () => accounts.getAll(),
  })
}

export const useAccount = (id: MaybeRefOrGetter<string | undefined>) => {
  const accounts = useAccountRepository()
  return useQuery({
    key: () => ['accounts', toValue(id) ?? null],
    query: () => accounts.getById(toValue(id)!),
    enabled: () => !!toValue(id),
  })
}

export const useCreateAccount = () => {
  const queryCache = useQueryCache()
  const accounts = useAccountRepository()
  return useMutation({
    mutation: (payload: CreateAccountPayload) => accounts.create(payload),
    onSettled: () => {
      queryCache.invalidateQueries({ key: SYNC_QUERY_KEY_ROOTS.accounts })
    },
  })
}

export const useUpdateAccount = () => {
  const accounts = useAccountRepository()
  return useOptimisticMutation<{ id: string; payload: UpdateAccountPayload }, AccountWithBalance>({
    mutation: ({ id, payload }) => accounts.update(id, payload),
    optimistic: ({ id, payload }) => {
      // Patch only the LIST query: the single-account query
      // `['accounts', id]` may not exist, and setQueryData on a missing key
      // crashes colada. Invalidation (below) refreshes by prefix anyway.
      const patches: OptimisticPatch[] = [
        {
          key: SYNC_QUERY_KEY_ROOTS.accounts,
          updater: (current) =>
            (current as AccountWithBalance[] | undefined)?.map((account) =>
              account.id === id ? { ...account, ...payload } : account,
            ),
        },
      ]
      return patches
    },
    invalidateKeys: () => [['accounts']],
  })
}

export const useDeleteAccount = () => {
  const accounts = useAccountRepository()
  return useOptimisticMutation<string, void>({
    mutation: (id) => accounts.remove(id),
    optimistic: (id) => [
      {
        key: SYNC_QUERY_KEY_ROOTS.accounts,
        updater: (current) =>
          (current as AccountWithBalance[] | undefined)?.filter((account) => account.id !== id),
      },
      {
        key: ['accounts', id],
        updater: () => undefined,
      },
    ],
  })
}
