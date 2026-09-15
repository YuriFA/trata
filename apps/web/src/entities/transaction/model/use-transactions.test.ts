import { describe, it, expect, vi, beforeEach } from 'vitest'
import { defineComponent, h } from 'vue'
import { createPinia } from 'pinia'
import { flushPromises } from '@vue/test-utils'
import { useQueryCache } from '@pinia/colada'
import type { CashflowTransaction, Transaction, TransferTransaction } from './types'
import {
  useTransactions,
  useTransaction,
  useCreateTransaction,
  useUpdateTransaction,
  useDeleteTransaction,
} from './use-transactions'
import { createMockTransactionRepository } from '@/__tests__/helpers/mock-repositories'
import { mountWithProviders } from '@/__tests__/helpers/mount-with-providers'

const incomeTransaction: CashflowTransaction = {
  id: 't1',
  type: 'income',
  amount: 100,
  description: '',
  occurredAt: '2024-01-01T00:00:00Z',
  accountId: 'a1',
  categoryId: 'c1',
} as never

const transferTransaction: TransferTransaction = {
  id: 't2',
  type: 'transfer',
  amount: 50,
  description: '',
  occurredAt: '2024-01-02T00:00:00Z',
  fromAccountId: 'a1',
  toAccountId: 'a2',
} as never

function mountWithComposable<T>(
  composable: () => T,
  options: Parameters<typeof mountWithProviders>[1] = {},
): { result: T } {
  let result!: T
  const TestComponent = defineComponent({
    setup() {
      result = composable()
      return () => h('div')
    },
  })
  mountWithProviders(TestComponent, options)
  return { result }
}

describe('useTransactions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls repository.query on mount with options', async () => {
    const repo = createMockTransactionRepository()
    repo.query.mockResolvedValue([incomeTransaction])
    const { result } = mountWithComposable(() => useTransactions({ type: 'income' }), {
      repositories: { transactions: repo },
    })
    await flushPromises()
    expect(repo.query).toHaveBeenCalledWith({ type: 'income' })
    expect(result.data.value).toEqual([incomeTransaction])
  })

  it('calls repository.query with default empty options when none provided', async () => {
    const repo = createMockTransactionRepository()
    repo.query.mockResolvedValue([])
    mountWithComposable(() => useTransactions(), {
      repositories: { transactions: repo },
    })
    await flushPromises()
    expect(repo.query).toHaveBeenCalledWith({})
  })

  it('exposes loading state initially', () => {
    const repo = createMockTransactionRepository()
    repo.query.mockReturnValue(new Promise<Transaction[]>(() => {}))
    const { result } = mountWithComposable(() => useTransactions(), {
      repositories: { transactions: repo },
    })
    expect(result.isLoading.value).toBe(true)
  })
})

describe('useTransaction', () => {
  it('disables query when id is undefined', () => {
    const repo = createMockTransactionRepository()
    const { result } = mountWithComposable(() => useTransaction(() => undefined), {
      repositories: { transactions: repo },
    })
    expect(repo.getById).not.toHaveBeenCalled()
    expect(result.isLoading.value).toBe(false)
  })

  it('fetches when id is provided', async () => {
    const repo = createMockTransactionRepository()
    repo.getById.mockResolvedValue(incomeTransaction)
    mountWithComposable(() => useTransaction(() => 't1'), {
      repositories: { transactions: repo },
    })
    await flushPromises()
    expect(repo.getById).toHaveBeenCalledWith('t1')
  })
})

describe('useCreateTransaction', () => {
  it('calls repository.create on mutate (cashflow)', async () => {
    const repo = createMockTransactionRepository()
    repo.create.mockResolvedValue(incomeTransaction)
    const { result } = mountWithComposable(() => useCreateTransaction<CashflowTransaction>(), {
      repositories: { transactions: repo },
    })
    const payload = {
      type: 'income' as const,
      amount: 100,
      description: '',
      occurredAt: '2024-01-01T00:00:00Z',
      accountId: 'a1',
      categoryId: 'c1',
    }
    await result.mutateAsync(payload)
    expect(repo.create).toHaveBeenCalledWith(payload)
  })

  it('calls repository.create on mutate (transfer)', async () => {
    const repo = createMockTransactionRepository()
    repo.create.mockResolvedValue(transferTransaction)
    const { result } = mountWithComposable(() => useCreateTransaction<TransferTransaction>(), {
      repositories: { transactions: repo },
    })
    const payload = {
      type: 'transfer' as const,
      amount: 50,
      description: '',
      occurredAt: '2024-01-02T00:00:00Z',
      fromAccountId: 'a1',
      toAccountId: 'a2',
    }
    await result.mutateAsync(payload)
    expect(repo.create).toHaveBeenCalledWith(payload)
  })
})

describe('useUpdateTransaction', () => {
  it('calls repository.update on mutate', async () => {
    const repo = createMockTransactionRepository()
    repo.update.mockResolvedValue(incomeTransaction)
    const { result } = mountWithComposable(() => useUpdateTransaction(), {
      repositories: { transactions: repo },
    })
    const payload = { version: 1, amount: 200 }
    await result.mutateAsync({ id: 't1', payload })
    expect(repo.update).toHaveBeenCalledWith('t1', payload)
  })

  it('refetches list queries after mutate so updated data is visible', async () => {
    const repo = createMockTransactionRepository()
    const updated: CashflowTransaction = { ...incomeTransaction, accountId: 'a2', version: 2 }
    repo.query.mockResolvedValueOnce([incomeTransaction]).mockResolvedValueOnce([updated])
    repo.update.mockResolvedValue(updated)
    const pinia = createPinia()

    const { result: list } = mountWithComposable(() => useTransactions({ limit: 5 }), {
      pinia,
      repositories: { transactions: repo },
    })
    const { result: update } = mountWithComposable(
      () => useUpdateTransaction<CashflowTransaction>(),
      { pinia, repositories: { transactions: repo } },
    )
    await flushPromises()
    expect(list.data.value).toEqual([incomeTransaction])

    await update.mutateAsync({ id: 't1', payload: { version: 1, accountId: 'a2' } })
    await flushPromises()

    // A stale list keeps showing the old row AND feeds the old `version`
    // back into the edit dialog -> TRANSACTION_VERSION_CONFLICT on retry.
    expect(list.data.value).toEqual([updated])
  })
})

describe('useDeleteTransaction', () => {
  it('calls repository.remove on mutate', async () => {
    const repo = createMockTransactionRepository()
    repo.remove.mockResolvedValue(undefined)
    const { result } = mountWithComposable(() => useDeleteTransaction(), {
      repositories: { transactions: repo },
    })
    await result.mutateAsync('t1')
    expect(repo.remove).toHaveBeenCalledWith('t1')
  })

  it('optimistically removes transaction from all matching list caches and detail cache', async () => {
    const repo = createMockTransactionRepository()
    repo.remove.mockResolvedValue(undefined)
    const other: CashflowTransaction = { ...incomeTransaction, id: 't3' } as never
    const { result } = mountWithComposable(
      () => {
        const queryCache = useQueryCache()
        queryCache.setQueryData<Transaction[]>(['transactions', {}], [incomeTransaction, other])
        queryCache.setQueryData<Transaction[]>(
          ['transactions', { type: 'income' }],
          [incomeTransaction],
        )
        queryCache.setQueryData<Transaction>(['transactions', 't1'], incomeTransaction)
        return { mutation: useDeleteTransaction(), queryCache }
      },
      { repositories: { transactions: repo } },
    )

    await result.mutation.mutateAsync('t1')
    await flushPromises()

    expect(
      result.queryCache.getQueryData<Transaction[]>(['transactions', {}])?.map((t) => t.id),
    ).toEqual(['t3'])
    expect(
      result.queryCache.getQueryData<Transaction[]>(['transactions', { type: 'income' }]),
    ).toEqual([])
    expect(result.queryCache.getQueryData(['transactions', 't1'])).toBeUndefined()
  })

  it('rolls back all caches on error', async () => {
    const repo = createMockTransactionRepository()
    repo.remove.mockRejectedValue(new Error('boom'))
    const { result } = mountWithComposable(
      () => {
        const queryCache = useQueryCache()
        queryCache.setQueryData<Transaction[]>(['transactions', {}], [incomeTransaction])
        queryCache.setQueryData<Transaction>(['transactions', 't1'], incomeTransaction)
        return { mutation: useDeleteTransaction(), queryCache }
      },
      { repositories: { transactions: repo } },
    )

    await expect(result.mutation.mutateAsync('t1')).rejects.toThrow('boom')
    await flushPromises()

    expect(
      result.queryCache.getQueryData<Transaction[]>(['transactions', {}])?.map((t) => t.id),
    ).toEqual(['t1'])
    expect(result.queryCache.getQueryData<Transaction>(['transactions', 't1'])?.id).toBe('t1')
  })

  it('invalidates accounts cache on settle to refresh balance', async () => {
    const repo = createMockTransactionRepository()
    repo.remove.mockResolvedValue(undefined)
    const { result } = mountWithComposable(
      () => {
        const queryCache = useQueryCache()
        return { mutation: useDeleteTransaction(), queryCache }
      },
      { repositories: { transactions: repo } },
    )
    const invalidateSpy = vi.spyOn(result.queryCache, 'invalidateQueries')

    await result.mutation.mutateAsync('t1')
    await flushPromises()

    const invalidatedKeys = invalidateSpy.mock.calls.map((call) => call[0])
    expect(invalidatedKeys).toContainEqual({ key: ['accounts'] })
  })
})
