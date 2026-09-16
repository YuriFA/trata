// Local (offline-first) Debtor + DebtOperation repositories over the app's
// SQLite database. Every mutation writes the entity row AND a pending sync
// operation in one transaction; `version` bumps by exactly 1 per mutation
// while `serverVersion` stays untouched, so the record is DIRTY until the
// sync engine confirms it. Domain rules mirror the backend: unique live
// debtor names, debtor references validated against live debtors, cascade
// debtor delete (the debtor and all its live operations tombstone together),
// single-operation tombstone deletes, and the shared machine-readable error
// codes.

import { and, asc, eq, isNull } from 'drizzle-orm'
import { DEFAULT_CURRENCY, isCurrencyCode } from '@trata/money'
import { nowIso } from '@trata/dates'
import {
  AlreadyExistsError,
  InvalidPayloadError,
  NotFoundError,
  UnknownReferencesError,
  VersionConflictError,
  type DebtDirection,
  type DebtOperation,
  type DebtOperationKind,
  type DebtOperationQuery,
  type DebtOperationRepository,
  type Debtor,
  type DebtorRepository,
  type CreateDebtOperationPayload,
  type CreateDebtorPayload,
  type UpdateDebtOperationPayload,
  type UpdateDebtorPayload,
} from '@trata/api'
import type { LocalDatabase } from '../types'
import { enqueueOperation, hasSentOperations, removeOperationsFor } from '../outbox'
import { getOwnerUserId } from '../sync/sync-meta'
import {
  debtOperations,
  debtors,
  type DebtOperationRow,
  type DebtorRow,
} from '../schema'
import { generateId } from '../id-factory'

type LocalTx = Parameters<Parameters<LocalDatabase['transaction']>[0]>[0]

function toDebtor(row: DebtorRow): Debtor {
  return {
    id: row.id,
    name: row.name,
    currency: row.currency as Debtor['currency'],
    version: row.version,
  }
}

function toDebtOperation(row: DebtOperationRow): DebtOperation {
  return {
    id: row.id,
    debtorId: row.debtorId,
    direction: row.direction as DebtDirection,
    kind: row.kind as DebtOperationKind,
    amount: row.amount,
    occurredAt: row.occurredAt,
    version: row.version,
    authorId: row.userId ?? null,
  }
}

const isDebtDirection = (value: string): value is DebtDirection =>
  value === 'receivable' || value === 'payable'

const isDebtOperationKind = (value: string): value is DebtOperationKind =>
  value === 'debt' || value === 'repayment'

/** A non-deleted debtor with this name exists (excluding `exceptId`). */
function hasDuplicateDebtorName(tx: LocalTx, name: string, exceptId?: string): boolean {
  const rows = tx
    .select({ id: debtors.id })
    .from(debtors)
    .where(and(eq(debtors.name, name), isNull(debtors.deletedAt)))
    .all()
  return rows.some((row) => row.id !== exceptId)
}

/** The debtor reference of an operation must be a live local debtor. */
function liveDebtorExists(tx: LocalTx, debtorId: string): boolean {
  const row = tx
    .select({ id: debtors.id })
    .from(debtors)
    .where(and(eq(debtors.id, debtorId), isNull(debtors.deletedAt)))
    .get()
  return row !== undefined
}

function validateOperationShape(payload: CreateDebtOperationPayload): void {
  if (!payload.debtorId) throw new InvalidPayloadError('Debtor is required')
  if (!isDebtDirection(payload.direction)) throw new InvalidPayloadError('Invalid direction')
  if (!isDebtOperationKind(payload.kind)) throw new InvalidPayloadError('Invalid operation kind')
  if (!Number.isSafeInteger(payload.amount) || payload.amount < 1) {
    throw new InvalidPayloadError('Amount must be a positive integer of minor units')
  }
  if (!payload.occurredAt) throw new InvalidPayloadError('Occurred-at is required')
}

/**
 * Shared tombstone-or-wipe delete: an unborn record (nothing ever sent to the
 * server) vanishes with its queued operations; a published or in-flight one
 * tombstones and enqueues a delete op based on the confirmed server version.
 */
function deleteWithTombstone(
  tx: LocalTx,
  entity: 'debtor' | 'debt_operation',
  row: { id: string; version: number; serverVersion: number },
  tombstone: (next: { deletedAt: string; version: number }) => void,
): void {
  if (row.serverVersion === 0 && !hasSentOperations(tx, entity, row.id)) {
    if (entity === 'debtor') {
      tx.delete(debtors).where(eq(debtors.id, row.id)).run()
    } else {
      tx.delete(debtOperations).where(eq(debtOperations.id, row.id)).run()
    }
    removeOperationsFor(tx, entity, row.id)
    return
  }
  // serverVersion 0 with a SENT create means the server may already hold the
  // record (in flight / lost response): the delete must travel as a tombstone
  // after the create, never be wiped.
  const next = { deletedAt: nowIso(), version: row.version + 1 }
  tombstone(next)
  enqueueOperation(tx, {
    entity,
    entityId: row.id,
    op: 'delete',
    payload: null,
    baseVersion: row.serverVersion,
  })
}

/**
 * Cascade debtor delete (debts capability): tombstones the debtor AND all of
 * its live (non-deleted) operations and enqueues one sync delete per
 * tombstoned record, all in ONE local transaction - the local mirror of the
 * server's atomic cascade. Every record goes through the shared
 * tombstone-or-wipe rule, so unborn records vanish while published ones
 * travel as tombstones. Already-tombstoned operations keep their own delete
 * trail and are not touched.
 */
export async function cascadeDeleteDebtor(db: LocalDatabase, id: string): Promise<void> {
  db.transaction((tx) => {
    const debtor = tx.select().from(debtors).where(eq(debtors.id, id)).get()
    if (!debtor || debtor.deletedAt) throw new NotFoundError('Debtor not found')

    const liveOperations = tx
      .select()
      .from(debtOperations)
      .where(and(eq(debtOperations.debtorId, id), isNull(debtOperations.deletedAt)))
      .all()
    for (const operation of liveOperations) {
      deleteWithTombstone(tx, 'debt_operation', operation, (next) => {
        tx.update(debtOperations).set(next).where(eq(debtOperations.id, operation.id)).run()
      })
    }

    deleteWithTombstone(tx, 'debtor', debtor, (next) => {
      tx.update(debtors).set(next).where(eq(debtors.id, id)).run()
    })
  })
}

export function createLocalDebtorRepository(db: LocalDatabase): DebtorRepository {
  return {
    async getAll() {
      const rows = db
        .select()
        .from(debtors)
        .where(isNull(debtors.deletedAt))
        .orderBy(asc(debtors.createdAt), asc(debtors.id))
        .all()
      return rows.map(toDebtor)
    },

    async getById(id: string) {
      const row = db
        .select()
        .from(debtors)
        .where(and(eq(debtors.id, id), isNull(debtors.deletedAt)))
        .get()
      return row ? toDebtor(row) : null
    },

    async create(payload: CreateDebtorPayload) {
      const name = payload.name?.trim() ?? ''
      if (!name) throw new InvalidPayloadError('Debtor name is required')
      // The household base currency is the client's knowledge (the local db
      // has no household table), so callers pass it explicitly; RUB is the
      // same DB backstop the backend falls back to.
      const currency = payload.currency ?? DEFAULT_CURRENCY
      if (!isCurrencyCode(currency)) throw new InvalidPayloadError('Invalid currency')

      const id = payload.id ?? generateId()

      return db.transaction((tx) => {
        if (hasDuplicateDebtorName(tx, name)) {
          throw new AlreadyExistsError('Debtor already exists', {
            apiCode: 'DEBTOR_ALREADY_EXISTS',
          })
        }
        if (tx.select({ id: debtors.id }).from(debtors).where(eq(debtors.id, id)).get()) {
          throw new AlreadyExistsError('Debtor already exists', {
            apiCode: 'DEBTOR_ALREADY_EXISTS',
          })
        }

        const row: DebtorRow = {
          id,
          userId: getOwnerUserId(db),
          name,
          currency,
          version: 1,
          serverVersion: 0,
          deletedAt: null,
          createdAt: nowIso(),
        }
        tx.insert(debtors).values(row).run()
        enqueueOperation(tx, {
          entity: 'debtor',
          entityId: id,
          op: 'upsert',
          payload: toDebtor(row),
          baseVersion: row.serverVersion,
        })
        return toDebtor(row)
      })
    },

    async update(id: string, payload: UpdateDebtorPayload) {
      // Rename-only: the name is the debtor's single updatable field.
      if (payload.name === undefined) throw new InvalidPayloadError('No fields to update')
      if (!payload.name.trim()) throw new InvalidPayloadError('Debtor name is required')

      const name = payload.name.trim()

      return db.transaction((tx) => {
        const row = tx.select().from(debtors).where(eq(debtors.id, id)).get()
        if (!row || row.deletedAt) throw new NotFoundError('Debtor not found')

        // Optimistic concurrency: PATCH carries the version the caller read.
        if (payload.version !== row.version) {
          throw new VersionConflictError('Debtor was modified concurrently', {
            apiCode: 'DEBTOR_VERSION_CONFLICT',
          })
        }

        // Rename-only, so the same name is a no-op update - rejected before it
        // can dirty the record with a sync op the backend would refuse.
        if (name === row.name) throw new InvalidPayloadError('No fields to update')
        if (hasDuplicateDebtorName(tx, name, id)) {
          throw new AlreadyExistsError('Debtor already exists', {
            apiCode: 'DEBTOR_ALREADY_EXISTS',
          })
        }

        const next: DebtorRow = {
          ...row,
          name,
          version: row.version + 1,
        }
        tx.update(debtors).set(next).where(eq(debtors.id, id)).run()
        enqueueOperation(tx, {
          entity: 'debtor',
          entityId: id,
          op: 'upsert',
          payload: toDebtor(next),
          baseVersion: row.serverVersion,
        })
        return toDebtor(next)
      })
    },

    async remove(id: string) {
      // The debtor-in-use guard is gone: deletion cascades over the live
      // operations (debts capability, cascade deletion rules).
      await cascadeDeleteDebtor(db, id)
    },
  }
}

export function createLocalDebtOperationRepository(db: LocalDatabase): DebtOperationRepository {
  return {
    async getAll() {
      const rows = db
        .select()
        .from(debtOperations)
        .where(isNull(debtOperations.deletedAt))
        .orderBy(asc(debtOperations.occurredAt), asc(debtOperations.id))
        .all()
      return rows.map(toDebtOperation)
    },

    async getById(id: string) {
      const row = db
        .select()
        .from(debtOperations)
        .where(and(eq(debtOperations.id, id), isNull(debtOperations.deletedAt)))
        .get()
      return row ? toDebtOperation(row) : null
    },

    async query(options: DebtOperationQuery = {}) {
      if (!options.debtorId) return this.getAll()
      const rows = db
        .select()
        .from(debtOperations)
        .where(and(eq(debtOperations.debtorId, options.debtorId), isNull(debtOperations.deletedAt)))
        .orderBy(asc(debtOperations.occurredAt), asc(debtOperations.id))
        .all()
      return rows.map(toDebtOperation)
    },

    async create(payload: CreateDebtOperationPayload) {
      validateOperationShape(payload)

      const id = payload.id ?? generateId()

      return db.transaction((tx) => {
        if (!liveDebtorExists(tx, payload.debtorId)) {
          throw new UnknownReferencesError('Debtor not found', {
            apiCode: 'DEBT_OPERATION_DEBTOR_NOT_FOUND',
          })
        }
        if (
          tx
            .select({ id: debtOperations.id })
            .from(debtOperations)
            .where(eq(debtOperations.id, id))
            .get()
        ) {
          throw new AlreadyExistsError('Debt operation already exists', {
            apiCode: 'DEBT_OPERATION_ALREADY_EXISTS',
          })
        }

        const row: DebtOperationRow = {
          id,
          userId: getOwnerUserId(db),
          debtorId: payload.debtorId,
          direction: payload.direction,
          kind: payload.kind,
          amount: payload.amount,
          occurredAt: payload.occurredAt,
          version: 1,
          serverVersion: 0,
          deletedAt: null,
        }
        tx.insert(debtOperations).values(row).run()
        enqueueOperation(tx, {
          entity: 'debt_operation',
          entityId: id,
          op: 'upsert',
          payload: toDebtOperation(row),
          baseVersion: row.serverVersion,
        })
        return toDebtOperation(row)
      })
    },

    async update(id: string, payload: UpdateDebtOperationPayload) {
      const hasFields = payload.amount !== undefined || payload.occurredAt !== undefined
      if (!hasFields) throw new InvalidPayloadError('No fields to update')
      if (
        payload.amount !== undefined &&
        (!Number.isSafeInteger(payload.amount) || payload.amount < 1)
      ) {
        throw new InvalidPayloadError('Amount must be a positive integer of minor units')
      }

      return db.transaction((tx) => {
        const row = tx.select().from(debtOperations).where(eq(debtOperations.id, id)).get()
        if (!row || row.deletedAt) throw new NotFoundError('Debt operation not found')

        // Optimistic concurrency: PATCH carries the version the caller read.
        if (payload.version !== row.version) {
          throw new VersionConflictError('Debt operation was modified concurrently', {
            apiCode: 'DEBT_OPERATION_VERSION_CONFLICT',
          })
        }

        const next: DebtOperationRow = {
          ...row,
          amount: payload.amount ?? row.amount,
          occurredAt: payload.occurredAt ?? row.occurredAt,
          version: row.version + 1,
        }
        tx.update(debtOperations).set(next).where(eq(debtOperations.id, id)).run()
        enqueueOperation(tx, {
          entity: 'debt_operation',
          entityId: id,
          op: 'upsert',
          payload: toDebtOperation(next),
          baseVersion: row.serverVersion,
        })
        return toDebtOperation(next)
      })
    },

    async remove(id: string) {
      db.transaction((tx) => {
        const row = tx.select().from(debtOperations).where(eq(debtOperations.id, id)).get()
        if (!row || row.deletedAt) throw new NotFoundError('Debt operation not found')

        deleteWithTombstone(tx, 'debt_operation', row, (next) => {
          tx.update(debtOperations).set(next).where(eq(debtOperations.id, id)).run()
        })
      })
    },
  }
}
