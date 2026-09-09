// Domain rules and error semantics of the local category repository,
// mirroring the backend: unique names per user, in-use deletion guard,
// tombstones, and atomic mutation+outbox writes.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import {
  AlreadyExistsError,
  InvalidPayloadError,
  ReferentialIntegrityError,
} from '@trata/api'
import * as outboxModule from '../outbox'
import { createTestDatabase } from '../testing/test-database'
import { categories, syncOutbox } from '../schema'
import type { LocalDatabase } from '../types'
import { createLocalCategoryRepository } from './category'

const PAYLOAD = { name: 'Такси', type: 'expense' as const, icon: 'car', color: '#7c5cff' }

let db: LocalDatabase

beforeEach(async () => {
  db = await createTestDatabase()
})

/** Seeds an account so transactions can reference it. */
function seedAccount() {
  db.run(sql`insert into accounts (id, name, currency, opening_balance, version, server_version, deleted_at, created_at)
    values ('acc-1', 'Карта', 'RUB', 0, 1, 0, null, '2026-01-01T00:00:00.000Z')`)
}

describe('local category repository', () => {
  it('starts empty (no seeds) and creates a category with a client UUID v4', async () => {
    const repo = createLocalCategoryRepository(db)
    expect(await repo.getAll()).toEqual([])

    const category = await repo.create(PAYLOAD)
    expect(category.name).toBe('Такси')
    expect(category.type).toBe('expense')
    expect(category).not.toHaveProperty('slug')
    expect(category.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
  })

  it('honors a client-supplied id', async () => {
    const repo = createLocalCategoryRepository(db)
    const category = await repo.create({ ...PAYLOAD, id: 'client-id-1' })
    expect(category.id).toBe('client-id-1')
  })

  it('rejects a duplicate name with the already-exists code (create and rename)', async () => {
    const repo = createLocalCategoryRepository(db)
    await repo.create(PAYLOAD)

    const duplicate = await repo.create({ ...PAYLOAD, type: 'income' }).catch((error) => error)
    expect(duplicate).toBeInstanceOf(AlreadyExistsError)
    expect((duplicate as AlreadyExistsError).code).toBe('already-exists')
    expect((duplicate as AlreadyExistsError).apiCode).toBe('CATEGORY_ALREADY_EXISTS')

    const other = await repo.create({ ...PAYLOAD, name: 'Зарплата', type: 'income' })
    const renamed = await repo
      .update(other.id, { name: 'Такси', version: other.version })
      .catch((error) => error)
    expect(renamed).toBeInstanceOf(AlreadyExistsError)
  })

  it('rejects an empty name and invalid type with invalid-payload', async () => {
    const repo = createLocalCategoryRepository(db)
    await expect(repo.create({ ...PAYLOAD, name: '   ' })).rejects.toMatchObject({
      code: 'invalid-payload',
    })
    await expect(repo.create({ ...PAYLOAD, type: 'nonsense' as 'expense' })).rejects.toBeInstanceOf(
      InvalidPayloadError,
    )
  })

  it('guards in-use deletes with the category-in-use code', async () => {
    const repo = createLocalCategoryRepository(db)
    const category = await repo.create(PAYLOAD)
    seedAccount()
    db.run(sql`insert into transactions (id, type, amount, description, occurred_at, updated_at, account_id, category_id, from_account_id, to_account_id, version, server_version, deleted_at)
      values ('tx-1', 'expense', 100, '', '2026-01-02T00:00:00.000Z', null, 'acc-1', ${category.id}, null, null, 1, 0, null)`)

    const error = await repo.remove(category.id).catch((e) => e)
    expect(error).toBeInstanceOf(ReferentialIntegrityError)
    expect((error as ReferentialIntegrityError).code).toBe('has-references')
    expect((error as ReferentialIntegrityError).apiCode).toBe('CATEGORY_IN_USE')

    // After the referencing transaction is gone, the category is deletable.
    db.run(sql`delete from transactions where id = 'tx-1'`)
    await repo.remove(category.id)
    expect(await repo.getById(category.id)).toBeNull()
  })

  it('rejects mutations of a locally deleted record with not-found and queues nothing', async () => {
    const repo = createLocalCategoryRepository(db)
    const category = await repo.create(PAYLOAD)
    await repo.remove(category.id)

    await expect(repo.update(category.id, { name: 'X', version: 1 })).rejects.toMatchObject({
      code: 'not-found',
    })
    await expect(repo.remove(category.id)).rejects.toMatchObject({ code: 'not-found' })
    expect(db.select().from(syncOutbox).all()).toHaveLength(0)
  })

  it('tombstones server-confirmed records on delete and frees the name', async () => {
    const repo = createLocalCategoryRepository(db)
    const category = await repo.create(PAYLOAD)
    // Simulate a server-confirmed record.
    db.update(categories)
      .set({ serverVersion: 3, version: 3 })
      .where(eq(categories.id, category.id))
      .run()
    db.delete(syncOutbox).run()

    await repo.remove(category.id)

    const row = db.select().from(categories).where(eq(categories.id, category.id)).get()
    expect(row?.deletedAt).not.toBeNull()
    const ops = db.select().from(syncOutbox).all()
    expect(ops).toHaveLength(1)
    expect(ops[0].op).toBe('delete')
    expect(ops[0].baseVersion).toBe(3)

    expect(await repo.getById(category.id)).toBeNull()
    // The tombstone does not block the name for a new category.
    const recreated = await repo.create(PAYLOAD)
    expect(recreated.id).not.toBe(category.id)
  })

  it('applies updates and bumps the local revision, keeping the record dirty', async () => {
    const repo = createLocalCategoryRepository(db)
    const category = await repo.create(PAYLOAD)

    const updated = await repo.update(category.id, {
      name: 'Транспорт',
      icon: 'bus',
      version: category.version,
    })
    expect(updated.name).toBe('Транспорт')
    expect(updated.icon).toBe('bus')
    expect(updated.type).toBe('expense')

    const row = db.select().from(categories).where(eq(categories.id, category.id)).get()
    expect(row?.version).toBe(2)
    expect(row?.serverVersion).toBe(0)
    expect(db.select().from(syncOutbox).all()).toHaveLength(2)
  })

  it('rejects an empty update with invalid-payload', async () => {
    const repo = createLocalCategoryRepository(db)
    const category = await repo.create(PAYLOAD)
    await expect(repo.update(category.id, { version: 1 })).rejects.toBeInstanceOf(
      InvalidPayloadError,
    )
  })

  it('rolls back both the record change and the queued operation when the outbox write dies', async () => {
    const repo = createLocalCategoryRepository(db)
    const spy = vi.spyOn(outboxModule, 'enqueueOperation').mockImplementation(() => {
      throw new Error('killed before the sync operation was durably recorded')
    })

    await expect(repo.create(PAYLOAD)).rejects.toThrow('killed')
    spy.mockRestore()

    // Neither the record change nor the queued operation exists.
    expect(await repo.getAll()).toEqual([])
    expect(db.select().from(syncOutbox).all()).toHaveLength(0)
  })
})
