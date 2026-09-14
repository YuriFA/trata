// Pure derived-data helpers for the analytics screens over the DOMAIN types
// from @trata/api and the period model from @trata/dates.
// Integer money math only (minor units). Multi-currency (design D9): every
// figure is built from NATIVE currency buckets via the shared aggregate
// module - exact per-currency sums, one conversion per bucket into the
// display currency. Donut values, percentages, and category ordering follow
// the converted figures when rates allow; the missing-rates degradation
// keeps the exact per-currency figures and hides the percentages (they are
// never computed across currencies).

import type { Category, Transaction } from '@trata/api'
import { transactionsInPeriod, type PeriodCursor } from '@trata/dates'
import type { CurrencyCode } from '@trata/money'
import {
  aggregateByCurrency,
  aggregateHeroText,
  cashflowBuckets,
  type CurrencyAggregate,
  type MoneyPresentation,
} from '@/shared/lib/money/aggregate'
import { formatAmount } from '@/shared/lib/format/format'
import { OTHER_ENTRY_COLOR, OTHER_ENTRY_ID, OTHER_ENTRY_LABEL } from '../config/other-entry'

/** Which cashflow direction an analytics view aggregates. */
export type AnalyticsDirection = 'income' | 'expense'

function cashflowInPeriod(
  txs: readonly Transaction[],
  cursor: PeriodCursor,
  direction: AnalyticsDirection,
): Transaction[] {
  // Transfers are excluded by construction: a transfer is neither income nor
  // expense (same semantics as monthlyBalance / the backend's
  // account_contributions view).
  return transactionsInPeriod(txs, cursor).filter((t) => t.type === direction)
}

/** The period's total of one direction: per-currency exact + optional «≈». */
export function periodTotal(
  txs: readonly Transaction[],
  cursor: PeriodCursor,
  direction: AnalyticsDirection,
  presentation: MoneyPresentation,
): CurrencyAggregate {
  return aggregateByCurrency(
    cashflowBuckets(
      cashflowInPeriod(txs, cursor, direction),
      presentation.currencyByAccountId,
      presentation.displayCurrency,
    ),
    presentation.displayCurrency,
    presentation.rates,
  )
}

/**
 * The chart/percent denominator in ONE shared unit: the «≈» converted total
 * when present, the exact figure of a single-currency period, or null in the
 * missing-rates degradation - percentages are hidden, never distorted.
 */
export function chartTotal(aggregate: CurrencyAggregate): number | null {
  if (aggregate.converted) return aggregate.converted.amount
  if (!aggregate.isMixed) return aggregate.totals[0]?.amount ?? 0
  return null
}

export interface CategoryTotal {
  category: Category
  /** The category's aggregate: exact per-currency sums + optional «≈». */
  aggregate: CurrencyAggregate
  /** The figure to render: exact, «≈» converted, or the exact per-currency join. */
  amountText: string
  /** Chart/order key: the converted figure when present, else the largest bucket. */
  sortMinor: number
}

/** The zero figure of a category without movement (rows list every category). */
export function zeroCategoryTotal(
  category: Category,
  displayCurrency: CurrencyCode,
): CategoryTotal {
  return {
    category,
    aggregate: { totals: [], isMixed: false, converted: null },
    amountText: formatAmount(0, displayCurrency),
    sortMinor: 0,
  }
}

/**
 * Totals per category for the period and direction, ordered by the
 * chart/order key (the converted figures when rates allow - the analytics
 * rule - else the largest native bucket), descending. Categories without
 * movement in the period are omitted.
 */
export function categoryTotals(
  txs: readonly Transaction[],
  categories: readonly Category[],
  cursor: PeriodCursor,
  direction: AnalyticsDirection,
  presentation: MoneyPresentation,
): CategoryTotal[] {
  const byCategory = new Map<string, Transaction[]>()
  for (const t of cashflowInPeriod(txs, cursor, direction)) {
    if (!t.categoryId) continue
    const bucket = byCategory.get(t.categoryId)
    if (bucket) bucket.push(t)
    else byCategory.set(t.categoryId, [t])
  }
  return categories
    .filter((c) => byCategory.has(c.id))
    .map((category) => {
      const aggregate = aggregateByCurrency(
        cashflowBuckets(
          byCategory.get(category.id) ?? [],
          presentation.currencyByAccountId,
          presentation.displayCurrency,
        ),
        presentation.displayCurrency,
        presentation.rates,
      )
      return {
        category,
        aggregate,
        amountText: aggregateHeroText(aggregate),
        sortMinor:
          aggregate.converted?.amount ??
          Math.max(0, ...aggregate.totals.map((total) => Math.abs(total.amount))),
      }
    })
    .sort((a, b) => b.sortMinor - a.sortMinor)
}

/**
 * Percentage of `total` as a display string: at most two fractional digits
 * with trailing zeros dropped, ru decimal comma - "66,33%", "22,5%", "100%".
 * An undefined share (total <= 0) renders as "0%".
 */
export function percentLabel(part: number, total: number): string {
  if (total <= 0) return '0%'
  const percent = Math.round((part / total) * 10000) / 100
  return `${String(percent).replace('.', ',')}%`
}

export interface ChartEntry {
  /** Category id, or OTHER_ENTRY_ID for the aggregated remainder. */
  id: string
  label: string
  color: string
  /** The donut value: the category's chart/order key (see CategoryTotal). */
  totalMinor: number
  /** The entry's figure text, for summaries that must name exact figures. */
  amountText: string
}

/**
 * Donut/legend entries: the `top` largest categories plus one aggregated
 * «Прочие» entry when more remain. Expects `totals` in categoryTotals order
 * (descending).
 */
export function toChartEntries(
  totals: readonly CategoryTotal[],
  { top = 5 }: { top?: number } = {},
): ChartEntry[] {
  const entries: ChartEntry[] = totals.slice(0, top).map((total) => ({
    id: total.category.id,
    label: total.category.name,
    color: total.category.color,
    totalMinor: total.sortMinor,
    amountText: total.amountText,
  }))
  const rest = totals.slice(top)
  if (rest.length > 0) {
    entries.push({
      id: OTHER_ENTRY_ID,
      label: OTHER_ENTRY_LABEL,
      color: OTHER_ENTRY_COLOR,
      totalMinor: rest.reduce((sum, { sortMinor }) => sum + sortMinor, 0),
      amountText: rest.map((total) => total.amountText).join(' \u00B7 '),
    })
  }
  return entries
}
