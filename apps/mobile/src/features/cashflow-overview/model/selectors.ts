// Pure derived-data helpers for month-scoped cashflow overviews (the
// dashboard's expense view and the income screen) over the DOMAIN types
// from @trata/api. Integer money math only (minor units); balances come
// pre-computed from the account repository, so selectors only aggregate
// them. Multi-currency (6.4): every figure is built from NATIVE currency
// buckets via the shared aggregate module - exact per-currency sums, one
// conversion per bucket when a hero figure needs the display currency. The
// dashboard-only balance aggregates (monthlyBalance, totalBalance) live in
// pages/dashboard/model.

import type { Category, HouseholdMember, Transaction } from '@trata/api'
import {
  calendarDayKey,
  fullDayLabel,
  relativeDayLabel,
  transactionsInMonth,
  transactionsInPeriod,
  type MonthCursor,
  type PeriodCursor,
} from '@trata/dates'
import type { IconName } from '@/shared/ui/icon'
import {
  aggregateByCurrency,
  aggregateExactText,
  aggregateHeroText,
  cashflowBuckets,
  nativeCurrencyOf,
  type CurrencyAggregate,
  type MoneyPresentation,
} from '@/shared/lib/money/aggregate'
import { formatAmount } from '@/shared/lib/format/format'
import { authorLabel } from '@/entities/household'
import type { CashflowRowView } from '../ui/cashflow-list-sheet'

export {
  currentMonth,
  nextMonth,
  previousMonth,
  transactionsInMonth,
  type MonthCursor,
} from '@trata/dates'

/** Which cashflow direction an overview aggregates. */
export type CashflowKind = 'income' | 'expense'

export function cashflowInMonth(
  txs: Transaction[],
  cursor: MonthCursor,
  kind: CashflowKind,
): Transaction[] {
  return transactionsInMonth(txs, cursor).filter((t) => t.type === kind)
}

/** Same trim as cashflowInMonth, over any analytics period kind. */
function cashflowInPeriod(
  txs: Transaction[],
  cursor: PeriodCursor,
  kind: CashflowKind,
): Transaction[] {
  return transactionsInPeriod(txs, cursor).filter((t) => t.type === kind)
}

/**
 * Household authorship context for row markers (household-ux 2.4): the
 * members cache plus the current user's id resolve each record's `authorId`
 * to a compact label (null renders nothing - own/unknown/single-member).
 */
export interface CashflowAuthorContext {
  members: readonly HouseholdMember[]
  currentUserId: string | null | undefined
}

function toCashflowRow(
  tx: Transaction,
  categories: Category[],
  presentation: MoneyPresentation,
  author?: CashflowAuthorContext,
): CashflowRowView {
  const category = categories.find((c) => c.id === tx.categoryId)
  return {
    id: tx.id,
    description: tx.description ?? '',
    categoryName: category?.name ?? 'Без категории',
    categoryIcon: (category?.icon ?? 'pricetag-outline') as IconName,
    // No fallback here: the view layer owns the presentation default (a
    // theme-aware token class), keeping this pure function free of theming.
    categoryColor: category?.color,
    dayLabel: relativeDayLabel(tx.occurredAt),
    // Native currency (app-currency): the row shows the amount in its
    // account's currency; account-less amounts in the display currency.
    amountText: formatAmount(tx.amount, nativeCurrencyOf(tx, presentation)),
    authorLabel: author ? authorLabel(tx.authorId, author.members, author.currentUserId) : null,
  }
}

export interface CashflowDayGroup {
  /** Local calendar date "2026-08-17"; stable key for testIDs. */
  key: string
  /** "17 августа" */
  title: string
  /** The day's cashflow total: exact single-currency or per-currency join. */
  totalText: string
  rows: CashflowRowView[]
}

/** Newest first (ties broken by id, matching latestCashflow). */
function byOccurredAtDesc(a: Transaction, b: Transaction): number {
  if (a.occurredAt !== b.occurredAt) return a.occurredAt < b.occurredAt ? 1 : -1
  if (a.id !== b.id) return a.id < b.id ? 1 : -1
  return 0
}

/**
 * Day-grouped cashflow over PRE-TRIMMED, newest-first transactions of one
 * kind (shared by the month and period variants below). Day headers stay
 * EXACT: single-currency days show their compact total, mixed days the
 * per-currency join - list contexts never carry the «≈» conversion.
 */
function groupCashflowByDay(
  matching: Transaction[],
  categories: Category[],
  presentation: MoneyPresentation,
  author?: CashflowAuthorContext,
): CashflowDayGroup[] {
  const buckets: Array<Omit<CashflowDayGroup, 'totalText'> & { txs: Transaction[] }> = []
  for (const tx of matching) {
    const key = calendarDayKey(new Date(tx.occurredAt))

    const current = buckets[buckets.length - 1]
    if (current?.key === key) {
      current.rows.push(toCashflowRow(tx, categories, presentation, author))
      current.txs.push(tx)
    } else {
      buckets.push({
        key,
        title: fullDayLabel(tx.occurredAt),
        txs: [tx],
        rows: [toCashflowRow(tx, categories, presentation, author)],
      })
    }
  }

  return buckets.map(({ key, title, txs, rows }) => ({
    key,
    title,
    totalText: aggregateExactText(
      aggregateByCurrency(
        cashflowBuckets(txs, presentation.currencyByAccountId, presentation.displayCurrency),
        presentation.displayCurrency,
        null,
      ),
    ),
    rows,
  }))
}

/**
 * The month's cashflow of one kind grouped by local calendar day, newest
 * day first, each day's rows newest first. Feeds the grouped list sheets.
 */
export function cashflowDayGroups(
  txs: Transaction[],
  categories: Category[],
  cursor: MonthCursor,
  kind: CashflowKind,
  presentation: MoneyPresentation,
  author?: CashflowAuthorContext,
): CashflowDayGroup[] {
  return groupCashflowByDay(
    cashflowInMonth(txs, cursor, kind).slice().sort(byOccurredAtDesc),
    categories,
    presentation,
    author,
  )
}

/** periodCursor equivalent of cashflowDayGroups (any week/month/year). */
export function cashflowDayGroupsInPeriod(
  txs: Transaction[],
  categories: Category[],
  cursor: PeriodCursor,
  kind: CashflowKind,
  presentation: MoneyPresentation,
  author?: CashflowAuthorContext,
): CashflowDayGroup[] {
  return groupCashflowByDay(
    cashflowInPeriod(txs, cursor, kind).slice().sort(byOccurredAtDesc),
    categories,
    presentation,
    author,
  )
}

/**
 * The period's cashflow aggregate of one kind: per-currency exact totals
 * plus the optional «≈» conversion into the display currency (the summary
 * cards' hero figure).
 */
export function cashflowTotal(
  txs: Transaction[],
  cursor: MonthCursor,
  kind: CashflowKind,
  presentation: MoneyPresentation,
): CurrencyAggregate {
  return aggregateByCurrency(
    cashflowBuckets(
      cashflowInMonth(txs, cursor, kind),
      presentation.currencyByAccountId,
      presentation.displayCurrency,
    ),
    presentation.displayCurrency,
    presentation.rates,
  )
}

/** PeriodCursor equivalent of cashflowTotal (any week/month/year). */
export function cashflowTotalInPeriod(
  txs: Transaction[],
  cursor: PeriodCursor,
  kind: CashflowKind,
  presentation: MoneyPresentation,
): CurrencyAggregate {
  return aggregateByCurrency(
    cashflowBuckets(
      cashflowInPeriod(txs, cursor, kind),
      presentation.currencyByAccountId,
      presentation.displayCurrency,
    ),
    presentation.displayCurrency,
    presentation.rates,
  )
}

export interface CategoryCashflow {
  category: Category
  /** The category's aggregate hero: exact, «≈» converted, or the exact join. */
  amountText: string
  /** Ordering key: the converted figure when present, else the largest bucket. */
  sortMinor: number
}

/**
 * Cashflow totals per category for the period, ordered by the converted
 * figures when rates allow (the analytics rule), descending. Categories
 * without movement in the period are omitted.
 */
export function categoryBreakdown(
  txs: Transaction[],
  categories: Category[],
  cursor: MonthCursor,
  kind: CashflowKind,
  presentation: MoneyPresentation,
): CategoryCashflow[] {
  const byCategory = new Map<string, Transaction[]>()
  for (const t of cashflowInMonth(txs, cursor, kind)) {
    if (!t.categoryId) continue
    const bucket = byCategory.get(t.categoryId)
    if (bucket) bucket.push(t)
    else byCategory.set(t.categoryId, [t])
  }

  return categories
    .filter((c) => byCategory.has(c.id))
    .map((category) => {
      const txsOfCategory = byCategory.get(category.id) as Transaction[]
      const aggregate = aggregateByCurrency(
        cashflowBuckets(
          txsOfCategory,
          presentation.currencyByAccountId,
          presentation.displayCurrency,
        ),
        presentation.displayCurrency,
        presentation.rates,
      )
      return {
        category,
        amountText: aggregateHeroText(aggregate),
        sortMinor:
          aggregate.converted?.amount ??
          Math.max(0, ...aggregate.totals.map((total) => Math.abs(total.amount))),
      }
    })
    .sort((a, b) => b.sortMinor - a.sortMinor)
}

/** Most recent cashflow transaction of the period (ties broken by id). */
export function latestCashflow(
  txs: Transaction[],
  cursor: MonthCursor,
  kind: CashflowKind,
): Transaction | null {
  const matching = cashflowInMonth(txs, cursor, kind)
  if (matching.length === 0) return null
  return matching.reduce((latest, t) =>
    t.occurredAt > latest.occurredAt || (t.occurredAt === latest.occurredAt && t.id > latest.id)
      ? t
      : latest,
  )
}
