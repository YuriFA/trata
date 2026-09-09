// In-memory mock repositories backing hook/screen tests: they implement the
// shared repository interfaces and count calls so tests can assert cache
// invalidation (a mutation must trigger a re-read). Test-only helpers.

import {
  NotFoundError,
  VersionConflictError,
  type Account,
  type AccountRepository,
  type CreateAccountPayload,
  type UpdateAccountPayload,
} from '@trata/api'

export interface MockAccountRepository extends AccountRepository {
  /** Copy of the current in-memory rows. */
  snapshot(): Account[]
  calls: { getAll: number; create: number; update: number; remove: number }
}

export function createMockAccountRepository(initial: Account[] = []): MockAccountRepository {
  let items = [...initial]
  const calls = { getAll: 0, create: 0, update: 0, remove: 0 }
  let nextId = 1

  return {
    calls,
    snapshot: () => [...items],
    async getAll() {
      calls.getAll += 1
      return items.map((account) => ({
        ...account,
        balance: account.openingBalance,
      }))
    },
    async getById(id) {
      const account = items.find((item) => item.id === id)
      return account ? { ...account, balance: account.openingBalance } : null
    },
    async create(payload: CreateAccountPayload) {
      calls.create += 1
      const account: Account = {
        ...payload,
        id: payload.id ?? `acc-${nextId++}`,
        version: 1,
      }
      items.push(account)
      return { ...account, balance: account.openingBalance }
    },
    async update(id, payload: UpdateAccountPayload) {
      calls.update += 1
      const index = items.findIndex((account) => account.id === id)
      if (index === -1) throw new NotFoundError('Account not found')
      if (payload.version !== items[index].version) {
        throw new VersionConflictError('Account was modified concurrently', {
          apiCode: 'ACCOUNT_VERSION_CONFLICT',
        })
      }
      const { version: _cas, ...fields } = payload
      items[index] = { ...items[index], ...fields, version: items[index].version + 1 }
      const updated = items[index]
      return { ...updated, balance: updated.openingBalance }
    },
    async remove(id) {
      calls.remove += 1
      const next = items.filter((account) => account.id !== id)
      if (next.length === items.length) throw new NotFoundError('Account not found')
      items = next
    },
  }
}
