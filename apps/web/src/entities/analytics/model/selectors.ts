// Pure derived-data helpers for the analytics screens over the DOMAIN types
// from @trata/api and the period model from @trata/dates,
// ported from the mobile selectors (web-screens-parity design D2). Integer
// money math only (minor units): totals are plain integer sums and
// percentages are display strings derived from them - UI components never
// filter, group, or compute shares themselves.
import type { CashflowTransaction, Category, Transaction } from '@trata/api'
import { transactionsInPeriod, type PeriodCursor } from '@trata/dates'
import { OTHER_ENTRY_COLOR, OTHER_ENTRY_ID } from './other-entry'
import type { AccountRef } from '@trata/api'
import type { CurrencyBucket, CurrencyCode } from '@/shared/lib/money'

/** Which cashflow direction an analytics view aggregates. */
export type AnalyticsDirection = 'income' | 'expense'

function cashflowInPeriod(
  txs: readonly Transaction[],
  cursor: PeriodCursor,
  direction: AnalyticsDirection,
): Transaction[] {
  // Transfers are excluded by construction: a transfer is neither income nor
  // expense.
  return transactionsInPeriod(txs, cursor).filter((t) => t.type === direction)
}

/** Integer minor-unit total of one direction for the period. */
export function periodTotal(
  txs: readonly Transaction[],
  cursor: PeriodCursor,
  direction: AnalyticsDirection,
): number {
  return cashflowInPeriod(txs, cursor, direction).reduce((sum, t) => sum + t.amount, 0)
}

/**
 * Native-currency buckets of one direction for the period (multi-currency
 * design D9): each amount joins its account's currency bucket; account-less
 * amounts join the display-currency bucket. Feeds `aggregateByCurrency` -
 * no sums cross currencies here.
 */
export function periodBuckets(
  txs: readonly Transaction[],
  accounts: readonly AccountRef[],
  cursor: PeriodCursor,
  direction: AnalyticsDirection,
  displayCurrency: CurrencyCode,
): CurrencyBucket[] {
  const currencyByAccount = new Map(accounts.map((account) => [account.id, account.currency]))
  // The type test re-narrows the period filter to cashflow records (the
  // only ones carrying `accountId`).
  const cashflow = cashflowInPeriod(txs, cursor, direction).filter(
    (transaction): transaction is CashflowTransaction =>
      transaction.type === 'income' || transaction.type === 'expense',
  )
  return cashflow.map((transaction) => ({
    currency:
      (transaction.accountId ? currencyByAccount.get(transaction.accountId) : undefined) ??
      displayCurrency,
    amount: transaction.amount,
  }))
}

export interface CategoryTotal {
  category: Category
  totalMinor: number
}

/**
 * Totals per category for the period and direction, descending by amount.
 * Categories without movement in the period are omitted (transactions whose
 * category is missing from `categories` still count toward `periodTotal` but
 * have no row to render).
 */
export function categoryTotals(
  txs: readonly Transaction[],
  categories: readonly Category[],
  cursor: PeriodCursor,
  direction: AnalyticsDirection,
): CategoryTotal[] {
  const totals = new Map<string, number>()
  for (const t of cashflowInPeriod(txs, cursor, direction)) {
    if (!t.categoryId) continue
    totals.set(t.categoryId, (totals.get(t.categoryId) ?? 0) + t.amount)
  }
  return categories
    .filter((c) => totals.has(c.id))
    .map((c) => ({ category: c, totalMinor: totals.get(c.id) as number }))
    .sort((a, b) => b.totalMinor - a.totalMinor)
}

/**
 * Percentage of `total` as a display string, rounded to whole percents -
 * ru and en both render "66%". An undefined share (total <= 0) renders as
 * "0%".
 */
export function percentLabel(part: number, total: number, locale: string): string {
  if (total <= 0) return `0%`
  const percent = (part / total) * 100
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(percent)}%`
}

export interface ChartEntry {
  /** Category id, or OTHER_ENTRY_ID for the aggregated remainder. */
  id: string
  label: string
  color: string
  totalMinor: number
}

/**
 * Donut/legend entries. With `top`, the overview-card shape: the `top`
 * largest categories plus one aggregated «other» entry (`otherLabel`) when
 * more remain. Without `top`, the detail-chart shape: every category
 * individually - no cap and no aggregate. Expects `totals` in categoryTotals
 * order (descending).
 */
export function toChartEntries(
  totals: readonly CategoryTotal[],
  { top, otherLabel = '' }: { top?: number; otherLabel?: string } = {},
): ChartEntry[] {
  const capped = top === undefined ? totals : totals.slice(0, top)
  const entries: ChartEntry[] = capped.map(({ category, totalMinor }) => ({
    id: category.id,
    label: category.name,
    color: category.color,
    totalMinor,
  }))
  if (top !== undefined) {
    const rest = totals.slice(top)
    if (rest.length > 0) {
      entries.push({
        id: OTHER_ENTRY_ID,
        label: otherLabel,
        color: OTHER_ENTRY_COLOR,
        totalMinor: rest.reduce((sum, { totalMinor }) => sum + totalMinor, 0),
      })
    }
  }
  return entries
}
