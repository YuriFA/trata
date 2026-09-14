// Local (offline-first) AccountRepository over the app's SQLite database.
//
// Balances are computed by query - opening + the signed impact of
// non-deleted transactions (income +, expense -, transfer -from +to,
// adjustment = its signed amount) - mirroring the backend's
// `account_contributions` view and
// @trata/money's integer math. Mutations write the row and its
// outbox operation in one transaction (design D5/D6); deletes are guarded
// against in-use and tombstone records only.

import { and, eq, isNull, or, sql } from 'drizzle-orm'
import { nowIso } from '@trata/dates'
import { isCurrencyCode } from '@trata/money'
import {
  AlreadyExistsError,
  InvalidPayloadError,
  NotFoundError,
  ReferentialIntegrityError,
  VersionConflictError,
  type Account,
  type AccountWithBalance,
  type AccountRepository,
  type CreateAccountPayload,
  type UpdateAccountPayload,
} from '@trata/api'
import type { LocalDatabase } from '../types'
import { enqueueOperation, hasSentOperations, removeOperationsFor } from '../outbox'
import { getOwnerUserId } from '../sync/sync-meta'
import { accounts, plannedPayments, transactions, type AccountRow } from '../schema'
import { generateId } from '../id-factory'

type LocalTx = Parameters<Parameters<LocalDatabase['transaction']>[0]>[0]

function toAccount(row: Omit<AccountRow, 'balance'> & { balance?: number }): Account {
  return {
    id: row.id,
    name: row.name,
    currency: row.currency as Account['currency'],
    openingBalance: row.openingBalance,
    version: row.version,
  }
}

/** Signed per-account impact of every non-deleted transaction, aggregated -
 * the SQLite twin of the backend's `account_contributions` view. */
const contributions = sql`(select account_id, sum(signed) as total from (
  select account_id, case when type = 'income' then amount else -amount end as signed
  from transactions where deleted_at is null and type in ('income', 'expense')
  union all
  select from_account_id, -amount from transactions
  where deleted_at is null and type = 'transfer'
  union all
  select to_account_id, coalesce(destination_amount, amount) as signed from transactions
  where deleted_at is null and type = 'transfer'
  union all
  select account_id, amount from transactions
  where deleted_at is null and type = 'adjustment'
) group by account_id)`

interface AccountBalanceRow {
  id: string
  name: string
  currency: string
  opening_balance: number
  version: number
  balance: number
}

const balanceSelect = sql`
  select a.id, a.name, a.currency, a.opening_balance, a.version,
    a.opening_balance + coalesce(c.total, 0) as balance
  from accounts a
  left join ${contributions} c on c.account_id = a.id
`

function toAccountWithBalance(row: AccountBalanceRow): AccountWithBalance {
  return {
    id: row.id,
    name: row.name,
    currency: row.currency as Account['currency'],
    openingBalance: row.opening_balance,
    version: row.version,
    balance: row.balance,
  }
}

function hasTransactionsForAccount(tx: LocalTx, accountId: string): boolean {
  return (
    tx
      .select({ id: transactions.id })
      .from(transactions)
      .where(
        and(
          isNull(transactions.deletedAt),
          or(
            eq(transactions.accountId, accountId),
            eq(transactions.fromAccountId, accountId),
            eq(transactions.toAccountId, accountId),
          ),
        ),
      )
      .get() !== undefined
  )
}

/** Live plans referencing the account block its deletion (local D4 mirror). */
function hasLivePlansForAccount(tx: LocalTx, accountId: string): boolean {
  return (
    tx
      .select({ id: plannedPayments.id })
      .from(plannedPayments)
      .where(and(eq(plannedPayments.accountId, accountId), isNull(plannedPayments.deletedAt)))
      .get() !== undefined
  )
}

function isSafeIntegerAmount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value)
}

export function createLocalAccountRepository(db: LocalDatabase): AccountRepository {
  return {
    async getAll() {
      const rows = db.all<AccountBalanceRow>(
        sql`${balanceSelect} where a.deleted_at is null order by a.created_at, a.id`,
      )
      return rows.map(toAccountWithBalance)
    },

    async getById(id: string) {
      const row = db.get<AccountBalanceRow>(
        sql`${balanceSelect} where a.deleted_at is null and a.id = ${id}`,
      )
      return row ? toAccountWithBalance(row) : null
    },

    async create(payload: CreateAccountPayload) {
      const name = payload.name?.trim() ?? ''
      if (!name) throw new InvalidPayloadError('Account name is required')
      if (!isCurrencyCode(payload.currency)) throw new InvalidPayloadError('Invalid currency')
      if (!isSafeIntegerAmount(payload.openingBalance)) {
        throw new InvalidPayloadError('Opening balance must be an integer amount of minor units')
      }

      const id = payload.id ?? generateId()

      return db.transaction((tx) => {
        if (tx.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, id)).get()) {
          throw new AlreadyExistsError('Account already exists')
        }

        const row: AccountRow = {
          id,
          userId: getOwnerUserId(db),
          name,
          currency: payload.currency,
          openingBalance: payload.openingBalance,
          version: 1,
          serverVersion: 0,
          deletedAt: null,
          createdAt: nowIso(),
        }
        tx.insert(accounts).values(row).run()
        enqueueOperation(tx, {
          entity: 'account',
          entityId: id,
          op: 'upsert',
          payload: toAccount(row),
          baseVersion: row.serverVersion,
        })
        return { ...toAccount(row), balance: row.openingBalance }
      })
    },

    async update(id: string, payload: UpdateAccountPayload) {
      const name = payload.name
      if (name === undefined) throw new InvalidPayloadError('No fields to update')
      if (!name.trim()) {
        throw new InvalidPayloadError('Account name is required')
      }

      return db.transaction((tx) => {
        const row = tx.select().from(accounts).where(eq(accounts.id, id)).get()
        if (!row || row.deletedAt) throw new NotFoundError('Account not found')

        // Optimistic concurrency: PATCH carries the version the caller read.
        if (payload.version !== row.version) {
          throw new VersionConflictError('Account was modified concurrently', {
            apiCode: 'ACCOUNT_VERSION_CONFLICT',
          })
        }

        const next: AccountRow = {
          ...row,
          name: name.trim(),
          version: row.version + 1,
        }
        tx.update(accounts).set(next).where(eq(accounts.id, id)).run()
        enqueueOperation(tx, {
          entity: 'account',
          entityId: id,
          op: 'upsert',
          payload: toAccount(next),
          baseVersion: row.serverVersion,
        })

        const impact = tx
          .all<{ total: number | null }>(
            sql`select total from ${contributions} where account_id = ${id}`,
          )
          .at(0)
        return {
          ...toAccount(next),
          balance: next.openingBalance + (impact?.total ?? 0),
        }
      })
    },

    async remove(id: string) {
      db.transaction((tx) => {
        const row = tx.select().from(accounts).where(eq(accounts.id, id)).get()
        if (!row || row.deletedAt) throw new NotFoundError('Account not found')

        if (hasTransactionsForAccount(tx, id)) {
          throw new ReferentialIntegrityError('Account has referencing transactions', {
            apiCode: 'ACCOUNT_IN_USE',
          })
        }

        if (hasLivePlansForAccount(tx, id)) {
          throw new ReferentialIntegrityError('Account has live planned payments', {
            apiCode: 'ACCOUNT_IN_USE',
          })
        }

        if (row.serverVersion === 0 && !hasSentOperations(tx, 'account', id)) {
          // Unborn record (no operation ever left the device): it vanishes
          // together with its queued operations.
          tx.delete(accounts).where(eq(accounts.id, id)).run()
          removeOperationsFor(tx, 'account', id)
        } else {
          // serverVersion 0 with a SENT create means the server may already
          // hold the record (in flight / lost response): the delete must
          // travel as a tombstone after the create, never be wiped.
          const next = { ...row, deletedAt: nowIso(), version: row.version + 1 }
          tx.update(accounts).set(next).where(eq(accounts.id, id)).run()
          enqueueOperation(tx, {
            entity: 'account',
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
