// Tests for the restore-as-new policy module. All tests run against a real
// in-memory SQLite database via createTestDatabase() to exercise the full
// repository path (validation, outbox enqueue, atomicity).

import { beforeEach, describe, expect, it } from 'vitest'
import { createTestDatabase } from '../testing/test-database'
import type { LocalDatabase } from '../types'
import {
  syncOutbox,
  transactions,
  accounts,
  categories,
  debtors,
  debtOperations,
  plannedPayments,
} from '../schema'
import {
  getConflictById,
  listUnresolvedConflicts,
  recordConflict,
} from './conflicts'
import { canRestoreAsNew, restoreConflictAsNew } from './restore'
import type { LocalSyncConflict } from './conflicts'

const CONFLICT_ID = 'conflict-id-1'

let db: LocalDatabase

beforeEach(async () => {
  db = await createTestDatabase()
})

// ---------------------------------------------------------------------------
// canRestoreAsNew
// ---------------------------------------------------------------------------

describe('canRestoreAsNew', () => {
  function makeConflict(localState: unknown): LocalSyncConflict {
    return {
      id: 'c1',
      entity: 'category',
      entityId: 'cat-1',
      opId: null,
      kind: 'deleted',
      baseVersion: 1,
      serverVersion: 2,
      localState,
      serverState: { version: 2, deleted: true },
      createdAt: '2026-01-01T00:00:00Z',
    }
  }

  it('returns true when localState is a non-null object', () => {
    expect(canRestoreAsNew(makeConflict({ name: 'Кафе' }))).toBe(true)
  })

  it('returns false when localState is null', () => {
    expect(canRestoreAsNew(makeConflict(null))).toBe(false)
  })

  it('returns false when localState is a string', () => {
    expect(canRestoreAsNew(makeConflict('oops'))).toBe(false)
  })

  it('returns false when localState is a number', () => {
    expect(canRestoreAsNew(makeConflict(42))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Helpers: seed live entities + record a deleted conflict
// ---------------------------------------------------------------------------

async function seedAccount(overrides: Partial<{
  id: string; name: string; currency: string; openingBalance: number
}> = {}) {
  const id = overrides.id ?? 'acc-1'
  const now = new Date().toISOString()
  db.insert(accounts).values({
    id,
    userId: null,
    name: overrides.name ?? 'Карта',
    currency: overrides.currency ?? 'RUB',
    openingBalance: overrides.openingBalance ?? 0,
    version: 1,
    serverVersion: 1,
    deletedAt: null,
    createdAt: now,
  }).run()
  return id
}

async function seedCategory(overrides: Partial<{
  id: string; name: string; type: string
}> = {}) {
  const id = overrides.id ?? 'cat-1'
  const now = new Date().toISOString()
  db.insert(categories).values({
    id,
    userId: null,
    name: overrides.name ?? 'Продукты',
    type: (overrides.type as 'income' | 'expense') ?? 'expense',
    icon: 'cart',
    color: '#ff0000',
    slug: null,
    archivedAt: null,
    version: 1,
    serverVersion: 1,
    deletedAt: null,
    createdAt: new Date().toISOString(),
  }).run()
  return id
}

async function seedDebtor(name = 'Иван') {
  const now = new Date().toISOString()
  const id = 'debtor-1'
  db.insert(debtors).values({
    id,
    userId: null,
    name,
    version: 1,
    serverVersion: 1,
    deletedAt: null,
    createdAt: now,
  }).run()
  return id
}

function seedDeletedConflict(
  entity: LocalSyncConflict['entity'],
  entityId: string,
  localState: Record<string, unknown>,
) {
  db.transaction((tx) =>
    recordConflict(tx, {
      entity,
      entityId,
      opId: null,
      kind: 'deleted',
      baseVersion: 1,
      serverVersion: 2,
      localState,
      serverState: { version: 2, deleted: true },
    }),
  )
  // For entity rows that represent tombstoned deletions we just need the
  // conflict row; the entity row itself is not required for restore (it
  // creates a new one).
  return CONFLICT_ID
}

// ---------------------------------------------------------------------------
// Happy-path: each entity restores from preserved local state
// ---------------------------------------------------------------------------

describe('restoreConflictAsNew - happy path', () => {
  it('restores an account from preserved local state with a new id', async () => {
    const oldId = 'old-acc-id'
    db.transaction((tx) =>
      recordConflict(tx, {
        entity: 'account',
        entityId: oldId,
        opId: null,
        kind: 'deleted',
        baseVersion: 1,
        serverVersion: 2,
        localState: {
          id: oldId,
          name: 'Карта',
          currency: 'RUB',
          openingBalance: 50000,
        },
        serverState: { version: 2, deleted: true },
      }),
    )
    const conflict = listUnresolvedConflicts(db)[0]!

    const result = await restoreConflictAsNew(db, conflict.id)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.entity).toBe('account')
    expect(result.createdId).not.toBe(oldId)

    const rows = db.select().from(accounts).all()
    expect(rows).toHaveLength(1)
    const row = rows[0]!
    expect(row.id).toBe(result.createdId)
    expect(row.name).toBe('Карта')
    expect(row.currency).toBe('RUB')
    expect(row.openingBalance).toBe(50000)

    // Outbox should have an op for the new record.
    const ops = db.select().from(syncOutbox).all()
    expect(ops.some((op) => op.entityId === result.createdId)).toBe(true)

    // Conflict should now be resolved.
    expect(listUnresolvedConflicts(db)).toHaveLength(0)
  })

  it('restores a category', async () => {
    const oldId = 'old-cat-id'
    db.transaction((tx) =>
      recordConflict(tx, {
        entity: 'category',
        entityId: oldId,
        opId: null,
        kind: 'deleted',
        baseVersion: 1,
        serverVersion: 2,
        localState: { id: oldId, name: 'Кафе', type: 'expense', icon: 'cafe', color: '#7c5cff' },
        serverState: { version: 2, deleted: true },
      }),
    )
    const conflict = listUnresolvedConflicts(db)[0]!

    const result = await restoreConflictAsNew(db, conflict.id)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const rows = db.select().from(categories).all()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.id).toBe(result.createdId)
    expect(rows[0]?.name).toBe('Кафе')
    expect(listUnresolvedConflicts(db)).toHaveLength(0)
  })

  it('restores a debtor', async () => {
    const oldId = 'old-deb-id'
    db.transaction((tx) =>
      recordConflict(tx, {
        entity: 'debtor',
        entityId: oldId,
        opId: null,
        kind: 'deleted',
        baseVersion: 1,
        serverVersion: 2,
        localState: { id: oldId, name: 'Анна', currency: 'RUB' },
        serverState: { version: 2, deleted: true },
      }),
    )
    const conflict = listUnresolvedConflicts(db)[0]!

    const result = await restoreConflictAsNew(db, conflict.id)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const rows = db.select().from(debtors).all()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.name).toBe('Анна')
    expect(listUnresolvedConflicts(db)).toHaveLength(0)
  })

  it('restores a debt_operation (references a live debtor)', async () => {
    const debtorId = await seedDebtor()
    const oldId = 'old-op-id'
    db.transaction((tx) =>
      recordConflict(tx, {
        entity: 'debt_operation',
        entityId: oldId,
        opId: null,
        kind: 'deleted',
        baseVersion: 1,
        serverVersion: 2,
        localState: {
          id: oldId,
          debtorId,
          direction: 'receivable',
          kind: 'debt',
          amount: 10000,
          occurredAt: '2026-01-01T00:00:00.000Z',
        },
        serverState: { version: 2, deleted: true },
      }),
    )
    const conflict = listUnresolvedConflicts(db)[0]!

    const result = await restoreConflictAsNew(db, conflict.id)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const rows = db.select().from(debtOperations).all()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.debtorId).toBe(debtorId)
    expect(rows[0]?.amount).toBe(10000)
    expect(listUnresolvedConflicts(db)).toHaveLength(0)
  })

  it('restores a planned_payment (references live account + category)', async () => {
    const accountId = await seedAccount()
    const categoryId = await seedCategory({ type: 'expense' })
    const oldId = 'old-plan-id'
    db.transaction((tx) =>
      recordConflict(tx, {
        entity: 'planned_payment',
        entityId: oldId,
        opId: null,
        kind: 'deleted',
        baseVersion: 1,
        serverVersion: 2,
        localState: {
          id: oldId,
          type: 'expense',
          amount: 5000,
          name: 'Аренда',
          accountId,
          categoryId,
          nextDue: '2026-02-01',
          anchorDate: '2026-02-01',
          regularity: 'monthly',
          confirmMode: 'manual',
          reminder: 'off',
          note: '',
        },
        serverState: { version: 2, deleted: true },
      }),
    )
    const conflict = listUnresolvedConflicts(db)[0]!

    const result = await restoreConflictAsNew(db, conflict.id)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const rows = db.select().from(plannedPayments).all()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.amount).toBe(5000)
    expect(rows[0]?.name).toBe('Аренда')
    expect(listUnresolvedConflicts(db)).toHaveLength(0)
  })

  // -------------------------------------------------------------------------
  // Adjustment-restore regression case (the core spec requirement)
  // -------------------------------------------------------------------------

  it('[REGRESSION] restores an adjustment transaction as adjustment (not expense), with a new id', async () => {
    const accountId = await seedAccount()
    const oldId = 'old-tx-adj-id'
    db.transaction((tx) =>
      recordConflict(tx, {
        entity: 'transaction',
        entityId: oldId,
        opId: null,
        kind: 'deleted',
        baseVersion: 1,
        serverVersion: 2,
        localState: {
          id: oldId,
          type: 'adjustment',
          amount: -5000, // nonzero signed is valid for adjustment
          description: 'correction',
          occurredAt: '2026-01-15T10:00:00.000Z',
          accountId,
        },
        serverState: { version: 2, deleted: true },
      }),
    )
    const conflict = listUnresolvedConflicts(db)[0]!

    const result = await restoreConflictAsNew(db, conflict.id)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.createdId).not.toBe(oldId)

    const rows = db.select().from(transactions).all()
    expect(rows).toHaveLength(1)
    const row = rows[0]!
    // Must be adjustment, not coerced to expense.
    expect(row.type).toBe('adjustment')
    expect(row.amount).toBe(-5000)
    expect(row.accountId).toBe(accountId)
    expect(row.id).toBe(result.createdId)

    expect(listUnresolvedConflicts(db)).toHaveLength(0)
  })

  it('restores an income transaction (account-less: accountId null)', async () => {
    const categoryId = await seedCategory({ type: 'income' })
    const oldId = 'old-income-id'
    db.transaction((tx) =>
      recordConflict(tx, {
        entity: 'transaction',
        entityId: oldId,
        opId: null,
        kind: 'deleted',
        baseVersion: 1,
        serverVersion: 2,
        localState: {
          id: oldId,
          type: 'income',
          amount: 100000,
          description: '',
          occurredAt: '2026-01-15T10:00:00.000Z',
          accountId: null,
          categoryId,
        },
        serverState: { version: 2, deleted: true },
      }),
    )
    const conflict = listUnresolvedConflicts(db)[0]!

    const result = await restoreConflictAsNew(db, conflict.id)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const rows = db.select().from(transactions).all()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.type).toBe('income')
    expect(rows[0]?.accountId).toBeNull()
    expect(listUnresolvedConflicts(db)).toHaveLength(0)
  })

  it('restores a transfer transaction', async () => {
    const fromId = await seedAccount({ id: 'acc-from', name: 'From' })
    const toId = await seedAccount({ id: 'acc-to', name: 'To' })
    const oldId = 'old-transfer-id'
    db.transaction((tx) =>
      recordConflict(tx, {
        entity: 'transaction',
        entityId: oldId,
        opId: null,
        kind: 'deleted',
        baseVersion: 1,
        serverVersion: 2,
        localState: {
          id: oldId,
          type: 'transfer',
          amount: 20000,
          description: '',
          occurredAt: '2026-01-15T10:00:00.000Z',
          fromAccountId: fromId,
          toAccountId: toId,
        },
        serverState: { version: 2, deleted: true },
      }),
    )
    const conflict = listUnresolvedConflicts(db)[0]!

    const result = await restoreConflictAsNew(db, conflict.id)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const rows = db.select().from(transactions).all()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.type).toBe('transfer')
    expect(rows[0]?.fromAccountId).toBe(fromId)
    expect(listUnresolvedConflicts(db)).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Refusal cases: each leaves the conflict unresolved with no outbox row
// ---------------------------------------------------------------------------

describe('restoreConflictAsNew - refusal cases', () => {
  it('returns conflict-missing when the conflict id does not exist', async () => {
    const result = await restoreConflictAsNew(db, 'nonexistent-id')

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('conflict-missing')
    expect(db.select().from(syncOutbox).all()).toHaveLength(0)
  })

  it('returns no-local-state when localState is null', async () => {
    db.transaction((tx) =>
      recordConflict(tx, {
        entity: 'account',
        entityId: 'acc-gone',
        opId: null,
        kind: 'deleted',
        baseVersion: 1,
        serverVersion: 2,
        localState: null,
        serverState: { version: 2, deleted: true },
      }),
    )
    const conflict = listUnresolvedConflicts(db)[0]!

    const result = await restoreConflictAsNew(db, conflict.id)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('no-local-state')
    // Conflict stays unresolved.
    expect(listUnresolvedConflicts(db)).toHaveLength(1)
    expect(db.select().from(syncOutbox).all()).toHaveLength(0)
  })

  it('returns invalid-state when the account currency is missing', async () => {
    db.transaction((tx) =>
      recordConflict(tx, {
        entity: 'account',
        entityId: 'acc-bad',
        opId: null,
        kind: 'deleted',
        baseVersion: 1,
        serverVersion: 2,
        localState: { name: 'Карта' /* currency missing */ },
        serverState: { version: 2, deleted: true },
      }),
    )
    const conflict = listUnresolvedConflicts(db)[0]!

    const result = await restoreConflictAsNew(db, conflict.id)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('invalid-state')
    expect(result.field).toBe('currency')
    expect(listUnresolvedConflicts(db)).toHaveLength(1)
    expect(db.select().from(syncOutbox).all()).toHaveLength(0)
  })

  it('returns invalid-state when the transaction type is missing', async () => {
    db.transaction((tx) =>
      recordConflict(tx, {
        entity: 'transaction',
        entityId: 'tx-bad',
        opId: null,
        kind: 'deleted',
        baseVersion: 1,
        serverVersion: 2,
        localState: { amount: 1000, occurredAt: '2026-01-01T00:00:00Z' /* type missing */ },
        serverState: { version: 2, deleted: true },
      }),
    )
    const conflict = listUnresolvedConflicts(db)[0]!

    const result = await restoreConflictAsNew(db, conflict.id)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('invalid-state')
    expect(result.field).toBe('type')
    expect(listUnresolvedConflicts(db)).toHaveLength(1)
    expect(db.select().from(syncOutbox).all()).toHaveLength(0)
  })

  it('returns invalid-state when the adjustment accountId is missing', async () => {
    db.transaction((tx) =>
      recordConflict(tx, {
        entity: 'transaction',
        entityId: 'tx-adj-bad',
        opId: null,
        kind: 'deleted',
        baseVersion: 1,
        serverVersion: 2,
        localState: {
          type: 'adjustment',
          amount: 1000,
          occurredAt: '2026-01-01T00:00:00Z',
          // accountId missing
        },
        serverState: { version: 2, deleted: true },
      }),
    )
    const conflict = listUnresolvedConflicts(db)[0]!

    const result = await restoreConflictAsNew(db, conflict.id)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('invalid-state')
    expect(result.field).toBe('accountId')
    expect(listUnresolvedConflicts(db)).toHaveLength(1)
    expect(db.select().from(syncOutbox).all()).toHaveLength(0)
  })

  it('returns invalid-state when a referenced account does not exist (create throws)', async () => {
    // The account reference is valid-looking but the account is not in the db.
    db.transaction((tx) =>
      recordConflict(tx, {
        entity: 'transaction',
        entityId: 'tx-ref-bad',
        opId: null,
        kind: 'deleted',
        baseVersion: 1,
        serverVersion: 2,
        localState: {
          type: 'adjustment',
          amount: 1000,
          occurredAt: '2026-01-01T00:00:00Z',
          accountId: 'nonexistent-account-id',
        },
        serverState: { version: 2, deleted: true },
      }),
    )
    const conflict = listUnresolvedConflicts(db)[0]!

    const result = await restoreConflictAsNew(db, conflict.id)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('invalid-state')
    // Conflict stays unresolved.
    expect(listUnresolvedConflicts(db)).toHaveLength(1)
    expect(db.select().from(syncOutbox).all()).toHaveLength(0)
  })
})
