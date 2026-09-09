import {
  NotFoundError,
  type CreateTransactionPayload,
  type Transaction,
  type TransactionPage,
  type TransactionQuery,
  type TransactionRepository,
  type UpdateTransactionPayload,
} from '@trata/api'

export interface MockTransactionRepository extends TransactionRepository {
  snapshot(): Transaction[]
  calls: { query: number; create: number; update: number; remove: number }
}

const byOccurredAtDesc = (a: Transaction, b: Transaction) =>
  b.occurredAt.localeCompare(a.occurredAt) || b.id.localeCompare(a.id)

export function createMockTransactionRepository(
  initial: Transaction[] = [],
): MockTransactionRepository {
  let items = [...initial]
  const calls = { query: 0, create: 0, update: 0, remove: 0 }
  let nextId = 1

  return {
    calls,
    snapshot: () => [...items],
    async getAll() {
      return [...items].sort(byOccurredAtDesc)
    },
    async getById(id) {
      return items.find((transaction) => transaction.id === id) ?? null
    },
    async query(options: TransactionQuery = {}) {
      calls.query += 1
      let result = [...items].sort(byOccurredAtDesc)
      if (options.type) result = result.filter((t) => t.type === options.type)
      if (options.accountId) {
        result = result.filter((t) =>
          t.type === 'transfer'
            ? t.fromAccountId === options.accountId || t.toAccountId === options.accountId
            : t.accountId === options.accountId,
        )
      }
      if (options.categoryId) {
        result = result.filter((t) => t.type !== 'transfer' && t.categoryId === options.categoryId)
      }
      if (options.fromDate)
        result = result.filter((t) => t.occurredAt >= (options.fromDate as string))
      if (options.toDate) {
        result = result.filter((t) => t.occurredAt <= `${options.toDate}T23:59:59.999Z`)
      }
      return result
    },
    async listPage(options: TransactionQuery & { cursor?: string } = {}): Promise<TransactionPage> {
      const all = await this.query(options)
      const start = options.cursor ? Number.parseInt(options.cursor, 10) : 0
      const slice = all.slice(start, start + 100)
      const next = start + slice.length
      return { transactions: slice, nextCursor: next < all.length ? String(next) : null }
    },
    async create(payload: CreateTransactionPayload) {
      calls.create += 1
      const transaction = {
        ...payload,
        id: payload.id ?? `tx-${nextId++}`,
        version: 1,
      } as Transaction
      items.push(transaction)
      return { ...transaction }
    },
    async update(id, payload: UpdateTransactionPayload) {
      calls.update += 1
      const index = items.findIndex((transaction) => transaction.id === id)
      if (index === -1) throw new NotFoundError('Transaction not found')
      const { version, ...rest } = payload
      void version
      items[index] = { ...items[index], ...rest } as Transaction
      return { ...items[index] }
    },
    async remove(id) {
      calls.remove += 1
      const next = items.filter((transaction) => transaction.id !== id)
      if (next.length === items.length) throw new NotFoundError('Transaction not found')
      items = next
    },
  }
}
