// Dashboard-only summary aggregates over the DOMAIN types from
// @trata/api. The month-scoped cashflow selectors shared with the
// income screen live in @/features/cashflow-overview. Integer money math
// only (minor units); balances come pre-computed from the account repository
// (opening + signed transaction impacts, adjustments included), so selectors
// only aggregate them.

import type { AccountWithBalance, Transaction } from '@trata/api'
import { transactionsInMonth, type MonthCursor } from '@trata/dates'

/**
 * Monthly balance = income − expenses for the period. Transfers never
 * contribute: they move money between the user's own accounts and are
 * neither income nor expense.
 */
export function monthlyBalance(txs: Transaction[], cursor: MonthCursor): number {
  return transactionsInMonth(txs, cursor).reduce((sum, t) => {
    if (t.type === 'income') return sum + t.amount
    if (t.type === 'expense') return sum - t.amount
    return sum
  }, 0)
}

/** Total balance across accounts (point-in-time, period-independent). */
export function totalBalance(accounts: AccountWithBalance[]): number {
  return accounts.reduce((sum, account) => sum + account.balance, 0)
}
