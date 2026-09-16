// Domain rules and error semantics of the local debt repositories,
// mirroring the backend: unique live debtor names, debtor references
// validated against live debtors, cascade debtor delete (debtor + live
// operations in one transaction), tombstones, and atomic mutation+outbox
// writes.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CurrencyCode } from '@trata/money'
import { eq } from 'drizzle-orm'
import {
  AlreadyExistsError,
  InvalidPayloadError,
  UnknownReferencesError,
  VersionConflictError,
} from '@trata/api'
import * as outboxModule from '../outbox'
import { createTestDatabase } from '../testing/test-database'
import { debtOperations, debtors, syncOutbox } from '../schema'
import type { LocalDatabase } from '../types'
import {
  createLocalDebtOperationRepository,
  createLocalDebtorRepository,
  cascadeDeleteDebtor,
} from './debt'

const DEBTOR = { name: 'Анна' }
const OPERATION = {
  direction: 'receivable' as const,
  kind: 'debt' as const,
  amount: 500_000,
  occurredAt: '2026-01-02T00:00:00.000Z',
}

let db: LocalDatabase

beforeEach(async () => {
  db = await createTestDatabase()
})

async function seedDebtor(name = 'Анна') {
  return createLocalDebtorRepository(db).create({ name })
}

describe('local debtor repository', () => {
  it('creates a debtor with a client UUID v4 and queues a base-0 upsert', async () => {
    const repo = createLocalDebtorRepository(db)
    const debtor = await repo.create(DEBTOR)
    expect(debtor).toMatchObject({ name: 'Анна', version: 1 })
    expect(debtor.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )

    const ops = db.select().from(syncOutbox).all()
    expect(ops).toHaveLength(1)
    expect(ops[0]).toMatchObject({
      entity: 'debtor',
      entityId: debtor.id,
      op: 'upsert',
      baseVersion: 0,
    })
  })

  it('rejects duplicate live names with DEBTOR_ALREADY_EXISTS (create and rename)', async () => {
    const repo = createLocalDebtorRepository(db)
    await repo.create(DEBTOR)

    const duplicate = await repo.create({ name: 'Анна' }).catch((error) => error)
    expect(duplicate).toBeInstanceOf(AlreadyExistsError)
    expect((duplicate as AlreadyExistsError).apiCode).toBe('DEBTOR_ALREADY_EXISTS')

    const other = await repo.create({ name: 'Сергей' })
    const renamed = await repo
      .update(other.id, { name: 'Анна', version: other.version })
      .catch((error) => error)
    expect(renamed).toBeInstanceOf(AlreadyExistsError)
    expect((renamed as AlreadyExistsError).apiCode).toBe('DEBTOR_ALREADY_EXISTS')
  })

  it('rejects empty names and empty updates', async () => {
    const repo = createLocalDebtorRepository(db)
    await expect(repo.create({ name: '   ' })).rejects.toBeInstanceOf(InvalidPayloadError)

    const debtor = await repo.create(DEBTOR)
    await expect(repo.update(debtor.id, { version: debtor.version })).rejects.toBeInstanceOf(
      InvalidPayloadError,
    )
  })

  it('renames with a version bump; the record carries no note column', async () => {
    const repo = createLocalDebtorRepository(db)
    const debtor = await repo.create(DEBTOR)

    const renamed = await repo.update(debtor.id, { name: 'Анна П.', version: debtor.version })
    expect(renamed.name).toBe('Анна П.')
    expect(renamed.version).toBe(2)

    const row = db.select().from(debtors).where(eq(debtors.id, debtor.id)).get()
    expect(Object.keys(row ?? {})).not.toContain('note')
  })

  it('rejects a same-name rename as a no-op without dirtying the record', async () => {
    const repo = createLocalDebtorRepository(db)
    const debtor = await repo.create(DEBTOR)
    db.delete(syncOutbox).run()

    const error = await repo
      .update(debtor.id, { name: 'Анна', version: debtor.version })
      .catch((error) => error)
    expect(error).toBeInstanceOf(InvalidPayloadError)

    const row = db.select().from(debtors).where(eq(debtors.id, debtor.id)).get()
    expect(row?.version).toBe(1)
    expect(db.select().from(syncOutbox).all()).toHaveLength(0)
  })

  it('rejects a version-mismatched update with DEBTOR_VERSION_CONFLICT', async () => {
    const repo = createLocalDebtorRepository(db)
    const debtor = await repo.create(DEBTOR)
    const error = await repo.update(debtor.id, { name: 'X', version: 99 }).catch((e) => e)
    expect(error).toBeInstanceOf(VersionConflictError)
    expect((error as VersionConflictError).apiCode).toBe('DEBTOR_VERSION_CONFLICT')
  })

  it('cascade-deletes a debtor with live operations: one transaction, one delete per record', async () => {
    const debtorRepo = createLocalDebtorRepository(db)
    const operationRepo = createLocalDebtOperationRepository(db)
    const debtor = await seedDebtor()
    const debt = await operationRepo.create({ ...OPERATION, debtorId: debtor.id })
    const repayment = await operationRepo.create({
      ...OPERATION,
      debtorId: debtor.id,
      kind: 'repayment',
      amount: 100_000,
    })
    // Server-confirmed states the cascade must bump exactly once per record.
    db.update(debtors).set({ serverVersion: 3, version: 3 }).where(eq(debtors.id, debtor.id)).run()
    db.update(debtOperations)
      .set({ serverVersion: 5, version: 5 })
      .where(eq(debtOperations.id, debt.id))
      .run()
    db.update(debtOperations)
      .set({ serverVersion: 7, version: 7 })
      .where(eq(debtOperations.id, repayment.id))
      .run()
    db.delete(syncOutbox).run()

    await debtorRepo.remove(debtor.id)

    expect(db.select().from(debtors).where(eq(debtors.id, debtor.id)).get()).toMatchObject({
      deletedAt: expect.any(String),
      version: 4,
    })
    expect(db.select().from(debtOperations).where(eq(debtOperations.id, debt.id)).get()).toMatchObject(
      { deletedAt: expect.any(String), version: 6 },
    )
    expect(
      db.select().from(debtOperations).where(eq(debtOperations.id, repayment.id)).get(),
    ).toMatchObject({ deletedAt: expect.any(String), version: 8 })

    const ops = db.select().from(syncOutbox).all()
    expect(ops).toHaveLength(3)
    expect(ops.map((op) => ({ entity: op.entity, op: op.op, baseVersion: op.baseVersion }))).toEqual(
      expect.arrayContaining([
        { entity: 'debtor', op: 'delete', baseVersion: 3 },
        { entity: 'debt_operation', op: 'delete', baseVersion: 5 },
        { entity: 'debt_operation', op: 'delete', baseVersion: 7 },
      ]),
    )
    expect(await debtorRepo.getById(debtor.id)).toBeNull()
    expect(await operationRepo.getAll()).toHaveLength(0)
  })

  it('cascade wipes unborn records and never touches other debtors', async () => {
    const debtorRepo = createLocalDebtorRepository(db)
    const operationRepo = createLocalDebtOperationRepository(db)
    const gone = await seedDebtor('Анна')
    const stays = await seedDebtor('Сергей')
    const goneOp = await operationRepo.create({ ...OPERATION, debtorId: gone.id })
    const staysOp = await operationRepo.create({ ...OPERATION, debtorId: stays.id })

    await cascadeDeleteDebtor(db, gone.id)

    expect(db.select().from(debtors).where(eq(debtors.id, gone.id)).all()).toHaveLength(0)
    expect(
      db.select().from(debtOperations).where(eq(debtOperations.id, goneOp.id)).all(),
    ).toHaveLength(0)
    // Only the surviving pair's create operations remain in the outbox.
    const remainingOps = db.select().from(syncOutbox).all()
    expect(remainingOps.map((op) => `${op.entity}:${op.entityId}`)).toEqual([
      `debtor:${stays.id}`,
      `debt_operation:${staysOp.id}`,
    ])
    expect(await debtorRepo.getById(stays.id)).not.toBeNull()
    expect((await operationRepo.query({ debtorId: stays.id })).map((op) => op.id)).toEqual([
      staysOp.id,
    ])
  })

  it('cascade skips already-tombstoned operations instead of re-deleting them', async () => {
    const operationRepo = createLocalDebtOperationRepository(db)
    const debtor = await seedDebtor()
    const tombstoned = await operationRepo.create({ ...OPERATION, debtorId: debtor.id })
    db.update(debtOperations)
      .set({ serverVersion: 2, version: 2, deletedAt: '2026-01-03T00:00:00.000Z' })
      .where(eq(debtOperations.id, tombstoned.id))
      .run()
    // The debtor itself is server-confirmed, so its cascade travels as a
    // tombstone with a queued delete.
    db.update(debtors).set({ serverVersion: 4, version: 4 }).where(eq(debtors.id, debtor.id)).run()
    db.delete(syncOutbox).run()

    await cascadeDeleteDebtor(db, debtor.id)

    expect(db.select().from(debtOperations).where(eq(debtOperations.id, tombstoned.id)).get()).toMatchObject(
      { deletedAt: '2026-01-03T00:00:00.000Z', version: 2 },
    )
    expect(db.select().from(syncOutbox).all()).toHaveLength(1)
    expect(db.select().from(syncOutbox).all()[0]).toMatchObject({ entity: 'debtor', op: 'delete' })
  })

  it('tombstones server-confirmed debtors on delete and frees the name', async () => {
    const repo = createLocalDebtorRepository(db)
    const debtor = await repo.create(DEBTOR)
    db.update(debtors).set({ serverVersion: 3, version: 3 }).where(eq(debtors.id, debtor.id)).run()
    db.delete(syncOutbox).run()

    await repo.remove(debtor.id)

    const row = db.select().from(debtors).where(eq(debtors.id, debtor.id)).get()
    expect(row?.deletedAt).not.toBeNull()
    const ops = db.select().from(syncOutbox).all()
    expect(ops).toHaveLength(1)
    expect(ops[0]).toMatchObject({ entity: 'debtor', op: 'delete', baseVersion: 3 })

    // The tombstone does not block the name for a new debtor.
    const recreated = await repo.create({ name: 'Анна' })
    expect(recreated.id).not.toBe(debtor.id)
  })

  it('wipes unborn records without outbox traffic', async () => {
    const repo = createLocalDebtorRepository(db)
    const debtor = await repo.create(DEBTOR)
    await repo.remove(debtor.id)

    expect(db.select().from(debtors).where(eq(debtors.id, debtor.id)).all()).toHaveLength(0)
    expect(db.select().from(syncOutbox).all()).toHaveLength(0)
  })

  it('rolls back the record and the queued operation when the outbox write dies', async () => {
    const repo = createLocalDebtorRepository(db)
    const spy = vi.spyOn(outboxModule, 'enqueueOperation').mockImplementation(() => {
      throw new Error('killed before the sync operation was durably recorded')
    })

    await expect(repo.create(DEBTOR)).rejects.toThrow('killed')
    spy.mockRestore()

    expect(await repo.getAll()).toEqual([])
    expect(db.select().from(syncOutbox).all()).toHaveLength(0)
  })
})

describe('local debt operation repository', () => {
  it('creates an operation referencing a live debtor and rejects shape violations', async () => {
    const debtor = await seedDebtor()
    const repo = createLocalDebtOperationRepository(db)

    const operation = await repo.create({ ...OPERATION, debtorId: debtor.id })
    expect(operation).toMatchObject({
      debtorId: debtor.id,
      direction: 'receivable',
      kind: 'debt',
      amount: 500_000,
      version: 1,
    })

    await expect(
      repo.create({ ...OPERATION, debtorId: debtor.id, amount: 0 }),
    ).rejects.toBeInstanceOf(InvalidPayloadError)
    await expect(
      repo.create({ ...OPERATION, debtorId: debtor.id, direction: 'sideways' as 'payable' }),
    ).rejects.toBeInstanceOf(InvalidPayloadError)
  })

  it('rejects operations for missing, deleted, or foreign debtors with DEBT_OPERATION_DEBTOR_NOT_FOUND', async () => {
    const debtorRepo = createLocalDebtorRepository(db)
    const repo = createLocalDebtOperationRepository(db)

    const missing = await repo.create({ ...OPERATION, debtorId: 'no-such-debtor' }).catch((e) => e)
    expect(missing).toBeInstanceOf(UnknownReferencesError)
    expect((missing as UnknownReferencesError).apiCode).toBe('DEBT_OPERATION_DEBTOR_NOT_FOUND')

    const debtor = await seedDebtor()
    await debtorRepo.remove(debtor.id)
    const deleted = await repo.create({ ...OPERATION, debtorId: debtor.id }).catch((e) => e)
    expect(deleted).toBeInstanceOf(UnknownReferencesError)
  })

  it('lists live operations and filters by debtor', async () => {
    const anna = await seedDebtor('Анна')
    const sergey = await seedDebtor('Сергей')
    const repo = createLocalDebtOperationRepository(db)
    const op1 = await repo.create({ ...OPERATION, debtorId: anna.id })
    const op2 = await repo.create({
      ...OPERATION,
      debtorId: sergey.id,
      direction: 'payable',
      kind: 'repayment',
    })

    expect((await repo.getAll()).map((op) => op.id).sort()).toEqual([op1.id, op2.id].sort())
    expect(await repo.query({ debtorId: anna.id })).toHaveLength(1)
    expect(await repo.query({})).toHaveLength(2)
  })

  it('updates amount/occurredAt with CAS and keeps the rest of the record', async () => {
    const debtor = await seedDebtor()
    const repo = createLocalDebtOperationRepository(db)
    const operation = await repo.create({ ...OPERATION, debtorId: debtor.id })

    const conflict = await repo
      .update(operation.id, { amount: 1, version: 99 })
      .catch((error) => error)
    expect(conflict).toBeInstanceOf(VersionConflictError)
    expect((conflict as VersionConflictError).apiCode).toBe('DEBT_OPERATION_VERSION_CONFLICT')

    const updated = await repo.update(operation.id, {
      amount: 400_000,
      occurredAt: '2026-01-05T00:00:00.000Z',
      version: operation.version,
    })
    expect(updated).toMatchObject({ amount: 400_000, version: 2 })
    expect(updated.occurredAt).toBe('2026-01-05T00:00:00.000Z')
  })

  it('tombstones server-confirmed operations on delete (always allowed)', async () => {
    const debtor = await seedDebtor()
    const repo = createLocalDebtOperationRepository(db)
    const operation = await repo.create({ ...OPERATION, debtorId: debtor.id })
    db.update(debtOperations)
      .set({ serverVersion: 2, version: 2 })
      .where(eq(debtOperations.id, operation.id))
      .run()
    db.delete(syncOutbox).run()

    await repo.remove(operation.id)

    const row = db.select().from(debtOperations).where(eq(debtOperations.id, operation.id)).get()
    expect(row?.deletedAt).not.toBeNull()
    const ops = db.select().from(syncOutbox).all()
    expect(ops).toHaveLength(1)
    expect(ops[0]).toMatchObject({ entity: 'debt_operation', op: 'delete', baseVersion: 2 })
  })
})

describe('local debtor repository: currency', () => {
  it('defaults the currency to RUB and mirrors it into the outbox payload', async () => {
    const debtor = await createLocalDebtorRepository(db).create({ name: 'Анна' })
    expect(debtor.currency).toBe('RUB')

    const [op] = db.select().from(syncOutbox).all()
    expect(JSON.parse(op.payloadJson).currency).toBe('RUB')
  })

  it('stores an explicit catalog currency', async () => {
    const debtor = await createLocalDebtorRepository(db).create({
      name: 'Анна',
      currency: 'TRY',
    })
    expect(debtor.currency).toBe('TRY')
  })

  it('rejects a non-catalog currency', async () => {
    // Intentionally outside the catalog: the runtime check must reject it
    // (the static currency type already does).
    const NON_CATALOG = 'JPY' as CurrencyCode
    const error = await createLocalDebtorRepository(db)
      .create({ name: 'Анна', currency: NON_CATALOG })
      .catch((e) => e)
    expect(error).toBeInstanceOf(InvalidPayloadError)
  })
})
