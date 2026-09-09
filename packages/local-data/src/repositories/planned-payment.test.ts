// Domain rules and error semantics of the local planned-payment repository,
// mirroring the backend: positive amounts, live account + live type-matched
// category references, NO name-uniqueness rules, version CAS, anchor reset on
// next-due edits, the manual-confirm composite's atomicity, and tombstone
// deletes — every mutation writing row + outbox in one transaction.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import {
  InvalidPayloadError,
  NotFoundError,
  ReferentialIntegrityError,
  UnknownReferencesError,
  VersionConflictError,
} from '@trata/api'
import * as outboxModule from '../outbox'
import { createTestDatabase } from '../testing/test-database'
import { accounts, plannedPayments, syncOutbox, transactions } from '../schema'
import type { LocalDatabase } from '../types'
import { createLocalAccountRepository } from '../repositories/account'
import { createLocalCategoryRepository } from '../repositories/category'
import { createLocalPlannedPaymentRepository } from './planned-payment'

let db: LocalDatabase

const ACCOUNT = { name: 'Карта', currency: 'RUB' as const, openingBalance: 0 }
const EXPENSE_CATEGORY = {
  name: 'Развлечения',
  type: 'expense' as const,
  icon: 'car',
  color: '#7c5cff',
}
const INCOME_CATEGORY = {
  name: 'Зарплата',
  type: 'income' as const,
  icon: 'cash',
  color: '#22c55e',
}

interface Seed {
  accountId: string
  categoryId: string
  incomeCategoryId: string
}

async function seed(): Promise<Seed> {
  const account = await createLocalAccountRepository(db).create(ACCOUNT)
  const categoryRepo = createLocalCategoryRepository(db)
  const category = await categoryRepo.create(EXPENSE_CATEGORY)
  const incomeCategory = await categoryRepo.create(INCOME_CATEGORY)
  return { accountId: account.id, categoryId: category.id, incomeCategoryId: incomeCategory.id }
}

function planPayload(seed: Seed) {
  return {
    type: 'expense' as const,
    amount: 599_00,
    name: 'Netflix',
    accountId: seed.accountId,
    categoryId: seed.categoryId,
    nextDue: '2026-09-05',
    regularity: 'monthly' as const,
    confirmMode: 'manual' as const,
    reminder: 'day_before' as const,
    note: '',
  }
}

beforeEach(async () => {
  db = await createTestDatabase()
})

/** Outbox operations of one entity kind (the seed's account/category ops aside). */
function outboxOps(entity: 'planned_payment' | 'transaction') {
  return db.select().from(syncOutbox).where(eq(syncOutbox.entity, entity)).all()
}

describe('local planned-payment repository: create', () => {
  it('creates a plan whose anchor is the initial next-due and queues a base-0 upsert', async () => {
    const repo = createLocalPlannedPaymentRepository(db)
    const s = await seed()
    const plan = await repo.create(planPayload(s))

    expect(plan).toMatchObject({
      name: 'Netflix',
      amount: 599_00,
      version: 1,
      anchorDate: '2026-09-05',
    })
    expect(plan.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)

    const ops = outboxOps('planned_payment')
    expect(ops).toHaveLength(1)
    expect(ops[0]).toMatchObject({
      entity: 'planned_payment',
      entityId: plan.id,
      op: 'upsert',
      baseVersion: 0,
    })
    expect(JSON.parse(ops[0].payloadJson)).toMatchObject({
      type: 'expense',
      amount: 599_00,
      nextDue: '2026-09-05',
      anchorDate: '2026-09-05',
      regularity: 'monthly',
      confirmMode: 'manual',
      reminder: 'day_before',
    })
  })

  it('allows duplicate names (no uniqueness rule)', async () => {
    const repo = createLocalPlannedPaymentRepository(db)
    const s = await seed()
    await repo.create(planPayload(s))
    const second = await repo.create(planPayload(s))
    expect(second.name).toBe('Netflix')
    expect(await repo.getAll()).toHaveLength(2)
  })

  it('rejects a non-positive amount', async () => {
    const repo = createLocalPlannedPaymentRepository(db)
    const s = await seed()
    await expect(repo.create({ ...planPayload(s), amount: 0 })).rejects.toBeInstanceOf(
      InvalidPayloadError,
    )
    await expect(repo.create({ ...planPayload(s), amount: -100 })).rejects.toBeInstanceOf(
      InvalidPayloadError,
    )
  })

  it('rejects a missing/tombstoned account with PLANNED_PAYMENT_ACCOUNT_NOT_FOUND', async () => {
    const repo = createLocalPlannedPaymentRepository(db)
    const s = await seed()
    const missing = await repo
      .create({ ...planPayload(s), accountId: '11111111-1111-4111-8111-111111111111' })
      .catch((error) => error)
    expect(missing).toBeInstanceOf(UnknownReferencesError)
    expect((missing as UnknownReferencesError).apiCode).toBe('PLANNED_PAYMENT_ACCOUNT_NOT_FOUND')

    // Tombstoning the account (via direct row update, bypassing the in-use
    // guard) makes the reference dead as well.
    const accountRepo = createLocalAccountRepository(db)
    const fresh = await accountRepo.create(ACCOUNT)
    db.update(accounts)
      .set({ deletedAt: '2026-08-24T00:00:00.000Z' })
      .where(eq(accounts.id, fresh.id))
      .run()
    const dead = await repo.create({ ...planPayload(s), accountId: fresh.id }).catch((e) => e)
    expect(dead).toBeInstanceOf(UnknownReferencesError)
    expect((dead as UnknownReferencesError).apiCode).toBe('PLANNED_PAYMENT_ACCOUNT_NOT_FOUND')
  })

  it('rejects a missing or type-mismatched category with PLANNED_PAYMENT_CATEGORY_NOT_FOUND', async () => {
    const repo = createLocalPlannedPaymentRepository(db)
    const s = await seed()

    const missing = await repo
      .create({ ...planPayload(s), categoryId: '11111111-1111-4111-8111-111111111111' })
      .catch((error) => error)
    expect(missing).toBeInstanceOf(UnknownReferencesError)
    expect((missing as UnknownReferencesError).apiCode).toBe('PLANNED_PAYMENT_CATEGORY_NOT_FOUND')

    const mismatched = await repo
      .create({ ...planPayload(s), categoryId: s.incomeCategoryId })
      .catch((error) => error)
    expect(mismatched).toBeInstanceOf(UnknownReferencesError)
    expect((mismatched as UnknownReferencesError).apiCode).toBe(
      'PLANNED_PAYMENT_CATEGORY_NOT_FOUND',
    )
  })

  it('accepts a past next-due date (the plan starts out overdue)', async () => {
    const repo = createLocalPlannedPaymentRepository(db)
    const s = await seed()
    const plan = await repo.create({ ...planPayload(s), nextDue: '2020-01-01' })
    expect(plan.nextDue).toBe('2020-01-01')
  })
})

describe('local planned-payment repository: update', () => {
  it('resets the anchor when next-due changes and keeps it otherwise', async () => {
    const repo = createLocalPlannedPaymentRepository(db)
    const s = await seed()
    const plan = await repo.create(planPayload(s))

    const renamed = await repo.update(plan.id, { name: 'Netflix Premium', version: 1 })
    expect(renamed.anchorDate).toBe('2026-09-05')

    const moved = await repo.update(plan.id, { nextDue: '2026-10-20', version: renamed.version })
    expect(moved.anchorDate).toBe('2026-10-20')
    expect(moved.nextDue).toBe('2026-10-20')
  })

  it('keeps an absent name/note, clears with an empty string, rejects a no-op', async () => {
    const repo = createLocalPlannedPaymentRepository(db)
    const s = await seed()
    const plan = await repo.create({ ...planPayload(s), note: 'заметка' })

    const kept = await repo.update(plan.id, { amount: 699_00, version: 1 })
    expect(kept.note).toBe('заметка')
    expect(kept.name).toBe('Netflix')

    const cleared = await repo.update(plan.id, { note: '', name: '', version: kept.version })
    expect(cleared.note).toBe('')
    expect(cleared.name).toBe('')

    await expect(repo.update(plan.id, { version: cleared.version })).rejects.toBeInstanceOf(
      InvalidPayloadError,
    )
  })

  it('rejects a version-mismatched update with PLANNED_PAYMENT_VERSION_CONFLICT', async () => {
    const repo = createLocalPlannedPaymentRepository(db)
    const s = await seed()
    const plan = await repo.create(planPayload(s))
    const error = await repo.update(plan.id, { amount: 100, version: 99 }).catch((e) => e)
    expect(error).toBeInstanceOf(VersionConflictError)
    expect((error as VersionConflictError).apiCode).toBe('PLANNED_PAYMENT_VERSION_CONFLICT')
  })

  it('rejects a re-point to a type-mismatched category', async () => {
    const repo = createLocalPlannedPaymentRepository(db)
    const s = await seed()
    const plan = await repo.create(planPayload(s))
    const error = await repo
      .update(plan.id, { categoryId: s.incomeCategoryId, version: 1 })
      .catch((e) => e)
    expect(error).toBeInstanceOf(UnknownReferencesError)
    expect((error as UnknownReferencesError).apiCode).toBe('PLANNED_PAYMENT_CATEGORY_NOT_FOUND')
  })

  it('bumps the version and queues an upsert per mutation', async () => {
    const repo = createLocalPlannedPaymentRepository(db)
    const s = await seed()
    const plan = await repo.create(planPayload(s))
    const updated = await repo.update(plan.id, { amount: 699_00, version: 1 })

    expect(updated.version).toBe(2)
    const ops = outboxOps('planned_payment')
    expect(ops).toHaveLength(2)
    expect(ops[1]).toMatchObject({ entity: 'planned_payment', entityId: plan.id, baseVersion: 0 })
    expect(JSON.parse(ops[1].payloadJson)).toMatchObject({ amount: 699_00 })
  })
})

describe('local planned-payment repository: delete + listing', () => {
  it('wipes an unborn record without outbox traffic; tombstones a published one', async () => {
    const repo = createLocalPlannedPaymentRepository(db)
    const s = await seed()

    const unborn = await repo.create(planPayload(s))
    await repo.remove(unborn.id)
    expect(db.select().from(plannedPayments).all()).toHaveLength(0)
    expect(outboxOps('planned_payment')).toHaveLength(0)

    const published = await repo.create(planPayload(s))
    // Simulate the server confirmation of the create.
    db.update(plannedPayments)
      .set({ serverVersion: 1, version: 1 })
      .where(eq(plannedPayments.id, published.id))
      .run()
    db.delete(syncOutbox).run()

    await repo.remove(published.id)
    const row = db.select().from(plannedPayments).where(eq(plannedPayments.id, published.id)).get()
    expect(row?.deletedAt).not.toBeNull()
    expect(row?.version).toBe(2)
    const ops = outboxOps('planned_payment')
    expect(ops).toHaveLength(1)
    expect(ops[0]).toMatchObject({ entity: 'planned_payment', op: 'delete', baseVersion: 1 })

    await expect(repo.remove(published.id)).rejects.toBeInstanceOf(NotFoundError)
    expect(await repo.getAll()).toHaveLength(0)
  })

  it('filters the listing by type', async () => {
    const repo = createLocalPlannedPaymentRepository(db)
    const s = await seed()
    await repo.create(planPayload(s))
    await repo.create({ ...planPayload(s), type: 'income', categoryId: s.incomeCategoryId })

    expect(await repo.getAll()).toHaveLength(2)
    const expenses = await repo.query({ type: 'expense' })
    expect(expenses).toHaveLength(1)
    expect(expenses[0].type).toBe('expense')
    expect(await repo.query({ type: 'income' })).toHaveLength(1)
  })
})

describe('manual confirmation composite (design D6)', () => {
  it('creates the transaction and advances the plan in one atomic transaction', async () => {
    const repo = createLocalPlannedPaymentRepository(db)
    const s = await seed()
    const plan = await repo.create({ ...planPayload(s), nextDue: '2026-01-31' })

    await repo.confirmPlannedPayment({
      planId: plan.id,
      amount: 650_00,
      occurredAt: '2026-01-31T18:30:00.000Z',
    })

    // One transaction row from the plan's type/account/category with the
    // edited amount and the plan's name as the note.
    const transactionRows = db.select().from(transactions).all()
    expect(transactionRows).toHaveLength(1)
    expect(transactionRows[0]).toMatchObject({
      type: 'expense',
      amount: 650_00,
      description: 'Netflix',
      occurredAt: '2026-01-31T18:30:00.000Z',
      accountId: s.accountId,
      categoryId: s.categoryId,
      version: 1,
      serverVersion: 0,
    })

    // The plan advanced exactly one period (clamped month end, anchor intact).
    const planRow = db.select().from(plannedPayments).where(eq(plannedPayments.id, plan.id)).get()
    expect(planRow).toMatchObject({ nextDue: '2026-02-28', anchorDate: '2026-01-31', version: 2 })

    // Two outbox operations: the transaction create (base 0) and the plan
    // upsert (CAS on the server version).
    expect(outboxOps('transaction')).toHaveLength(1)
    const planOps = outboxOps('planned_payment')
    expect(planOps).toHaveLength(2) // plan create + the advancement
    expect(planOps[1]).toMatchObject({ op: 'upsert', baseVersion: 0 })
    expect(JSON.parse(planOps[1].payloadJson)).toMatchObject({ nextDue: '2026-02-28', version: 2 })
  })

  it('defaults the amount to the plan, the date to the occurrence at 12:00 UTC, the note to the name', async () => {
    const repo = createLocalPlannedPaymentRepository(db)
    const s = await seed()
    const plan = await repo.create({ ...planPayload(s), name: '', nextDue: '2026-09-05' })

    await repo.confirmPlannedPayment({ planId: plan.id })

    const transactionRows = db.select().from(transactions).all()
    expect(transactionRows[0]).toMatchObject({
      amount: 599_00,
      description: '',
      occurredAt: '2026-09-05T12:00:00.000Z',
    })
  })

  it('rolls the transaction insert back when the plan update dies mid-composite', async () => {
    const repo = createLocalPlannedPaymentRepository(db)
    const s = await seed()
    const plan = await repo.create(planPayload(s))

    // Kill the composite's plan-side outbox write (the step AFTER the
    // transaction insert + its operation): the whole db transaction must
    // roll back, taking the inserted transaction row with it.
    const originalEnqueue = outboxModule.enqueueOperation
    const spy = vi.spyOn(outboxModule, 'enqueueOperation').mockImplementation((tx, input) => {
      if (input.entity === 'planned_payment') {
        throw new Error('killed before the plan advancement was durably recorded')
      }
      return originalEnqueue(tx, input)
    })

    await expect(repo.confirmPlannedPayment({ planId: plan.id })).rejects.toThrow('killed')
    spy.mockRestore()

    expect(db.select().from(transactions).all()).toHaveLength(0)
    const planRow = db.select().from(plannedPayments).where(eq(plannedPayments.id, plan.id)).get()
    expect(planRow?.nextDue).toBe('2026-09-05')
    expect(planRow?.version).toBe(1)
    expect(outboxOps('planned_payment')).toHaveLength(1) // only the create
    expect(outboxOps('transaction')).toHaveLength(0)
  })

  it('rolls back the plan row and the queued operation when the outbox write dies', async () => {
    const repo = createLocalPlannedPaymentRepository(db)
    const s = await seed()
    const spy = vi.spyOn(outboxModule, 'enqueueOperation').mockImplementation(() => {
      throw new Error('killed before the sync operation was durably recorded')
    })

    await expect(repo.create(planPayload(s))).rejects.toThrow('killed')
    spy.mockRestore()

    expect(await repo.getAll()).toEqual([])
    expect(outboxOps('planned_payment')).toHaveLength(0)
  })

  it('rejects confirming a missing or deleted plan with not-found', async () => {
    const repo = createLocalPlannedPaymentRepository(db)
    const error = await repo
      .confirmPlannedPayment({ planId: '11111111-1111-4111-8111-111111111111' })
      .catch((e) => e)
    expect(error).toBeInstanceOf(NotFoundError)
  })
})

describe('account/category delete guards count live plans (D4 mirror)', () => {
  it('blocks account and category deletion while a live plan references them', async () => {
    const accountRepo = createLocalAccountRepository(db)
    const categoryRepo = createLocalCategoryRepository(db)
    const planRepo = createLocalPlannedPaymentRepository(db)
    const s = await seed()
    await planRepo.create(planPayload(s))

    const accountError = await accountRepo.remove(s.accountId).catch((e) => e)
    expect(accountError).toBeInstanceOf(ReferentialIntegrityError)
    expect((accountError as ReferentialIntegrityError).apiCode).toBe('ACCOUNT_IN_USE')

    const categoryError = await categoryRepo.remove(s.categoryId).catch((e) => e)
    expect(categoryError).toBeInstanceOf(ReferentialIntegrityError)
    expect((categoryError as ReferentialIntegrityError).apiCode).toBe('CATEGORY_IN_USE')
  })

  it('allows deletion once the plan is tombstoned (live-only guard)', async () => {
    const accountRepo = createLocalAccountRepository(db)
    const categoryRepo = createLocalCategoryRepository(db)
    const planRepo = createLocalPlannedPaymentRepository(db)
    const s = await seed()
    const plan = await planRepo.create(planPayload(s))
    // Publish the plan so the delete tombstones instead of wiping.
    db.update(plannedPayments)
      .set({ serverVersion: 1, version: 1 })
      .where(eq(plannedPayments.id, plan.id))
      .run()
    db.delete(syncOutbox).run()
    await planRepo.remove(plan.id)

    await expect(accountRepo.remove(s.accountId)).resolves.toBeUndefined()
    await expect(categoryRepo.remove(s.categoryId)).resolves.toBeUndefined()
  })
})
