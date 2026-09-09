// Local (offline-first) CategoryRepository over the app's SQLite database.
//
// Every mutation writes the entity row AND a pending sync operation in one
// transaction; `version` bumps by exactly 1 per mutation while
// `serverVersion` stays untouched (design D5), so the record is DIRTY until
// the future sync engine confirms it. Domain rules mirror the backend:
// per-user unique names, tombstone deletes with an in-use guard, and the
// shared machine-readable error codes.

import { and, asc, eq, isNull } from 'drizzle-orm'
import { nowIso } from '@trata/dates'
import {
  AlreadyExistsError,
  InvalidPayloadError,
  NotFoundError,
  ReferentialIntegrityError,
  VersionConflictError,
  type Category,
  type CategoryRepository,
  type CreateCategoryPayload,
  type UpdateCategoryPayload,
} from '@trata/api'
import type { LocalDatabase } from '../types'
import { enqueueOperation, hasSentOperations, removeOperationsFor } from '../outbox'
import { getOwnerUserId } from '../sync/sync-meta'
import { categories, plannedPayments, transactions, type CategoryRow } from '../schema'
import { generateId } from '../id-factory'

function toCategory(row: CategoryRow): Category {
  return {
    id: row.id,
    name: row.name,
    type: row.type as Category['type'],
    icon: row.icon,
    color: row.color,
    archivedAt: row.archivedAt,
    version: row.version,
    ...(row.slug ? { slug: row.slug } : {}),
  }
}

function isCategoryType(value: string): value is Category['type'] {
  return value === 'income' || value === 'expense'
}

type LocalTx = Parameters<Parameters<LocalDatabase['transaction']>[0]>[0]

/** A non-deleted category with this name exists (excluding `exceptId`). */
function hasDuplicateName(tx: LocalTx, name: string, exceptId?: string): boolean {
  const rows = tx
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.name, name), isNull(categories.deletedAt)))
    .all()
  return rows.some((row) => row.id !== exceptId)
}

export function createLocalCategoryRepository(db: LocalDatabase): CategoryRepository {
  return {
    async getAll() {
      // Picker default: active (non-archived) categories only.
      const rows = db
        .select()
        .from(categories)
        .where(and(isNull(categories.deletedAt), isNull(categories.archivedAt)))
        .orderBy(asc(categories.createdAt), asc(categories.id))
        .all()
      return rows.map(toCategory)
    },

    async getAllIncludingArchived() {
      const rows = db
        .select()
        .from(categories)
        .where(isNull(categories.deletedAt))
        .orderBy(asc(categories.createdAt), asc(categories.id))
        .all()
      return rows.map(toCategory)
    },

    async getById(id: string) {
      const row = db
        .select()
        .from(categories)
        .where(and(eq(categories.id, id), isNull(categories.deletedAt)))
        .get()
      return row ? toCategory(row) : null
    },

    async create(payload: CreateCategoryPayload) {
      const name = payload.name?.trim() ?? ''
      if (!name) throw new InvalidPayloadError('Category name is required')
      if (!isCategoryType(payload.type)) throw new InvalidPayloadError('Invalid category type')
      if (!payload.icon) throw new InvalidPayloadError('Category icon is required')
      if (!payload.color) throw new InvalidPayloadError('Category color is required')

      const id = payload.id ?? generateId()

      return db.transaction((tx) => {
        const duplicateName = hasDuplicateName(tx, name)
        if (duplicateName) {
          throw new AlreadyExistsError('Category already exists', {
            apiCode: 'CATEGORY_ALREADY_EXISTS',
          })
        }
        if (tx.select({ id: categories.id }).from(categories).where(eq(categories.id, id)).get()) {
          throw new AlreadyExistsError('Category already exists', {
            apiCode: 'CATEGORY_ALREADY_EXISTS',
          })
        }

        const row: CategoryRow = {
          id,
          userId: getOwnerUserId(db),
          name,
          type: payload.type,
          icon: payload.icon,
          color: payload.color,
          archivedAt: null,
          slug: payload.slug ?? null,
          version: 1,
          serverVersion: 0,
          deletedAt: null,
          createdAt: nowIso(),
        }
        tx.insert(categories).values(row).run()
        enqueueOperation(tx, {
          entity: 'category',
          entityId: id,
          op: 'upsert',
          payload: toCategory(row),
          baseVersion: row.serverVersion,
        })
        return toCategory(row)
      })
    },

    async update(id: string, payload: UpdateCategoryPayload) {
      const hasFields =
        payload.name !== undefined ||
        payload.type !== undefined ||
        payload.icon !== undefined ||
        payload.color !== undefined ||
        payload.archived !== undefined
      if (!hasFields) throw new InvalidPayloadError('No fields to update')
      if (payload.name !== undefined && !payload.name.trim()) {
        throw new InvalidPayloadError('Category name is required')
      }
      if (payload.type !== undefined && !isCategoryType(payload.type)) {
        throw new InvalidPayloadError('Invalid category type')
      }

      return db.transaction((tx) => {
        const row = tx.select().from(categories).where(eq(categories.id, id)).get()
        if (!row || row.deletedAt) throw new NotFoundError('Category not found')

        // Optimistic concurrency: PATCH carries the version the caller read.
        if (payload.version !== row.version) {
          throw new VersionConflictError('Category was modified concurrently', {
            apiCode: 'CATEGORY_VERSION_CONFLICT',
          })
        }

        const name = payload.name !== undefined ? payload.name.trim() : row.name
        if (name !== row.name && hasDuplicateName(tx, name, id)) {
          throw new AlreadyExistsError('Category already exists', {
            apiCode: 'CATEGORY_ALREADY_EXISTS',
          })
        }

        // Archiving is blocked while a live planned payment references the
        // category - the local mirror of the server-side guard.
        if (payload.archived === true) {
          const planned = tx
            .select({ id: plannedPayments.id })
            .from(plannedPayments)
            .where(and(eq(plannedPayments.categoryId, id), isNull(plannedPayments.deletedAt)))
            .get()
          if (planned) {
            throw new ReferentialIntegrityError('Category has live planned payments', {
              apiCode: 'CATEGORY_IN_USE',
            })
          }
        }

        const next: CategoryRow = {
          ...row,
          name,
          type: payload.type ?? row.type,
          icon: payload.icon ?? row.icon,
          color: payload.color ?? row.color,
          ...(payload.archived !== undefined
            ? { archivedAt: payload.archived ? nowIso() : null }
            : {}),
          version: row.version + 1,
        }
        tx.update(categories).set(next).where(eq(categories.id, id)).run()
        enqueueOperation(tx, {
          entity: 'category',
          entityId: id,
          op: 'upsert',
          payload: toCategory(next),
          baseVersion: row.serverVersion,
        })
        return toCategory(next)
      })
    },

    async remove(id: string, options?: { cascade?: boolean }) {
      const cascade = options?.cascade === true
      db.transaction((tx) => {
        const row = tx.select().from(categories).where(eq(categories.id, id)).get()
        if (!row || row.deletedAt) throw new NotFoundError('Category not found')

        if (!cascade) {
          const referenced = tx
            .select({ id: transactions.id })
            .from(transactions)
            .where(and(eq(transactions.categoryId, id), isNull(transactions.deletedAt)))
            .get()
          if (referenced) {
            throw new ReferentialIntegrityError('Category has referencing transactions', {
              apiCode: 'CATEGORY_IN_USE',
            })
          }
        }

        // Live plans referencing the category block deletion too (tombstoned
        // plans never block) - the local mirror of the server-side guard, in
        // both delete modes: a cascade removes transactions, never future
        // obligations.
        const planned = tx
          .select({ id: plannedPayments.id })
          .from(plannedPayments)
          .where(and(eq(plannedPayments.categoryId, id), isNull(plannedPayments.deletedAt)))
          .get()
        if (planned) {
          throw new ReferentialIntegrityError('Category has live planned payments', {
            apiCode: 'CATEGORY_IN_USE',
          })
        }

        const referencing = tx
          .select()
          .from(transactions)
          .where(and(eq(transactions.categoryId, id), isNull(transactions.deletedAt)))
          .all()

        if (row.serverVersion === 0 && !hasSentOperations(tx, 'category', id)) {
          // Unborn record (no operation ever left the device): it vanishes
          // and its queued operations go with it - nothing is ever pushed.
          // Unreferenced-born transactions cannot exist for an unborn
          // category, so a local cascade just wipes the same unborn rows.
          tx.delete(categories).where(eq(categories.id, id)).run()
          removeOperationsFor(tx, 'category', id)
          for (const txRow of referencing) {
            tx.delete(transactions).where(eq(transactions.id, txRow.id)).run()
            removeOperationsFor(tx, 'transaction', txRow.id)
          }
          return
        }

        // serverVersion 0 with a SENT create means the server may already
        // hold the record (in flight / lost response): the delete must
        // travel as a tombstone after the create, never be wiped.
        const next = { ...row, deletedAt: nowIso(), version: row.version + 1 }
        tx.update(categories).set(next).where(eq(categories.id, id)).run()
        enqueueOperation(tx, {
          entity: 'category',
          entityId: id,
          op: 'delete',
          // The cascade flag rides the delete payload; the server replays
          // the cascade atomically and the transaction tombstones come
          // back through pull.
          payload: cascade ? { cascade: true } : null,
          baseVersion: row.serverVersion,
        })

        if (!cascade) return
        // Local cascade mirror: tombstone the referencing transactions in
        // this same transaction WITHOUT individual delete ops - the single
        // flagged category delete covers them server-side. Unborn ones
        // vanish; born ones keep their row as a tombstone for the pull to
        // confirm. Their pending ops are dropped (the cascade outranks them).
        const stamp = nowIso()
        for (const txRow of referencing) {
          const unborn =
            txRow.serverVersion === 0 && !hasSentOperations(tx, 'transaction', txRow.id)
          if (unborn) {
            tx.delete(transactions).where(eq(transactions.id, txRow.id)).run()
            removeOperationsFor(tx, 'transaction', txRow.id)
          } else {
            tx.update(transactions)
              .set({ ...txRow, deletedAt: stamp, version: txRow.version + 1 })
              .where(eq(transactions.id, txRow.id))
              .run()
            removeOperationsFor(tx, 'transaction', txRow.id)
          }
        }
      })
    },
  }
}
