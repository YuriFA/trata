// Domain rules of the local transaction repository, mirroring the backend's
// validation granularity and error codes: reference checks, category type
// matching, distinct transfer accounts, optimistic concurrency, filters and
// ordering, pagination, and tombstone deletes.

import { beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import {
  AlreadyExistsError,
  type CashflowTransaction,
  type CreateTransactionPayload,
  InvalidPayloadError,
  NotFoundError,
  UnknownReferencesError,
  VersionConflictError,
} from '@trata/api'
import { createLocalAccountRepository } from '../repositories/account'
import { createLocalCategoryRepository } from '../repositories/category'
import { createTestDatabase } from '../testing/test-database'
import { syncOutbox, transactions } from '../schema'
import type { LocalDatabase } from '../types'
import { createLocalTransactionRepository } from './transaction'

let db: LocalDatabase
let accountRepo: ReturnType<typeof createLocalAccountRepository>
let categoryRepo: ReturnType<typeof createLocalCategoryRepository>
let transactionRepo: ReturnType<typeof createLocalTransactionRepository>
let cardId: string
let cashId: string
let expenseCategoryId: string
let incomeCategoryId: string

beforeEach(async () => {
  db = await createTestDatabase()
  accountRepo = createLocalAccountRepository(db)
  categoryRepo = createLocalCategoryRepository(db)
  transactionRepo = createLocalTransactionRepository(db)

  const card = await accountRepo.create({ name: 'Карта', currency: 'RUB', openingBalance: 0 })
  const cash = await accountRepo.create({ name: 'Наличные', currency: 'RUB', openingBalance: 0 })
  cardId = card.id
  cashId = cash.id
  expenseCategoryId = (
    await categoryRepo.create({ name: 'Кафе', type: 'expense', icon: 'cafe', color: '#a78bfa' })
  ).id
  incomeCategoryId = (
    await categoryRepo.create({ name: 'Зарплата', type: 'income', icon: 'cash', color: '#16a34a' })
  ).id

  // The seeds' own outbox operations are irrelevant to these tests.
  db.delete(syncOutbox).run()
})

function cashflowPayload(overrides: Record<string, unknown> = {}): CreateTransactionPayload {
  return {
    type: 'expense',
    amount: 1_000,
    description: 'Кофе',
    occurredAt: '2026-08-10T12:00:00.000Z',
    accountId: cardId,
    categoryId: expenseCategoryId,
    ...overrides,
  } as CreateTransactionPayload
}

describe('local transaction repository: create validation', () => {
  it('creates a cashflow transaction with a client UUID and canonical UTC occurredAt', async () => {
    const transaction = await transactionRepo.create(
      cashflowPayload({ occurredAt: '2026-08-10T15:00:00+03:00' }),
    )
    expect(transaction.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(transaction.occurredAt).toBe('2026-08-10T12:00:00.000Z')
    expect(transaction.version).toBe(1)
    expect(db.select().from(syncOutbox).all()).toHaveLength(1)
  })

  it('rejects amounts below one minor unit', async () => {
    await expect(transactionRepo.create(cashflowPayload({ amount: 0 }))).rejects.toMatchObject({
      code: 'invalid-payload',
    })
    await expect(transactionRepo.create(cashflowPayload({ amount: 0.5 }))).rejects.toBeInstanceOf(
      InvalidPayloadError,
    )
  })

  it('rejects an unparseable occurredAt', async () => {
    await expect(
      transactionRepo.create(cashflowPayload({ occurredAt: 'not-a-date' })),
    ).rejects.toBeInstanceOf(InvalidPayloadError)
  })

  it('rejects unknown references with the unknown-references code', async () => {
    const accountError = await transactionRepo
      .create(cashflowPayload({ accountId: 'missing' }))
      .catch((e) => e)
    expect(accountError).toBeInstanceOf(UnknownReferencesError)
    expect((accountError as UnknownReferencesError).apiCode).toBe('ACCOUNT_NOT_FOUND')

    const categoryError = await transactionRepo
      .create(cashflowPayload({ categoryId: 'missing' }))
      .catch((e) => e)
    expect(categoryError).toBeInstanceOf(UnknownReferencesError)
    expect((categoryError as UnknownReferencesError).apiCode).toBe('CATEGORY_NOT_FOUND')
  })

  it('rejects a category type mismatch with the backend apiCode', async () => {
    const error = await transactionRepo
      .create(cashflowPayload({ categoryId: incomeCategoryId }))
      .catch((e) => e)
    expect(error).toBeInstanceOf(InvalidPayloadError)
    expect((error as InvalidPayloadError).apiCode).toBe('CATEGORY_TYPE_MISMATCH')
  })

  it('rejects a new reference to an archived category but allows keeping one', async () => {
    const other = await categoryRepo.create({
      name: 'Другое',
      type: 'expense',
      icon: 'box',
      color: '#7c5cff',
    })
    // A transaction recorded while the category was active...
    const kept = await transactionRepo.create(cashflowPayload())
    await categoryRepo.update(expenseCategoryId, { version: 1, archived: true })
    await categoryRepo.update(other.id, { version: 1, archived: true })

    // ...keeps it when edited without touching the category...
    const edited = await transactionRepo.update(kept.id, {
      version: kept.version,
      description: 'обновлено',
    })
    expect(edited.categoryId).toBe(kept.categoryId)

    // ...but a fresh assignment (create or switch) is rejected with the code.
    const created = await transactionRepo
      .create(cashflowPayload())
      .catch((e) => e)
    expect(created).toBeInstanceOf(InvalidPayloadError)
    expect((created as InvalidPayloadError).apiCode).toBe('CATEGORY_ARCHIVED')

    const switched = await transactionRepo
      .update(kept.id, { version: edited.version, categoryId: other.id })
      .catch((e) => e)
    expect(switched).toBeInstanceOf(InvalidPayloadError)
    expect((switched as InvalidPayloadError).apiCode).toBe('CATEGORY_ARCHIVED')
  })

  it('rejects a same-account transfer with the backend apiCode; distinct accounts pass', async () => {
    const error = await transactionRepo
      .create({
        type: 'transfer',
        amount: 100,
        description: '',
        occurredAt: '2026-08-10T12:00:00.000Z',
        fromAccountId: cardId,
        toAccountId: cardId,
      })
      .catch((e) => e)
    expect(error).toBeInstanceOf(InvalidPayloadError)
    expect((error as InvalidPayloadError).apiCode).toBe('SAME_ACCOUNT_TRANSFER')

    const transfer = await transactionRepo.create({
      type: 'transfer',
      amount: 100,
      description: '',
      occurredAt: '2026-08-10T12:00:00.000Z',
      fromAccountId: cardId,
      toAccountId: cashId,
    })
    expect(transfer.type).toBe('transfer')
  })

  it('honors a client-supplied id', async () => {
    const transaction = await transactionRepo.create(cashflowPayload({ id: 'tx-client-1' }))
    expect(transaction.id).toBe('tx-client-1')

    // AlreadyExistsError (coarse `already-exists`), mirroring the HTTP
    // client's mapping of the backend's 409 TRANSACTION_ALREADY_EXISTS:
    // the coarse code survives the web worker bridge, apiCode does not.
    const error = await transactionRepo.create(cashflowPayload({ id: 'tx-client-1' })).catch((e) => e)
    expect(error).toBeInstanceOf(AlreadyExistsError)
    expect((error as AlreadyExistsError).apiCode).toBe('TRANSACTION_ALREADY_EXISTS')
  })

  it('creates an adjustment with a signed amount and no category', async () => {
    const adjustment = await transactionRepo.create({
      type: 'adjustment',
      amount: -2_500,
      description: 'сверка наличных',
      occurredAt: '2026-08-10T12:00:00.000Z',
      accountId: cardId,
    })
    expect(adjustment).toMatchObject({ type: 'adjustment', amount: -2_500, accountId: cardId })
  })

  it('rejects a zero adjustment amount and forbidden references', async () => {
    const zeroError = await transactionRepo
      .create({
        type: 'adjustment',
        amount: 0,
        description: '',
        occurredAt: '2026-08-10T12:00:00.000Z',
        accountId: cardId,
      })
      .catch((e) => e)
    expect(zeroError).toBeInstanceOf(InvalidPayloadError)
    expect((zeroError as InvalidPayloadError).apiCode).toBe('INVALID_AMOUNT')

    const refsError = await transactionRepo
      .create({
        type: 'adjustment',
        amount: -100,
        description: '',
        occurredAt: '2026-08-10T12:00:00.000Z',
        accountId: cardId,
        categoryId: incomeCategoryId,
      } as never)
      .catch((e) => e)
    expect(refsError).toBeInstanceOf(InvalidPayloadError)
    expect((refsError as InvalidPayloadError).apiCode).toBe('INVALID_REFS')
  })
})

describe('local transaction repository: update', () => {
  it('requires the read version and rejects stale ones with the version-conflict code', async () => {
    const transaction = await transactionRepo.create(cashflowPayload())

    const updated = await transactionRepo.update(transaction.id, {
      version: 1,
      amount: 2_000,
    })
    expect(updated.amount).toBe(2_000)
    expect(updated.version).toBe(2)

    const stale = await transactionRepo
      .update(transaction.id, { version: 1, amount: 3_000 })
      .catch((e) => e)
    expect(stale).toBeInstanceOf(VersionConflictError)
    expect((stale as VersionConflictError).apiCode).toBe('TRANSACTION_VERSION_CONFLICT')

    const row = db.select().from(transactions).where(eq(transactions.id, transaction.id)).get()
    expect(row?.version).toBe(2)
    expect(row?.serverVersion).toBe(0)
    // create + one successful update -> two pending operations
    expect(db.select().from(syncOutbox).all()).toHaveLength(2)
  })

  it('ignores a type change (type is immutable, like the backend PATCH)', async () => {
    const transaction = await transactionRepo.create(cashflowPayload())
    const updated = await transactionRepo.update(transaction.id, {
      version: 1,
      type: 'transfer',
      amount: 5,
    } as never)
    expect(updated.type).toBe('expense')
    expect(updated.amount).toBe(5)

    // A payload carrying ONLY the immutable type is an empty update.
    await expect(
      transactionRepo.update(transaction.id, { version: 2, type: 'income' } as never),
    ).rejects.toBeInstanceOf(InvalidPayloadError)
  })

  it('re-validates references against the effective state', async () => {
    const transaction = await transactionRepo.create(cashflowPayload())
    await expect(
      transactionRepo.update(transaction.id, { version: 1, categoryId: incomeCategoryId }),
    ).rejects.toMatchObject({ code: 'invalid-payload' })
  })

  it('rejects an empty update and mutations of deleted records', async () => {
    const transaction = await transactionRepo.create(cashflowPayload())
    await expect(transactionRepo.update(transaction.id, { version: 1 })).rejects.toBeInstanceOf(
      InvalidPayloadError,
    )

    await transactionRepo.remove(transaction.id)
    await expect(
      transactionRepo.update(transaction.id, { version: 1, amount: 5 }),
    ).rejects.toMatchObject({ code: 'not-found' })
    await expect(transactionRepo.remove(transaction.id)).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe('local transaction repository: query and pagination', () => {
  it('filters by type, account (both transfer sides), and category', async () => {
    await transactionRepo.create(cashflowPayload({ description: 'e1' }))
    await transactionRepo.create(
      cashflowPayload({
        type: 'income',
        amount: 500,
        categoryId: incomeCategoryId,
        description: 'i1',
      }),
    )
    const transfer = await transactionRepo.create({
      type: 'transfer',
      amount: 100,
      description: 't1',
      occurredAt: '2026-08-10T12:00:00.000Z',
      fromAccountId: cardId,
      toAccountId: cashId,
    })

    expect(await transactionRepo.query({ type: 'expense' })).toHaveLength(1)
    expect(await transactionRepo.query({ type: 'income' })).toHaveLength(1)

    // Account filter matches the transfer's destination side too.
    const byCash = await transactionRepo.query({ accountId: cashId })
    expect(byCash.map((t) => t.id)).toEqual([transfer.id])

    const byCard = await transactionRepo.query({ accountId: cardId })
    expect(byCard).toHaveLength(3)

    const byCategory = await transactionRepo.query({ categoryId: expenseCategoryId })
    expect(byCategory).toHaveLength(1)
  })

  it('filters by an inclusive date range in UTC', async () => {
    await transactionRepo.create(
      cashflowPayload({ description: 'a', occurredAt: '2026-08-14T21:30:00.000Z' }),
    )
    await transactionRepo.create(
      cashflowPayload({ description: 'b', occurredAt: '2026-08-15T00:00:00.000Z' }),
    )
    await transactionRepo.create(
      cashflowPayload({ description: 'c', occurredAt: '2026-08-15T23:59:59.999Z' }),
    )
    await transactionRepo.create(
      cashflowPayload({ description: 'd', occurredAt: '2026-08-16T00:00:00.000Z' }),
    )

    expect(await transactionRepo.query({ fromDate: '2026-08-15' })).toHaveLength(3)
    expect(await transactionRepo.query({ toDate: '2026-08-14' })).toHaveLength(1)
    expect(
      await transactionRepo.query({ fromDate: '2026-08-15', toDate: '2026-08-15' }),
    ).toHaveLength(2)
    expect(await transactionRepo.query({ fromDate: '2026-08-16' })).toHaveLength(1)
  })

  it('orders by occurredAt DESC with id DESC as the tiebreak', async () => {
    const same = '2026-08-10T12:00:00.000Z'
    const first = await transactionRepo.create(
      cashflowPayload({ description: 'x', occurredAt: same }),
    )
    const second = await transactionRepo.create(
      cashflowPayload({ description: 'y', occurredAt: same }),
    )
    await transactionRepo.create(
      cashflowPayload({ description: 'later', occurredAt: '2026-08-11T12:00:00.000Z' }),
    )
    await transactionRepo.create(
      cashflowPayload({ description: 'earlier', occurredAt: '2026-08-09T12:00:00.000Z' }),
    )

    const all = await transactionRepo.getAll()
    // Newest first, oldest last; between the two same-time records the
    // greater id sorts first.
    const tieOrdered = [first, second].sort((a, b) => (a.id > b.id ? -1 : 1))
    expect(all.map((t) => t.description)).toEqual([
      'later',
      tieOrdered[0].description,
      tieOrdered[1].description,
      'earlier',
    ])
  })

  it('paginates with an opaque offset cursor', async () => {
    for (let i = 0; i < 3; i += 1) {
      await transactionRepo.create(
        cashflowPayload({ description: `t${i}`, occurredAt: `2026-08-1${i}T12:00:00.000Z` }),
      )
    }

    const page1 = await transactionRepo.listPage({ limit: 2 })
    expect(page1.transactions).toHaveLength(2)
    expect(page1.nextCursor).not.toBeNull()

    const page2 = await transactionRepo.listPage({
      limit: 2,
      cursor: page1.nextCursor ?? undefined,
    })
    expect(page2.transactions).toHaveLength(1)
    expect(page2.nextCursor).toBeNull()

    const all = [...page1.transactions, ...page2.transactions]
    expect(all).toHaveLength(3)
  })

  it('excludes deleted transactions from query and getAll', async () => {
    const transaction = await transactionRepo.create(cashflowPayload())
    await transactionRepo.remove(transaction.id)
    expect(await transactionRepo.query({})).toHaveLength(0)
    expect(await transactionRepo.getAll()).toHaveLength(0)
    expect(await transactionRepo.getById(transaction.id)).toBeNull()
  })

  it('tombstones server-confirmed records with a delete operation', async () => {
    const transaction = await transactionRepo.create(cashflowPayload())
    db.update(transactions)
      .set({ serverVersion: 4, version: 4 })
      .where(eq(transactions.id, transaction.id))
      .run()
    db.delete(syncOutbox).run()

    await transactionRepo.remove(transaction.id)

    const row = db.select().from(transactions).where(eq(transactions.id, transaction.id)).get()
    expect(row?.deletedAt).not.toBeNull()
    const ops = db.select().from(syncOutbox).all()
    expect(ops).toHaveLength(1)
    expect(ops[0].op).toBe('delete')
    expect(ops[0].baseVersion).toBe(4)
  })

  it('keeps an in-flight create when deleting before its confirmation', async () => {
    const transaction = await transactionRepo.create(cashflowPayload())
    const [createOp] = db.select().from(syncOutbox).all()
    db.update(syncOutbox)
      .set({ sentAt: new Date().toISOString() })
      .where(eq(syncOutbox.opId, createOp.opId))
      .run()

    await transactionRepo.remove(transaction.id)

    // serverVersion is still 0, but the create may already be applied on the
    // server: the delete goes through the tombstone flow, never the unborn
    // wipe (which would silently drop the delete and resurrect the record).
    const row = db.select().from(transactions).where(eq(transactions.id, transaction.id)).get()
    expect(row?.deletedAt).not.toBeNull()
    const ops = db.select().from(syncOutbox).all()
    expect(ops).toHaveLength(2)
    expect(ops.some((op) => op.opId === createOp.opId)).toBe(true)
    expect(ops.find((op) => op.op === 'delete')).toMatchObject({
      entityId: transaction.id,
      baseVersion: 0,
    })
  })
})

describe('local transaction repository: account-less cashflow', () => {
  it('creates an account-less expense, queues a valid upsert, and matches queries', async () => {
    const transaction = (await transactionRepo.create(
      cashflowPayload({ accountId: null, description: 'Из старой таблицы' }),
    )) as CashflowTransaction
    expect(transaction.accountId).toBeNull()
    expect(transaction.categoryId).toBe(expenseCategoryId)

    const row = db.select().from(transactions).where(eq(transactions.id, transaction.id)).get()
    expect(row?.accountId).toBeNull()

    const [op] = db.select().from(syncOutbox).all()
    expect(op.op).toBe('upsert')
    expect(JSON.parse(op.payloadJson).accountId).toBeNull()

    const found = await transactionRepo.query({ type: 'expense' })
    expect(found).toHaveLength(1)
  })

  it('still requires a category for account-less cashflow', async () => {
    const error = await transactionRepo
      .create(cashflowPayload({ accountId: null, categoryId: null }))
      .catch((e) => e)
    expect(error).toBeInstanceOf(UnknownReferencesError)
    expect((error as UnknownReferencesError).apiCode).toBe('CATEGORY_NOT_FOUND')
  })

  it('update assigns an account to an account-less expense and back', async () => {
    const created = await transactionRepo.create(cashflowPayload({ accountId: null }))

    const assigned = (await transactionRepo.update(created.id, {
      version: created.version,
      accountId: cardId,
    })) as CashflowTransaction
    expect(assigned.accountId).toBe(cardId)

    const cleared = (await transactionRepo.update(assigned.id, {
      version: assigned.version,
      accountId: null,
    })) as CashflowTransaction
    expect(cleared.accountId).toBeNull()

    const [op] = db
      .select()
      .from(syncOutbox)
      .where(eq(syncOutbox.entityId, cleared.id))
      .all()
    expect(JSON.parse(op.payloadJson).accountId).toBeNull()
  })
})
