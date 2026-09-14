import { describe, expect, it } from '@jest/globals'
import type { Category, Transaction } from '@trata/api'
import { isCurrentOrFutureMonth } from '@trata/dates'
import { formatAmount } from '@/shared/lib/format/format'
import type { MoneyPresentation } from '@/shared/lib/money/aggregate'
import {
  cashflowDayGroups,
  cashflowInMonth,
  cashflowTotal,
  categoryBreakdown,
  latestCashflow,
  nextMonth,
  previousMonth,
  transactionsInMonth,
} from './selectors'

// Every fixture account is RUB and no rates are cached: aggregates stay
// exact single-currency (converted = null) and amounts render in RUB.
const PRESENTATION: MoneyPresentation = {
  currencyByAccountId: new Map([
    ['a-card', 'RUB'],
    ['a-cash', 'RUB'],
  ]),
  displayCurrency: 'RUB',
  rates: null,
}

// Deterministic domain-shaped fixtures.
const CURSOR = { year: 2026, month: 7 } // August 2026
const inAugust = (day: number) => `2026-08-${String(day).padStart(2, '0')}T12:00:00.000Z`

const categories: Category[] = [
  {
    id: 'c-taxi',
    name: 'Такси',
    type: 'expense',
    icon: 'car',
    color: '#7c5cff',
    archivedAt: null,
    version: 1,
  },
  {
    id: 'c-cafe',
    name: 'Кафе',
    type: 'expense',
    icon: 'cafe',
    color: '#a78bfa',
    archivedAt: null,
    version: 1,
  },
  {
    id: 'c-salary',
    name: 'Зарплата',
    type: 'income',
    icon: 'cash',
    color: '#16a34a',
    archivedAt: null,
    version: 1,
  },
]

const txs: Transaction[] = [
  {
    id: 't1',
    type: 'income',
    amount: 1_000_000,
    description: 'Зарплата',
    occurredAt: inAugust(3),
    version: 1,
    accountId: 'a-card',
    categoryId: 'c-salary',
  },
  {
    id: 't2',
    type: 'expense',
    amount: 400_000,
    description: 'Такси',
    occurredAt: inAugust(10),
    version: 1,
    accountId: 'a-card',
    categoryId: 'c-taxi',
  },
  {
    id: 't3',
    type: 'expense',
    amount: 100_000,
    description: 'Кофе',
    occurredAt: inAugust(20),
    version: 1,
    accountId: 'a-cash',
    categoryId: 'c-cafe',
  },
  {
    id: 't4',
    type: 'transfer',
    amount: 250_000,
    description: 'Перевод',
    occurredAt: inAugust(15),
    version: 1,
    fromAccountId: 'a-card',
    toAccountId: 'a-cash',
  },
  {
    id: 't5',
    type: 'expense',
    amount: 700_000,
    description: 'Июльский расход',
    occurredAt: '2026-07-10T12:00:00.000Z',
    version: 1,
    accountId: 'a-card',
    categoryId: 'c-taxi',
  },
]

describe('selectors · month filtering', () => {
  it('keeps only transactions of the cursor month', () => {
    expect(transactionsInMonth(txs, CURSOR).map((t) => t.id)).toEqual(['t1', 't2', 't3', 't4'])
  })

  it('previousMonth/nextMonth wrap the year boundary', () => {
    expect(previousMonth({ year: 2026, month: 0 })).toEqual({ year: 2025, month: 11 })
    expect(nextMonth({ year: 2026, month: 11 })).toEqual({ year: 2027, month: 0 })
    expect(nextMonth(previousMonth({ year: 2026, month: 7 }))).toEqual({ year: 2026, month: 7 })
  })

  it('flags the current month and the future, not the past', () => {
    const now = new Date(2026, 7, 14)
    expect(isCurrentOrFutureMonth({ year: 2026, month: 7 }, now)).toBe(true)
    expect(isCurrentOrFutureMonth({ year: 2026, month: 8 }, now)).toBe(true)
    expect(isCurrentOrFutureMonth({ year: 2026, month: 6 }, now)).toBe(false)
  })

  it('attributes a 00:30-local first-of-month transaction to the new month', () => {
    const boundary = new Date(2026, 8, 1, 0, 30).toISOString()
    expect(
      cashflowInMonth(
        [{ ...txs[0], id: 't-boundary', occurredAt: boundary }],
        { year: 2026, month: 8 },
        'income',
      ).map((t) => t.id),
    ).toEqual(['t-boundary'])
    expect(
      cashflowInMonth([{ ...txs[0], id: 't-boundary', occurredAt: boundary }], CURSOR, 'income'),
    ).toEqual([])
  })
})

describe('selectors · totals', () => {
  it('cashflowTotal sums only the kind of the month, exact when single-currency', () => {
    const expenses = cashflowTotal(txs, CURSOR, 'expense', PRESENTATION)
    expect(expenses.totals).toEqual([{ currency: 'RUB', amount: 500_000 }])
    expect(expenses.converted).toBeNull()
    expect(cashflowTotal(txs, CURSOR, 'income', PRESENTATION).totals).toEqual([
      { currency: 'RUB', amount: 1_000_000 },
    ])
  })

  it('cashflowInMonth never yields transfers', () => {
    expect(cashflowInMonth(txs, CURSOR, 'expense').map((t) => t.id)).toEqual(['t2', 't3'])
    expect(cashflowInMonth(txs, CURSOR, 'income').map((t) => t.id)).toEqual(['t1'])
  })
})

describe('selectors · category breakdown', () => {
  it('orders expense categories by amount descending and omits the rest', () => {
    const rows = categoryBreakdown(txs, categories, CURSOR, 'expense', PRESENTATION)
    expect(rows.map((r) => r.category.id)).toEqual(['c-taxi', 'c-cafe'])
    expect(rows[0].sortMinor).toBe(400_000)
    // income category never appears even though its transaction is in month
    expect(rows.some((r) => r.category.type === 'income')).toBe(false)
  })

  it('breaks down income over income categories only', () => {
    const rows = categoryBreakdown(txs, categories, CURSOR, 'income', PRESENTATION)
    expect(rows.map((r) => r.category.id)).toEqual(['c-salary'])
    expect(rows[0].sortMinor).toBe(1_000_000)
    expect(rows.some((r) => r.category.type === 'expense')).toBe(false)
  })

  it('latestCashflow picks the most recent transaction of the kind', () => {
    expect(latestCashflow(txs, CURSOR, 'expense')?.id).toBe('t3')
    expect(latestCashflow(txs, CURSOR, 'income')?.id).toBe('t1')
    expect(latestCashflow(txs, { year: 2026, month: 9 }, 'expense')).toBeNull()
  })
})

describe('selectors · cashflow day groups', () => {
  it('groups the month expenses by day, newest day and row first', () => {
    const groups = cashflowDayGroups(
      [
        ...txs,
        {
          id: 't6',
          type: 'expense' as const,
          amount: 250_000,
          description: 'Кофе с другом',
          occurredAt: '2026-08-20T18:00:00.000Z',
          version: 1,
          accountId: 'a-cash',
          categoryId: 'c-cafe',
        },
      ],
      categories,
      CURSOR,
      'expense',
      PRESENTATION,
    )

    // Days newest first; income/transfer/out-of-month never group.
    expect(groups.map((g) => g.key)).toEqual(['2026-08-20', '2026-08-10'])
    // Within a day rows are newest first: 18:00 before 12:00.
    expect(groups[0].rows.map((r) => r.id)).toEqual(['t6', 't3'])
    expect(groups[0].title).toBe('20 августа')
    expect(groups[0].totalText).toBe(formatAmount(100_000 + 250_000, 'RUB'))
    expect(groups[1].rows.map((r) => r.id)).toEqual(['t2'])
    expect(groups[1].totalText).toBe(formatAmount(400_000, 'RUB'))
  })

  it('groups incomes without expenses and transfers', () => {
    const groups = cashflowDayGroups(txs, categories, CURSOR, 'income', PRESENTATION)
    expect(groups.map((g) => g.key)).toEqual(['2026-08-03'])
    expect(groups[0].rows.map((r) => r.id)).toEqual(['t1'])
    expect(groups[0].totalText).toBe(formatAmount(1_000_000, 'RUB'))
    expect(groups[0].rows[0].categoryName).toBe('Зарплата')
  })

  it('is empty for a month without expenses', () => {
    expect(
      cashflowDayGroups(txs, categories, { year: 2026, month: 4 }, 'expense', PRESENTATION),
    ).toEqual([])
  })

  it('rows carry the category view fields with the uncategorized fallback', () => {
    const groups = cashflowDayGroups(
      [
        {
          id: 't-uncat',
          type: 'expense' as const,
          amount: 50_000,
          description: undefined,
          occurredAt: inAugust(5),
          version: 1,
          accountId: 'a-cash',
          categoryId: 'missing',
        },
      ],
      categories,
      CURSOR,
      'expense',
      PRESENTATION,
    )
    expect(groups[0].rows[0]).toMatchObject({
      id: 't-uncat',
      categoryName: 'Без категории',
      categoryIcon: 'pricetag-outline',
      categoryColor: undefined,
      amountText: formatAmount(50_000, 'RUB'),
    })
  })
})
