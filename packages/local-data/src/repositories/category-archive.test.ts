// Archive + cascade delete semantics of the local category repository
// (category-management change): archivedAt rides the update path and the
// outbox payload, the listing defaults to active-only, archiving is blocked
// by live planned payments, and a cascade delete tombstones the category
// with its referencing transactions in one transaction behind a single
// flagged delete operation.

import { beforeEach, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { InvalidPayloadError, ReferentialIntegrityError } from '@trata/api'
import { createTestDatabase } from '../testing/test-database'
import { categories, syncOutbox, transactions } from '../schema'
import type { LocalDatabase } from '../types'
import { createLocalCategoryRepository } from './category'

const PAYLOAD = { name: 'Продукты', type: 'expense' as const, icon: 'cart', color: '#7c5cff' }

let db: LocalDatabase

beforeEach(async () => {
  db = await createTestDatabase()
})

function seedAccount() {
  db.run(sql`insert into accounts (id, name, currency, opening_balance, version, server_version, deleted_at, created_at)
    values ('acc-1', 'Карта', 'RUB', 0, 1, 0, null, '2026-01-01T00:00:00.000Z')`)
}

function seedTransaction(id: string, categoryId: string, serverVersion = 0) {
  db.run(sql`insert into transactions (id, type, amount, description, occurred_at, updated_at, account_id, category_id, from_account_id, to_account_id, version, server_version, deleted_at)
    values (${id}, 'expense', 100, '', '2026-01-02T00:00:00.000Z', null, 'acc-1', ${categoryId}, null, null, 1, ${serverVersion}, null)`)
}

/** Marks the category as server-confirmed and clears the queued create op. */
function confirmOnServer(id: string) {
  db.update(categories).set({ serverVersion: 1, version: 1 }).where(eq(categories.id, id)).run()
  db.delete(syncOutbox).run()
}

describe('local category archive', () => {
  it('archives and unarchives via update, riding the outbox payload', async () => {
    const repo = createLocalCategoryRepository(db)
    const category = await repo.create(PAYLOAD)

    const archived = await repo.update(category.id, { version: 1, archived: true })
    expect(archived.archivedAt).not.toBeNull()

    // Active-only listing hides it; the including-archived one shows it.
    expect(await repo.getAll()).toHaveLength(0)
    expect(await repo.getAllIncludingArchived()).toHaveLength(1)

    // The queued upsert carries the archive state for the server.
    const ops = db.select().from(syncOutbox).all()
    expect(ops.at(-1)?.op).toBe('upsert')
    expect(ops.at(-1)?.payloadJson).toContain('archivedAt')

    const active = await repo.update(category.id, { version: 2, archived: false })
    expect(active.archivedAt).toBeNull()
    expect(await repo.getAll()).toHaveLength(1)
  })

  it('rejects archiving while a live planned payment references the category', async () => {
    const repo = createLocalCategoryRepository(db)
    const category = await repo.create(PAYLOAD)
    seedAccount()
    db.run(sql`insert into planned_payments (id, type, amount, name, account_id, category_id, next_due, anchor_date, regularity, confirm_mode, reminder, note, version, server_version, deleted_at, created_at)
      values ('plan-1', 'expense', 500, 'Net', 'acc-1', ${category.id}, '2026-10-01', '2026-09-01', 'monthly', 'manual', 'off', '', 1, 0, null, '2026-01-01T00:00:00.000Z')`)

    const error = await repo.update(category.id, { version: 1, archived: true }).catch((e) => e)
    expect(error).toBeInstanceOf(ReferentialIntegrityError)
    expect((error as ReferentialIntegrityError).apiCode).toBe('CATEGORY_IN_USE')
  })

  it('keeps an archived category readable by id and editable', async () => {
    const repo = createLocalCategoryRepository(db)
    const category = await repo.create(PAYLOAD)
    await repo.update(category.id, { version: 1, archived: true })

    const fetched = await repo.getById(category.id)
    expect(fetched?.archivedAt).not.toBeNull()

    const renamed = await repo.update(category.id, { version: 2, name: 'Продукты (архив)' })
    expect(renamed.name).toBe('Продукты (архив)')
  })

  it('rejects an update that changes nothing', async () => {
    const repo = createLocalCategoryRepository(db)
    const category = await repo.create(PAYLOAD)
    const error = await repo.update(category.id, { version: 1 }).catch((e) => e)
    expect(error).toBeInstanceOf(InvalidPayloadError)
  })
})

describe('local category cascade delete', () => {
  it('tombstones the category and its transactions atomically behind one flagged op', async () => {
    const repo = createLocalCategoryRepository(db)
    const category = await repo.create(PAYLOAD)
    seedAccount()
    seedTransaction('tx-1', category.id)
    confirmOnServer(category.id)

    await repo.remove(category.id, { cascade: true })

    const row = db.select().from(categories).where(eq(categories.id, category.id)).get()
    expect(row?.deletedAt).not.toBeNull()

    const txRow = db.select().from(transactions).where(eq(transactions.id, 'tx-1')).get()
    expect(txRow?.deletedAt).not.toBeNull()

    // Exactly one delete operation, carrying the cascade flag.
    const ops = db.select().from(syncOutbox).all()
    expect(ops).toHaveLength(1)
    expect(ops[0].op).toBe('delete')
    expect(ops[0].payloadJson).toContain('cascade')
  })

  it('still guards a plain delete and still blocks on live planned payments', async () => {
    const repo = createLocalCategoryRepository(db)
    const category = await repo.create(PAYLOAD)
    seedAccount()
    seedTransaction('tx-1', category.id)
    confirmOnServer(category.id)

    const guarded = await repo.remove(category.id).catch((e) => e)
    expect(guarded).toBeInstanceOf(ReferentialIntegrityError)
    expect((guarded as ReferentialIntegrityError).apiCode).toBe('CATEGORY_IN_USE')

    db.run(sql`insert into planned_payments (id, type, amount, name, account_id, category_id, next_due, anchor_date, regularity, confirm_mode, reminder, note, version, server_version, deleted_at, created_at)
      values ('plan-1', 'expense', 500, 'Net', 'acc-1', ${category.id}, '2026-10-01', '2026-09-01', 'monthly', 'manual', 'off', '', 1, 0, null, '2026-01-01T00:00:00.000Z')`)
    const blocked = await repo.remove(category.id, { cascade: true }).catch((e) => e)
    expect(blocked).toBeInstanceOf(ReferentialIntegrityError)
    expect((blocked as ReferentialIntegrityError).apiCode).toBe('CATEGORY_IN_USE')
  })

  it('wipes unborn records without queueing anything', async () => {
    const repo = createLocalCategoryRepository(db)
    const category = await repo.create(PAYLOAD)
    seedAccount()
    seedTransaction('tx-unborn', category.id)

    await repo.remove(category.id, { cascade: true })

    expect(db.select().from(categories).where(eq(categories.id, category.id)).get()).toBeUndefined()
    expect(db.select().from(transactions).where(eq(transactions.id, 'tx-unborn')).get()).toBeUndefined()
    expect(db.select().from(syncOutbox).all()).toHaveLength(0)
  })
})
