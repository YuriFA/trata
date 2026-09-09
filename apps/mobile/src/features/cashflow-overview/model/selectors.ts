// Pure derived-data helpers for month-scoped cashflow overviews (the
// dashboard's expense view and the income screen) over the DOMAIN types
// from @trata/api. Integer money math only (minor units);
// balances come pre-computed from the account repository (opening +
// manualAdjustment + signed transaction impacts), so selectors only
// aggregate them. The dashboard-only balance aggregates (monthlyBalance,
// totalBalance) live in pages/dashboard/model.

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
    amountText: formatAmount(tx.amount),
    authorLabel: author ? authorLabel(tx.authorId, author.members, author.currentUserId) : null,
  }
}

export interface CashflowDayGroup {
  /** Local calendar date "2026-08-17"; stable key for testIDs. */
  key: string
  /** "17 августа" */
  title: string
  /** "3 123 ₽" — the day's cashflow total. */
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
 * kind (shared by the month and period variants below).
 */
function groupCashflowByDay(
  matching: Transaction[],
  categories: Category[],
  author?: CashflowAuthorContext,
): CashflowDayGroup[] {
  const buckets: Array<Omit<CashflowDayGroup, 'totalText'> & { totalMinor: number }> = []
  for (const tx of matching) {
    const key = calendarDayKey(new Date(tx.occurredAt))

    const current = buckets[buckets.length - 1]
    if (current?.key === key) {
      current.rows.push(toCashflowRow(tx, categories, author))
      current.totalMinor += tx.amount
    } else {
      buckets.push({
        key,
        title: fullDayLabel(tx.occurredAt),
        totalMinor: tx.amount,
        rows: [toCashflowRow(tx, categories, author)],
      })
    }
  }

  return buckets.map(({ key, title, totalMinor, rows }) => ({
    key,
    title,
    totalText: formatAmount(totalMinor),
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
  author?: CashflowAuthorContext,
): CashflowDayGroup[] {
  return groupCashflowByDay(
    cashflowInMonth(txs, cursor, kind).slice().sort(byOccurredAtDesc),
    categories,
    author,
  )
}

/** periodCursor equivalent of cashflowDayGroups (any week/month/year). */
export function cashflowDayGroupsInPeriod(
  txs: Transaction[],
  categories: Category[],
  cursor: PeriodCursor,
  kind: CashflowKind,
  author?: CashflowAuthorContext,
): CashflowDayGroup[] {
  return groupCashflowByDay(
    cashflowInPeriod(txs, cursor, kind).slice().sort(byOccurredAtDesc),
    categories,
    author,
  )
}

export function totalCashflow(txs: Transaction[], cursor: MonthCursor, kind: CashflowKind): number {
  return cashflowInMonth(txs, cursor, kind).reduce((sum, t) => sum + t.amount, 0)
}

export function totalCashflowInPeriod(
  txs: Transaction[],
  cursor: PeriodCursor,
  kind: CashflowKind,
): number {
  return cashflowInPeriod(txs, cursor, kind).reduce((sum, t) => sum + t.amount, 0)
}

export interface CategoryCashflow {
  category: Category
  totalMinor: number
}

/**
 * Cashflow totals per category for the period, descending by amount.
 * Categories without movement in the period are omitted.
 */
export function categoryBreakdown(
  txs: Transaction[],
  categories: Category[],
  cursor: MonthCursor,
  kind: CashflowKind,
): CategoryCashflow[] {
  const totals = new Map<string, number>()
  for (const t of cashflowInMonth(txs, cursor, kind)) {
    if (t.type !== kind || !t.categoryId) continue
    totals.set(t.categoryId, (totals.get(t.categoryId) ?? 0) + t.amount)
  }
  return categories
    .filter((c) => totals.has(c.id))
    .map((c) => ({ category: c, totalMinor: totals.get(c.id) as number }))
    .sort((a, b) => b.totalMinor - a.totalMinor)
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
