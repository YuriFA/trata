// Local (offline-first) PlannedPaymentRepository over the app's SQLite
// database. Domain rules mirror the backend: positive minor-unit amount, live
// account + live type-matched category references, NO name-uniqueness rules,
// version CAS on update, `type` immutable (structural — absent from the update
// payload), no-op update rejection, absent name/note = keep while "" clears.
// Every mutation writes the entity row AND a pending sync operation in one
// transaction. Manual confirmation (design D6) is a client-side composite:
// one transaction inserting the confirmed payment's transaction row + its
// outbox operation AND advancing the plan row + its outbox operation.

import { and, asc, eq, isNull } from 'drizzle-orm'
import { nowIso } from '@trata/dates'
import {
  AlreadyExistsError,
  InvalidPayloadError,
  NotFoundError,
  UnknownReferencesError,
  VersionConflictError,
  type PlannedPayment,
  type PlannedPaymentConfirmMode,
  type PlannedPaymentQuery,
  type PlannedPaymentRegularity,
  type PlannedPaymentReminder,
  type PlannedPaymentRepository,
  type PlannedPaymentType,
  type CreatePlannedPaymentPayload,
  type UpdatePlannedPaymentPayload,
} from '@trata/api'
import type { LocalDatabase } from '../types'
import { enqueueOperation, hasSentOperations, removeOperationsFor } from '../outbox'
import { getOwnerUserId } from '../sync/sync-meta'
import {
  accounts,
  categories,
  plannedPayments,
  transactions,
  type PlannedPaymentRow,
  type TransactionRow,
} from '../schema'
import { generateId } from '../id-factory'
import { advanceNextDue } from '../recurrence'

type LocalTx = Parameters<Parameters<LocalDatabase['transaction']>[0]>[0]

const CALENDAR_DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

const isPlannedPaymentType = (value: string): value is PlannedPaymentType =>
  value === 'expense' || value === 'income'

const isPlannedPaymentRegularity = (value: string): value is PlannedPaymentRegularity =>
  value === 'daily' || value === 'weekly' || value === 'monthly' || value === 'yearly'

const isPlannedPaymentConfirmMode = (value: string): value is PlannedPaymentConfirmMode =>
  value === 'manual' || value === 'auto'

const isPlannedPaymentReminder = (value: string): value is PlannedPaymentReminder =>
  value === 'off' || value === 'day_before' || value === 'on_day'

function toPlannedPayment(row: PlannedPaymentRow): PlannedPayment {
  return {
    id: row.id,
    type: row.type as PlannedPaymentType,
    amount: row.amount,
    name: row.name,
    accountId: row.accountId,
    categoryId: row.categoryId,
    nextDue: row.nextDue,
    anchorDate: row.anchorDate,
    regularity: row.regularity as PlannedPaymentRegularity,
    confirmMode: row.confirmMode as PlannedPaymentConfirmMode,
    reminder: row.reminder as PlannedPaymentReminder,
    note: row.note,
    version: row.version,
    authorId: row.userId ?? null,
  }
}

function isCalendarDay(value: string): boolean {
  return CALENDAR_DAY_PATTERN.test(value) && !Number.isNaN(Date.parse(value))
}

/**
 * Reference validation with the backend's codes: a missing/tombstoned account
 * or category (or a category whose type mismatches the plan) yields the
 * planned-payment not-found apiCodes — the same error a pushed plan receives.
 */
function validateReferences(
  tx: LocalTx,
  type: PlannedPaymentType,
  accountId: string,
  categoryId: string,
): void {
  const account = tx
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.id, accountId), isNull(accounts.deletedAt)))
    .get()
  if (!account) {
    throw new UnknownReferencesError('Account not found', {
      apiCode: 'PLANNED_PAYMENT_ACCOUNT_NOT_FOUND',
    })
  }
  const category = tx
    .select({ type: categories.type })
    .from(categories)
    .where(and(eq(categories.id, categoryId), isNull(categories.deletedAt)))
    .get()
  if (!category) {
    throw new UnknownReferencesError('Category not found', {
      apiCode: 'PLANNED_PAYMENT_CATEGORY_NOT_FOUND',
    })
  }
  if (category.type !== type) {
    throw new UnknownReferencesError('Category type does not match the plan type', {
      apiCode: 'PLANNED_PAYMENT_CATEGORY_NOT_FOUND',
    })
  }
}

/** Manual confirmation input (design D6); every field defaults to the plan. */
export interface ConfirmPlannedPaymentInput {
  planId: string
  /** Minor units; defaults to the plan's amount. */
  amount?: number
  /** ISO-8601 datetime; defaults to the occurrence date at 12:00 UTC. */
  occurredAt?: string
  /** Transaction note; defaults to the plan's name (empty for unnamed plans). */
  note?: string
}

/**
 * The shared contract plus the client-only confirmation composite (there is
 * deliberately no server confirm endpoint — the client composes it, D6).
 */
export type LocalPlannedPaymentRepository = PlannedPaymentRepository & {
  confirmPlannedPayment(input: ConfirmPlannedPaymentInput): Promise<void>
}

export function createLocalPlannedPaymentRepository(
  db: LocalDatabase,
): LocalPlannedPaymentRepository {
  return {
    async getAll() {
      const rows = db
        .select()
        .from(plannedPayments)
        .where(isNull(plannedPayments.deletedAt))
        .orderBy(asc(plannedPayments.createdAt), asc(plannedPayments.id))
        .all()
      return rows.map(toPlannedPayment)
    },

    async getById(id: string) {
      const row = db
        .select()
        .from(plannedPayments)
        .where(and(eq(plannedPayments.id, id), isNull(plannedPayments.deletedAt)))
        .get()
      return row ? toPlannedPayment(row) : null
    },

    async query(options: PlannedPaymentQuery = {}) {
      if (!options.type) return this.getAll()
      const rows = db
        .select()
        .from(plannedPayments)
        .where(and(eq(plannedPayments.type, options.type), isNull(plannedPayments.deletedAt)))
        .orderBy(asc(plannedPayments.createdAt), asc(plannedPayments.id))
        .all()
      return rows.map(toPlannedPayment)
    },

    async create(payload: CreatePlannedPaymentPayload) {
      if (!isPlannedPaymentType(payload.type)) throw new InvalidPayloadError('Invalid plan type')
      if (!isPlannedPaymentRegularity(payload.regularity)) {
        throw new InvalidPayloadError('Invalid regularity')
      }
      if (!isPlannedPaymentConfirmMode(payload.confirmMode)) {
        throw new InvalidPayloadError('Invalid confirmation mode')
      }
      if (!isPlannedPaymentReminder(payload.reminder)) {
        throw new InvalidPayloadError('Invalid reminder setting')
      }
      if (!Number.isSafeInteger(payload.amount) || payload.amount < 1) {
        throw new InvalidPayloadError('Amount must be a positive integer of minor units')
      }
      if (!payload.nextDue || !isCalendarDay(payload.nextDue)) {
        throw new InvalidPayloadError('Next-due must be a YYYY-MM-DD calendar day')
      }

      const id = payload.id ?? generateId()

      return db.transaction((tx) => {
        validateReferences(tx, payload.type, payload.accountId, payload.categoryId)
        if (
          tx
            .select({ id: plannedPayments.id })
            .from(plannedPayments)
            .where(eq(plannedPayments.id, id))
            .get()
        ) {
          throw new AlreadyExistsError('Planned payment already exists', {
            apiCode: 'PLANNED_PAYMENT_ALREADY_EXISTS',
          })
        }

        const row: PlannedPaymentRow = {
          id,
          userId: getOwnerUserId(db),
          type: payload.type,
          amount: payload.amount,
          name: payload.name ?? '',
          accountId: payload.accountId,
          categoryId: payload.categoryId,
          // The initial next-due doubles as the series anchor (D2).
          nextDue: payload.nextDue,
          anchorDate: payload.nextDue,
          regularity: payload.regularity,
          confirmMode: payload.confirmMode,
          reminder: payload.reminder,
          note: payload.note ?? '',
          version: 1,
          serverVersion: 0,
          deletedAt: null,
          createdAt: nowIso(),
        }
        tx.insert(plannedPayments).values(row).run()
        enqueueOperation(tx, {
          entity: 'planned_payment',
          entityId: id,
          op: 'upsert',
          payload: toPlannedPayment(row),
          baseVersion: row.serverVersion,
        })
        return toPlannedPayment(row)
      })
    },

    async update(id: string, payload: UpdatePlannedPaymentPayload) {
      const hasFields =
        payload.amount !== undefined ||
        payload.name !== undefined ||
        payload.note !== undefined ||
        payload.accountId !== undefined ||
        payload.categoryId !== undefined ||
        payload.nextDue !== undefined ||
        payload.regularity !== undefined ||
        payload.confirmMode !== undefined ||
        payload.reminder !== undefined
      if (!hasFields) throw new InvalidPayloadError('No fields to update')
      if (
        payload.amount !== undefined &&
        (!Number.isSafeInteger(payload.amount) || payload.amount < 1)
      ) {
        throw new InvalidPayloadError('Amount must be a positive integer of minor units')
      }
      if (payload.regularity !== undefined && !isPlannedPaymentRegularity(payload.regularity)) {
        throw new InvalidPayloadError('Invalid regularity')
      }
      if (payload.confirmMode !== undefined && !isPlannedPaymentConfirmMode(payload.confirmMode)) {
        throw new InvalidPayloadError('Invalid confirmation mode')
      }
      if (payload.reminder !== undefined && !isPlannedPaymentReminder(payload.reminder)) {
        throw new InvalidPayloadError('Invalid reminder setting')
      }
      if (payload.nextDue !== undefined && !isCalendarDay(payload.nextDue)) {
        throw new InvalidPayloadError('Next-due must be a YYYY-MM-DD calendar day')
      }

      return db.transaction((tx) => {
        const row = tx.select().from(plannedPayments).where(eq(plannedPayments.id, id)).get()
        if (!row || row.deletedAt) {
          throw new NotFoundError('Planned payment not found', {
            apiCode: 'PLANNED_PAYMENT_NOT_FOUND',
          })
        }

        // Optimistic concurrency: PATCH carries the version the caller read.
        if (payload.version !== row.version) {
          throw new VersionConflictError('Planned payment was modified concurrently', {
            apiCode: 'PLANNED_PAYMENT_VERSION_CONFLICT',
          })
        }

        const type = row.type as PlannedPaymentType
        const nextAccountId = payload.accountId ?? row.accountId
        const nextCategoryId = payload.categoryId ?? row.categoryId
        if (payload.accountId !== undefined || payload.categoryId !== undefined) {
          validateReferences(tx, type, nextAccountId, nextCategoryId)
        }

        const next: PlannedPaymentRow = {
          ...row,
          amount: payload.amount ?? row.amount,
          // Absent name/note keeps the value; an empty string clears it (D3).
          name: payload.name !== undefined ? payload.name : row.name,
          note: payload.note !== undefined ? payload.note : row.note,
          accountId: nextAccountId,
          categoryId: nextCategoryId,
          // Editing next-due resets the anchor to the new date (D2).
          nextDue: payload.nextDue ?? row.nextDue,
          anchorDate: payload.nextDue ?? row.anchorDate,
          regularity: payload.regularity ?? row.regularity,
          confirmMode: payload.confirmMode ?? row.confirmMode,
          reminder: payload.reminder ?? row.reminder,
          version: row.version + 1,
        }
        tx.update(plannedPayments).set(next).where(eq(plannedPayments.id, id)).run()
        enqueueOperation(tx, {
          entity: 'planned_payment',
          entityId: id,
          op: 'upsert',
          payload: toPlannedPayment(next),
          baseVersion: row.serverVersion,
        })
        return toPlannedPayment(next)
      })
    },

    async remove(id: string) {
      db.transaction((tx) => {
        const row = tx.select().from(plannedPayments).where(eq(plannedPayments.id, id)).get()
        if (!row || row.deletedAt) {
          throw new NotFoundError('Planned payment not found', {
            apiCode: 'PLANNED_PAYMENT_NOT_FOUND',
          })
        }

        // A plan has no child records: deletion is always allowed. An unborn
        // record vanishes with its queued operations; a published or in-flight
        // one tombstones and enqueues a delete op on the confirmed version.
        if (row.serverVersion === 0 && !hasSentOperations(tx, 'planned_payment', id)) {
          tx.delete(plannedPayments).where(eq(plannedPayments.id, id)).run()
          removeOperationsFor(tx, 'planned_payment', id)
          return
        }
        tx.update(plannedPayments)
          .set({ deletedAt: nowIso(), version: row.version + 1 })
          .where(eq(plannedPayments.id, id))
          .run()
        enqueueOperation(tx, {
          entity: 'planned_payment',
          entityId: id,
          op: 'delete',
          payload: null,
          baseVersion: row.serverVersion,
        })
      })
    },

    /**
     * Manual confirmation (design D6): one local transaction creates the
     * payment's transaction row (+ its outbox operation) AND advances the plan
     * (+ its outbox operation). Both operations ship in the next push; if the
     * server advanced the plan meanwhile, the plan upsert returns a version
     * conflict and takes the standard conflict-center path.
     */
    async confirmPlannedPayment(input: ConfirmPlannedPaymentInput) {
      await db.transaction((tx) => {
        const row = tx
          .select()
          .from(plannedPayments)
          .where(and(eq(plannedPayments.id, input.planId), isNull(plannedPayments.deletedAt)))
          .get()
        if (!row) {
          throw new NotFoundError('Planned payment not found', {
            apiCode: 'PLANNED_PAYMENT_NOT_FOUND',
          })
        }

        const type = row.type as PlannedPaymentType
        validateReferences(tx, type, row.accountId, row.categoryId)

        const amount = input.amount ?? row.amount
        if (!Number.isSafeInteger(amount) || amount < 1) {
          throw new InvalidPayloadError('Amount must be a positive integer of minor units')
        }
        const occurredAt =
          input.occurredAt ?? new Date(`${row.nextDue}T12:00:00.000Z`).toISOString()
        const note = input.note ?? row.name

        // The confirmed occurrence's transaction: the plan's type, account,
        // and category; the (possibly edited) amount/date/note.
        const transactionId = generateId()
        const transactionRow: TransactionRow = {
          id: transactionId,
          userId: getOwnerUserId(db),
          type,
          amount,
          description: note,
          occurredAt,
          updatedAt: null,
          accountId: row.accountId,
          categoryId: row.categoryId,
          fromAccountId: null,
          toAccountId: null,
          version: 1,
          serverVersion: 0,
          deletedAt: null,
        }
        tx.insert(transactions).values(transactionRow).run()
        enqueueOperation(tx, {
          entity: 'transaction',
          entityId: transactionId,
          op: 'upsert',
          payload: {
            id: transactionId,
            type,
            amount,
            description: note,
            occurredAt,
            accountId: row.accountId,
            categoryId: row.categoryId,
          },
          baseVersion: 0,
        })

        // The plan advances exactly one period; the anchor is untouched.
        const advanced: PlannedPaymentRow = {
          ...row,
          nextDue: advanceNextDue(
            row.nextDue,
            row.anchorDate,
            row.regularity as PlannedPaymentRegularity,
          ),
          version: row.version + 1,
        }
        tx.update(plannedPayments).set(advanced).where(eq(plannedPayments.id, row.id)).run()
        enqueueOperation(tx, {
          entity: 'planned_payment',
          entityId: row.id,
          op: 'upsert',
          payload: toPlannedPayment(advanced),
          baseVersion: row.serverVersion,
        })
      })
    },
  }
}
