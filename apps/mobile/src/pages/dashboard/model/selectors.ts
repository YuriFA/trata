// Dashboard-only summary aggregates over the DOMAIN types from @trata/api.
// The month-scoped cashflow selectors shared with the income screen live in
// @/features/cashflow-overview. Integer money math only (minor units);
// balances come pre-computed from the account repository (opening + signed
// transaction impacts, adjustments included). Multi-currency (6.4): both
// aggregates are per-currency exact with an optional «≈» conversion into the
// display currency - sums never cross currencies.

import type { AccountWithBalance, Transaction } from '@trata/api'
import { transactionsInMonth, type MonthCursor } from '@trata/dates'
import {
  aggregateByCurrency,
  nativeCurrencyOf,
  type CurrencyAggregate,
  type CurrencyBucket,
  type MoneyPresentation,
} from '@/shared/lib/money/aggregate'

/**
 * Monthly balance = income − expenses for the period as per-currency
 * buckets. Transfers never contribute: they move money between the user's
 * own accounts and are neither income nor expense.
 */
export function monthlyBalance(
  txs: Transaction[],
  cursor: MonthCursor,
  presentation: MoneyPresentation,
): CurrencyAggregate {
  const amounts: CurrencyBucket[] = []
  for (const t of transactionsInMonth(txs, cursor)) {
    if (t.type === 'income') {
      amounts.push({ currency: nativeCurrencyOf(t, presentation), amount: t.amount })
    } else if (t.type === 'expense') {
      amounts.push({ currency: nativeCurrencyOf(t, presentation), amount: -t.amount })
    }
  }
  return aggregateByCurrency(amounts, presentation.displayCurrency, presentation.rates)
}

/** Total balance across accounts (point-in-time, period-independent). */
export function totalBalance(
  accounts: AccountWithBalance[],
  presentation: MoneyPresentation,
): CurrencyAggregate {
  return aggregateByCurrency(
    accounts.map((account) => ({ currency: account.currency, amount: account.balance })),
    presentation.displayCurrency,
    presentation.rates,
  )
}
