// Domain rules of the local account repository: computed balances (opening
// + manual adjustment + signed transaction impacts), in-use deletion guard,
// validation, and the outbox/version rules shared with the other entities.

import { beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { InvalidPayloadError, NotFoundError, ReferentialIntegrityError } from '@trata/api'
import { createLocalTransactionRepository } from '../repositories/transaction'
import { createLocalCategoryRepository } from '../repositories/category'
import { createTestDatabase } from '../testing/test-database'
import { accounts, syncOutbox } from '../schema'
import type { LocalDatabase } from '../types'
import { createLocalAccountRepository } from './account'

let db: LocalDatabase
let accountRepo: ReturnType<typeof createLocalAccountRepository>
let categoryRepo: ReturnType<typeof createLocalCategoryRepository>
let transactionRepo: ReturnType<typeof createLocalTransactionRepository>

beforeEach(async () => {
  db = await createTestDatabase()
  accountRepo = createLocalAccountRepository(db)
  categoryRepo = createLocalCategoryRepository(db)
  transactionRepo = createLocalTransactionRepository(db)
})

const OCCURRED_AT = '2026-08-10T12:00:00.000Z'

describe('local account repository', () => {
  it('creates an account with the opening balance', async () => {
    const account = await accountRepo.create({
      name: 'Карта',
      currency: 'RUB',
      openingBalance: 150_000,
    })
    expect(account).toMatchObject({
      name: 'Карта',
      currency: 'RUB',
      openingBalance: 150_000,
      balance: 150_000,
    })
    const ops = db.select().from(syncOutbox).all()
    expect(ops).toHaveLength(1)
    expect(ops[0].entity).toBe('account')
  })

  it('rejects invalid payloads with invalid-payload', async () => {
    await expect(
      accountRepo.create({ name: '  ', currency: 'RUB', openingBalance: 0 }),
    ).rejects.toBeInstanceOf(InvalidPayloadError)
    await expect(
      accountRepo.create({ name: 'X', currency: 'GBP' as 'RUB', openingBalance: 0 }),
    ).rejects.toBeInstanceOf(InvalidPayloadError)
    await expect(
      accountRepo.create({ name: 'X', currency: 'RUB', openingBalance: 10.5 }),
    ).rejects.toBeInstanceOf(InvalidPayloadError)
  })

  it('computes balances from opening + manual + signed impacts (incl. transfers)', async () => {
    const card = await accountRepo.create({
      name: 'Карта',
      currency: 'RUB',
      openingBalance: 100_000,
    })
    const cash = await accountRepo.create({ name: 'Наличные', currency: 'RUB', openingBalance: 0 })
    const salary = await categoryRepo.create({
      name: 'Зарплата',
      type: 'income',
      icon: 'cash',
      color: '#16a34a',
    })
    const cafe = await categoryRepo.create({
      name: 'Кафе',
      type: 'expense',
      icon: 'cafe',
      color: '#a78bfa',
    })

    await transactionRepo.create({
      type: 'income',
      amount: 30_000,
      description: '',
      occurredAt: OCCURRED_AT,
      accountId: card.id,
      categoryId: salary.id,
    })
    await transactionRepo.create({
      type: 'expense',
      amount: 10_000,
      description: '',
      occurredAt: OCCURRED_AT,
      accountId: card.id,
      categoryId: cafe.id,
    })
    await transactionRepo.create({
      type: 'transfer',
      amount: 5_000,
      description: '',
      occurredAt: OCCURRED_AT,
      fromAccountId: card.id,
      toAccountId: cash.id,
    })

    const balances = new Map((await accountRepo.getAll()).map((a) => [a.id, a.balance]))
    expect(balances.get(card.id)).toBe(115_000) // 100k + 30k - 10k - 5k
    expect(balances.get(cash.id)).toBe(5_000)

    // An adjustment transaction shifts the balance by its signed amount.
    const adjustment = await transactionRepo.create({
      type: 'adjustment',
      amount: 2_500,
      description: 'сверка',
      occurredAt: OCCURRED_AT,
      accountId: card.id,
    })
    const afterAdjustment = await accountRepo.getById(card.id)
    expect(afterAdjustment?.balance).toBe(117_500)

    // Rename keeps the balance.
    const renamed = await accountRepo.update(card.id, {
      name: 'Карта Про',
      version: card.version,
    })
    expect(renamed.balance).toBe(117_500)
  })

  it('excludes deleted transactions from balances', async () => {
    const account = await accountRepo.create({
      name: 'Карта',
      currency: 'RUB',
      openingBalance: 1_000,
    })
    const category = await categoryRepo.create({
      name: 'Кафе',
      type: 'expense',
      icon: 'cafe',
      color: '#a78bfa',
    })
    const transaction = await transactionRepo.create({
      type: 'expense',
      amount: 400,
      description: '',
      occurredAt: OCCURRED_AT,
      accountId: account.id,
      categoryId: category.id,
    })
    expect((await accountRepo.getById(account.id))?.balance).toBe(600)

    await transactionRepo.remove(transaction.id)
    expect((await accountRepo.getById(account.id))?.balance).toBe(1_000)
  })

  it('guards deletes with the account-in-use code (any reference side)', async () => {
    const card = await accountRepo.create({ name: 'Карта', currency: 'RUB', openingBalance: 0 })
    const cash = await accountRepo.create({ name: 'Наличные', currency: 'RUB', openingBalance: 0 })

    const transfer = await transactionRepo.create({
      type: 'transfer',
      amount: 500,
      description: '',
      occurredAt: OCCURRED_AT,
      fromAccountId: card.id,
      toAccountId: cash.id,
    })

    const error = await accountRepo.remove(cash.id).catch((e) => e)
    expect(error).toBeInstanceOf(ReferentialIntegrityError)
    expect((error as ReferentialIntegrityError).apiCode).toBe('ACCOUNT_IN_USE')

    await transactionRepo.remove(transfer.id)
    await accountRepo.remove(cash.id)
    expect(await accountRepo.getById(cash.id)).toBeNull()
  })

  it('tombstones confirmed records and rejects later mutations with not-found', async () => {
    const account = await accountRepo.create({ name: 'Карта', currency: 'RUB', openingBalance: 0 })
    db.update(accounts)
      .set({ serverVersion: 2, version: 2 })
      .where(eq(accounts.id, account.id))
      .run()
    db.delete(syncOutbox).run()

    await accountRepo.remove(account.id)
    const row = db.select().from(accounts).where(eq(accounts.id, account.id)).get()
    expect(row?.deletedAt).not.toBeNull()
    expect(db.select().from(syncOutbox).all()).toHaveLength(1)

    await expect(accountRepo.update(account.id, { name: 'X', version: 1 })).rejects.toMatchObject({
      code: 'not-found',
    })
    await expect(accountRepo.remove(account.id)).rejects.toBeInstanceOf(NotFoundError)
  })

  it('keeps an in-flight create when deleting before its confirmation', async () => {
    const account = await accountRepo.create({ name: 'Карта', currency: 'RUB', openingBalance: 0 })
    const [createOp] = db.select().from(syncOutbox).all()
    db.update(syncOutbox)
      .set({ sentAt: new Date().toISOString() })
      .where(eq(syncOutbox.opId, createOp.opId))
      .run()

    await accountRepo.remove(account.id)

    // serverVersion is still 0, but the create may already be applied on the
    // server: the delete goes through the tombstone flow, never the unborn
    // wipe (which would silently drop the delete and resurrect the record).
    const row = db.select().from(accounts).where(eq(accounts.id, account.id)).get()
    expect(row?.deletedAt).not.toBeNull()
    const ops = db.select().from(syncOutbox).all()
    expect(ops).toHaveLength(2)
    expect(ops.some((op) => op.opId === createOp.opId)).toBe(true)
    expect(ops.find((op) => op.op === 'delete')).toMatchObject({
      entityId: account.id,
      baseVersion: 0,
    })
  })

  it('updates the name and bumps the local revision', async () => {
    const account = await accountRepo.create({
      name: 'Карта',
      currency: 'RUB',
      openingBalance: 1_000,
    })
    const updated = await accountRepo.update(account.id, {
      name: 'Новая карта',
      version: account.version,
    })
    expect(updated.name).toBe('Новая карта')
    expect(updated.currency).toBe('RUB')

    const row = db.select().from(accounts).where(eq(accounts.id, account.id)).get()
    expect(row?.version).toBe(2)
    expect(row?.serverVersion).toBe(0)

    await expect(accountRepo.update(account.id, { version: 1 })).rejects.toBeInstanceOf(
      InvalidPayloadError,
    )
  })
})
