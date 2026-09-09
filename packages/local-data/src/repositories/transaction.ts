// Local (offline-first) TransactionRepository over the app's SQLite database.
//
// Domain rules mirror the backend exactly, including error semantics:
// unknown references -> unknown-references code, category type mismatch and
// same-account transfers -> invalid-payload code with the backend's apiCode,
// stale `version` on update -> version-conflict code. `occurredAt` is
// canonicalized to UTC ISO so lexicographic comparison in `query()` matches
// timestamp comparison on the server (fromDate = midnight UTC, toDate =
// end of day UTC, both inclusive). Every mutation writes the row and its
// outbox operation in one transaction (design D5/D6).

import { and, desc, eq, gte, isNull, lte, or, type SQL } from 'drizzle-orm'
import { nowIso } from '@trata/dates'
import {
  AlreadyExistsError,
  InvalidPayloadError,
  NotFoundError,
  UnknownReferencesError,
  VersionConflictError,
  type CreateTransactionPayload,
  type Transaction,
  type TransactionQuery,
  type TransactionRepository,
  type UpdateTransactionPayload,
} from '@trata/api'
import type { LocalDatabase } from '../types'
import { enqueueOperation, hasSentOperations, removeOperationsFor } from '../outbox'
import { getOwnerUserId } from '../sync/sync-meta'
import { accounts, categories, transactions, type TransactionRow } from '../schema'
import { generateId } from '../id-factory'

type LocalTx = Parameters<Parameters<LocalDatabase['transaction']>[0]>[0]

/**
 * Flattened view over the discriminated-union PATCH payload: callers send
 * the fields relevant to the record's (immutable) type; `type` changes are
 * ignored like the backend's PATCH, which cannot express them.
 */
type TransactionPatch = { version: number } & Partial<
  Omit<import('@trata/api').CashflowTransaction, 'id' | 'version' | 'type'>
> &
  Partial<Omit<import('@trata/api').TransferTransaction, 'id' | 'version' | 'type'>> &
  Partial<Omit<import('@trata/api').AdjustmentTransaction, 'id' | 'version' | 'type'>>

const PAGE_SIZE = 100

function toTransaction(row: TransactionRow): Transaction {
  const base = {
    id: row.id,
    amount: row.amount,
    description: row.description,
    occurredAt: row.occurredAt,
    updatedAt: row.updatedAt ?? undefined,
    version: row.version,
    authorId: row.userId ?? null,
  }
  if (row.type === 'transfer') {
    return {
      ...base,
      type: 'transfer',
      fromAccountId: row.fromAccountId as string,
      toAccountId: row.toAccountId as string,
    }
  }
  if (row.type === 'adjustment') {
    return {
      ...base,
      type: 'adjustment',
      accountId: row.accountId as string,
    }
  }
  return {
    ...base,
    type: row.type as 'income' | 'expense',
    // Nullable = account-less («Без счета»): no balance, still in analytics.
    accountId: row.accountId,
    categoryId: row.categoryId as string,
  }
}

function isTransactionType(value: string): value is Transaction['type'] {
  return (
    value === 'income' ||
    value === 'expense' ||
    value === 'transfer' ||
    value === 'adjustment'
  )
}

function normalizeOccurredAt(value: string): string {
  const time = Date.parse(value)
  if (Number.isNaN(time)) throw new InvalidPayloadError('occurredAt must be an ISO-8601 datetime')
  return new Date(time).toISOString()
}

/** Amount sign rule mirrors the backend: >= 1 for income/expense/transfer,
 * nonzero signed for adjustment (the balance reconciliation delta). */
function assertAmount(type: Transaction['type'], value: number): void {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new InvalidPayloadError('amount must be an integer of minor units')
  }
  if (type === 'adjustment') {
    if (value === 0) {
      throw new InvalidPayloadError('adjustment amount must be a nonzero signed integer', {
        apiCode: 'INVALID_AMOUNT',
      })
    }
    return
  }
  if (value < 1) {
    throw new InvalidPayloadError('amount must be an integer of at least 1 minor unit', {
      apiCode: 'INVALID_AMOUNT',
    })
  }
}

function findLiveAccount(tx: LocalTx, id: string | null) {
  if (!id) return undefined
  return tx
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.id, id), isNull(accounts.deletedAt)))
    .get()
}

/**
 * Reference validation with the backend's granularity, order, and codes:
 * a missing account/category throws unknown-references; category type
 * mismatch and same-account transfers throw invalid-payload carrying the
 * backend's exact apiCode.
 */
function validateReferences(
  tx: LocalTx,
  type: Transaction['type'],
  accountId: string | null,
  categoryId: string | null,
  fromAccountId: string | null,
  toAccountId: string | null,
  /** The category the record already carries (null on create): keeping an
   * already-assigned archived category is allowed, assigning anew is not. */
  previousCategoryId: string | null,
): void {
  if (type === 'transfer') {
    if (!findLiveAccount(tx, fromAccountId)) {
      throw new UnknownReferencesError('Transfer source account not found', {
        apiCode: 'ACCOUNT_NOT_FOUND',
      })
    }
    if (!findLiveAccount(tx, toAccountId)) {
      throw new UnknownReferencesError('Transfer destination account not found', {
        apiCode: 'ACCOUNT_NOT_FOUND',
      })
    }
    if (fromAccountId === toAccountId) {
      throw new InvalidPayloadError('Transfer requires distinct accounts', {
        apiCode: 'SAME_ACCOUNT_TRANSFER',
      })
    }
    return
  }

  if (type === 'adjustment') {
    if (categoryId || fromAccountId || toAccountId) {
      throw new InvalidPayloadError('Adjustment carries only an account reference', {
        apiCode: 'INVALID_REFS',
      })
    }
    if (!findLiveAccount(tx, accountId)) {
      throw new UnknownReferencesError('Account not found', { apiCode: 'ACCOUNT_NOT_FOUND' })
    }
    return
  }

  // Income/expense may be account-less («Без счета»): a null account skips
  // the existence check; the category rules still apply in full.
  if (accountId !== null && !findLiveAccount(tx, accountId)) {
    throw new UnknownReferencesError('Account not found', { apiCode: 'ACCOUNT_NOT_FOUND' })
  }
  const category = categoryId
    ? tx
        .select({ type: categories.type, archivedAt: categories.archivedAt })
        .from(categories)
        .where(and(eq(categories.id, categoryId), isNull(categories.deletedAt)))
        .get()
    : undefined
  if (!category) {
    throw new UnknownReferencesError('Category not found', { apiCode: 'CATEGORY_NOT_FOUND' })
  }
  if (category.type !== type) {
    throw new InvalidPayloadError('Category type does not match the transaction type', {
      apiCode: 'CATEGORY_TYPE_MISMATCH',
    })
  }
  if (category.archivedAt !== null && previousCategoryId !== categoryId) {
    throw new InvalidPayloadError('Category is archived and not available for new transactions', {
      apiCode: 'CATEGORY_ARCHIVED',
    })
  }
}

/** Filters for `query`/`listPage` over the canonical UTC ISO strings. */
function buildFilters(options: TransactionQuery): SQL[] {
  const filters: SQL[] = [isNull(transactions.deletedAt) as SQL]

  if (options.type) filters.push(eq(transactions.type, options.type) as SQL)
  if (options.accountId) {
    filters.push(
      or(
        eq(transactions.accountId, options.accountId),
        eq(transactions.fromAccountId, options.accountId),
        eq(transactions.toAccountId, options.accountId),
      ) as SQL,
    )
  }
  if (options.categoryId) filters.push(eq(transactions.categoryId, options.categoryId) as SQL)
  // fromDate is a calendar day: midnight UTC, inclusive (backend semantics).
  if (options.fromDate) filters.push(gte(transactions.occurredAt, options.fromDate) as SQL)
  // toDate is a calendar day: end of day UTC, inclusive (backend's endOfDay).
  if (options.toDate) {
    filters.push(lte(transactions.occurredAt, `${options.toDate}T23:59:59.999Z`) as SQL)
  }

  return filters
}

function orderedQuery(db: LocalDatabase, options: TransactionQuery) {
  return db
    .select()
    .from(transactions)
    .where(and(...buildFilters(options)))
    .orderBy(desc(transactions.occurredAt), desc(transactions.id))
}

export function createLocalTransactionRepository(db: LocalDatabase): TransactionRepository {
  return {
    async getAll() {
      return orderedQuery(db, {}).all().map(toTransaction)
    },

    async getById(id: string) {
      const row = db
        .select()
        .from(transactions)
        .where(and(eq(transactions.id, id), isNull(transactions.deletedAt)))
        .get()
      return row ? toTransaction(row) : null
    },

    async query(options: TransactionQuery = {}) {
      const rows = options.limit
        ? orderedQuery(db, options).limit(options.limit).all()
        : orderedQuery(db, options).all()
      return rows.map(toTransaction)
    },

    async listPage(options: TransactionQuery & { cursor?: string } = {}) {
      // Opaque offset cursor into the filtered, sorted list (the same scheme
      // as the web localStorage dev variant).
      const pageSize = options.limit ?? PAGE_SIZE
      const { cursor, ...filters } = options
      const all = orderedQuery(db, filters).all()
      const startIndex = cursor ? Number.parseInt(cursor, 10) : 0
      const safeStart = Number.isFinite(startIndex) && startIndex >= 0 ? startIndex : 0
      const slice = all.slice(safeStart, safeStart + pageSize)
      const nextIndex = safeStart + slice.length
      return {
        transactions: slice.map(toTransaction),
        nextCursor: nextIndex < all.length ? nextIndex.toString() : null,
      }
    },

    async create(payload: CreateTransactionPayload) {
      if (!isTransactionType(payload.type)) {
        throw new InvalidPayloadError('Invalid transaction type')
      }
      assertAmount(payload.type, payload.amount)
      if (payload.description !== undefined && typeof payload.description !== 'string') {
        throw new InvalidPayloadError('description must be a string')
      }
      const occurredAt = normalizeOccurredAt(payload.occurredAt)

      const id = payload.id ?? generateId()

      // Adjustment carries only an account reference (backend parity):
      // category/transfer fields on the payload are rejected, not ignored.
      if (payload.type === 'adjustment') {
        const forbidden =
          'categoryId' in payload || 'fromAccountId' in payload || 'toAccountId' in payload
        if (forbidden || !payload.accountId) {
          throw new InvalidPayloadError('Adjustment carries only an account reference', {
            apiCode: 'INVALID_REFS',
          })
        }
      }

      return db.transaction((tx) => {
        if (
          tx.select({ id: transactions.id }).from(transactions).where(eq(transactions.id, id)).get()
        ) {
          // AlreadyExistsError (not InvalidPayloadError): the coarse
          // `already-exists` code mirrors the HTTP client's mapping of the
          // backend's 409 TRANSACTION_ALREADY_EXISTS and survives the
          // worker bridge, whose rehydration drops `apiCode`.
          throw new AlreadyExistsError('Transaction already exists', {
            apiCode: 'TRANSACTION_ALREADY_EXISTS',
          })
        }

        const row: TransactionRow =
          payload.type === 'transfer'
            ? {
                id,
                userId: getOwnerUserId(db),
                type: 'transfer',
                amount: payload.amount,
                description: payload.description ?? '',
                occurredAt,
                updatedAt: nowIso(),
                accountId: null,
                categoryId: null,
                fromAccountId: payload.fromAccountId,
                toAccountId: payload.toAccountId,
                version: 1,
                serverVersion: 0,
                deletedAt: null,
              }
            : payload.type === 'adjustment'
              ? {
                  id,
                  userId: getOwnerUserId(db),
                  type: 'adjustment',
                  amount: payload.amount,
                  description: payload.description ?? '',
                  occurredAt,
                  updatedAt: nowIso(),
                  accountId: payload.accountId,
                  categoryId: null,
                  fromAccountId: null,
                  toAccountId: null,
                  version: 1,
                  serverVersion: 0,
                  deletedAt: null,
                }
            : {
                id,
                userId: getOwnerUserId(db),
                type: payload.type,
                amount: payload.amount,
                description: payload.description ?? '',
                occurredAt,
                updatedAt: nowIso(),
                accountId: payload.accountId,
                categoryId: payload.categoryId,
                fromAccountId: null,
                toAccountId: null,
                version: 1,
                serverVersion: 0,
                deletedAt: null,
              }

        validateReferences(
          tx,
          row.type as Transaction['type'],
          row.accountId,
          row.categoryId,
          row.fromAccountId,
          row.toAccountId,
          null, // fresh assignment: an archived category is rejected
        )

        tx.insert(transactions).values(row).run()
        enqueueOperation(tx, {
          entity: 'transaction',
          entityId: id,
          op: 'upsert',
          payload: toTransaction(row),
          baseVersion: row.serverVersion,
        })
        return toTransaction(row)
      })
    },

    async update(id: string, payload: UpdateTransactionPayload) {
      const patch = payload as TransactionPatch
      const hasFields =
        patch.amount !== undefined ||
        patch.description !== undefined ||
        patch.occurredAt !== undefined ||
        patch.accountId !== undefined ||
        patch.categoryId !== undefined ||
        patch.fromAccountId !== undefined ||
        patch.toAccountId !== undefined
      if (!hasFields) throw new InvalidPayloadError('No fields to update')
      if (patch.description !== undefined && typeof patch.description !== 'string') {
        throw new InvalidPayloadError('description must be a string')
      }
      const occurredAt =
        patch.occurredAt !== undefined ? normalizeOccurredAt(patch.occurredAt) : undefined

      return db.transaction((tx) => {
        const row = tx.select().from(transactions).where(eq(transactions.id, id)).get()
        if (!row || row.deletedAt) throw new NotFoundError('Transaction not found')

        // Optimistic concurrency: PATCH carries the version the caller read.
        if (patch.version !== row.version) {
          throw new VersionConflictError('Transaction was modified concurrently', {
            apiCode: 'TRANSACTION_VERSION_CONFLICT',
          })
        }

        // The amount sign rule depends on the (immutable) record type.
        if (patch.amount !== undefined) {
          assertAmount(row.type as Transaction['type'], patch.amount)
        }

        // `type` is immutable (the backend's PATCH cannot express a type
        // change); ref columns irrelevant to the record's type stay null.
        const next: TransactionRow = { ...row }
        if (patch.amount !== undefined) next.amount = patch.amount
        if (patch.description !== undefined) next.description = patch.description
        if (occurredAt !== undefined) next.occurredAt = occurredAt
        if (row.type === 'transfer') {
          if (patch.fromAccountId !== undefined) next.fromAccountId = patch.fromAccountId
          if (patch.toAccountId !== undefined) next.toAccountId = patch.toAccountId
        } else if (row.type === 'adjustment') {
          if (patch.accountId !== undefined) next.accountId = patch.accountId
        } else {
          if (patch.accountId !== undefined) next.accountId = patch.accountId
          if (patch.categoryId !== undefined) next.categoryId = patch.categoryId
        }
        next.updatedAt = nowIso()
        next.version = row.version + 1

        validateReferences(
          tx,
          next.type as Transaction['type'],
          next.accountId,
          next.categoryId,
          next.fromAccountId,
          next.toAccountId,
          row.categoryId, // unchanged assignment may keep an archived category
        )

        tx.update(transactions).set(next).where(eq(transactions.id, id)).run()
        enqueueOperation(tx, {
          entity: 'transaction',
          entityId: id,
          op: 'upsert',
          payload: toTransaction(next),
          baseVersion: row.serverVersion,
        })
        return toTransaction(next)
      })
    },

    async remove(id: string) {
      db.transaction((tx) => {
        const row = tx.select().from(transactions).where(eq(transactions.id, id)).get()
        if (!row || row.deletedAt) throw new NotFoundError('Transaction not found')

        if (row.serverVersion === 0 && !hasSentOperations(tx, 'transaction', id)) {
          // Unborn record (no operation ever left the device): it vanishes
          // together with its queued operations.
          tx.delete(transactions).where(eq(transactions.id, id)).run()
          removeOperationsFor(tx, 'transaction', id)
        } else {
          // serverVersion 0 with a SENT create means the server may already
          // hold the record (in flight / lost response): the delete must
          // travel as a tombstone after the create, never be wiped.
          const next = { ...row, deletedAt: nowIso(), version: row.version + 1 }
          tx.update(transactions).set(next).where(eq(transactions.id, id)).run()
          enqueueOperation(tx, {
            entity: 'transaction',
            entityId: id,
            op: 'delete',
            payload: null,
            baseVersion: row.serverVersion,
          })
        }
      })
    },
  }
}
