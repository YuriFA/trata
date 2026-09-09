import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { SYNC_QUERY_KEY_ROOTS } from '@trata/local-data'
import type { AccountWithBalance, CreateAccountPayload, UpdateAccountPayload } from '@trata/api'
import { useAccountRepository } from '../api/repository'

export function useAccounts() {
  const repository = useAccountRepository()
  return useQuery({
    queryKey: SYNC_QUERY_KEY_ROOTS.accounts,
    queryFn: () => repository.getAll(),
  })
}

export function useAccount(id: string | undefined) {
  const repository = useAccountRepository()
  return useQuery({
    queryKey: ['accounts', id ?? null],
    queryFn: () => repository.getById(id as string),
    enabled: id !== undefined,
  })
}

export function useCreateAccount() {
  const repository = useAccountRepository()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: CreateAccountPayload) => repository.create(payload),
    onSettled: () => queryClient.invalidateQueries({ queryKey: SYNC_QUERY_KEY_ROOTS.accounts }),
  })
}

export function useUpdateAccount() {
  const repository = useAccountRepository()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: UpdateAccountPayload }) =>
      repository.update(id, payload),
    onSettled: () => queryClient.invalidateQueries({ queryKey: SYNC_QUERY_KEY_ROOTS.accounts }),
  })
}

export function useDeleteAccount() {
  const repository = useAccountRepository()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => repository.remove(id),
    onSettled: () => queryClient.invalidateQueries({ queryKey: SYNC_QUERY_KEY_ROOTS.accounts }),
  })
}

export type { AccountWithBalance }
