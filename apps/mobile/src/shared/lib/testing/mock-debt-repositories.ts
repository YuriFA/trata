// Test-only debt repository mocks (the mock-transaction-repository pattern):
// in-memory state plus per-method call counters, so tests can pin read counts
// (the debts screen's one-query performance invariant).
//
// NEVER import this from app code - it exists for `*.test.ts(x)` files only.

import {
  AlreadyExistsError,
  NotFoundError,
  VersionConflictError,
  type CreateDebtOperationPayload,
  type CreateDebtorPayload,
  type DebtOperation,
  type DebtOperationRepository,
  type Debtor,
  type DebtorRepository,
  type UpdateDebtOperationPayload,
  type UpdateDebtorPayload,
} from '@trata/api'

export interface MockDebtorRepository extends DebtorRepository {
  snapshot(): Debtor[]
  calls: { getAll: number; create: number; update: number; remove: number }
}

export function createMockDebtorRepository(initial: Debtor[] = []): MockDebtorRepository {
  let items = [...initial]
  const calls = { getAll: 0, create: 0, update: 0, remove: 0 }
  let nextId = 1

  return {
    calls,
    snapshot: () => [...items],
    async getAll() {
      calls.getAll += 1
      return [...items]
    },
    async getById(id) {
      return items.find((debtor) => debtor.id === id) ?? null
    },
    async create(payload: CreateDebtorPayload) {
      calls.create += 1
      if (items.some((debtor) => debtor.name === payload.name)) {
        throw new AlreadyExistsError('Debtor exists', { apiCode: 'DEBTOR_ALREADY_EXISTS' })
      }
      const debtor: Debtor = {
        id: payload.id ?? `debtor-${nextId++}`,
        name: payload.name,
        note: payload.note ?? '',
        version: 1,
      }
      items.push(debtor)
      return { ...debtor }
    },
    async update(id, payload: UpdateDebtorPayload) {
      calls.update += 1
      const index = items.findIndex((debtor) => debtor.id === id)
      if (index === -1) throw new NotFoundError('Debtor not found')
      if (payload.version !== items[index].version) {
        throw new VersionConflictError('Debtor was modified concurrently')
      }
      const { version, ...rest } = payload
      void version
      items[index] = {
        ...items[index],
        ...rest,
        note: rest.note ?? items[index].note,
        version: items[index].version + 1,
      }
      return { ...items[index] }
    },
    async remove(id) {
      calls.remove += 1
      const next = items.filter((debtor) => debtor.id !== id)
      if (next.length === items.length) throw new NotFoundError('Debtor not found')
      items = next
    },
  }
}

export interface MockDebtOperationRepository extends DebtOperationRepository {
  snapshot(): DebtOperation[]
  calls: { getAll: number; create: number; update: number; remove: number }
  /** Makes the next create reject with the given error (error-mapping tests). */
  failNextCreateWith(error: Error): void
}

export function createMockDebtOperationRepository(
  initial: DebtOperation[] = [],
): MockDebtOperationRepository {
  let items = [...initial]
  const calls = { getAll: 0, create: 0, update: 0, remove: 0 }
  let nextId = 1
  let nextCreateError: Error | null = null

  return {
    calls,
    snapshot: () => [...items],
    failNextCreateWith(error: Error) {
      nextCreateError = error
    },
    async getAll() {
      calls.getAll += 1
      return [...items]
    },
    async getById(id) {
      return items.find((operation) => operation.id === id) ?? null
    },
    async query(options = {}) {
      return this.getAll().then((all) =>
        options.debtorId ? all.filter((op) => op.debtorId === options.debtorId) : all,
      )
    },
    async create(payload: CreateDebtOperationPayload) {
      calls.create += 1
      if (nextCreateError) {
        const error = nextCreateError
        nextCreateError = null
        throw error
      }
      const operation = {
        ...payload,
        id: payload.id ?? `op-${nextId++}`,
        version: 1,
      } as DebtOperation
      items.push(operation)
      return { ...operation }
    },
    async update(id, payload: UpdateDebtOperationPayload) {
      calls.update += 1
      const index = items.findIndex((operation) => operation.id === id)
      if (index === -1) throw new NotFoundError('Debt operation not found')
      if (payload.version !== items[index].version) {
        throw new VersionConflictError('Debt operation was modified concurrently')
      }
      const { version, ...rest } = payload
      void version
      items[index] = {
        ...items[index],
        ...rest,
        note: rest.note ?? items[index].note,
        version: items[index].version + 1,
      }
      return { ...items[index] }
    },
    async remove(id) {
      calls.remove += 1
      const next = items.filter((operation) => operation.id !== id)
      if (next.length === items.length) throw new NotFoundError('Debt operation not found')
      items = next
    },
  }
}
