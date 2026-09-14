import { describe, expect, it } from '@jest/globals'
import type { CashflowTransaction, Category, TransferTransaction } from '@trata/api'
import { currentPeriod, type PeriodCursor } from '@trata/dates'
import type { CurrencyRates } from '@trata/money'
import type { MoneyPresentation } from '@/shared/lib/money/aggregate'
import { OTHER_ENTRY_COLOR, OTHER_ENTRY_ID } from '../config/other-entry'
import {
  categoryTotals,
  chartTotal,
  percentLabel,
  periodTotal,
  toChartEntries,
  type CategoryTotal,
} from './selectors'

// Local-noon timestamps keep period membership TZ-independent: whatever the
// machine's zone, each instant lands midday on the intended local day.
const noon = (year: number, month: number, day: number): string =>
  new Date(year, month, day, 12, 0).toISOString()

// Wednesday inside the week/month under test (2026-08-03 is a Monday).
const now = new Date(2026, 7, 5, 12, 0)
const weekCursor: PeriodCursor = currentPeriod('week', now)
const monthCursor: PeriodCursor = currentPeriod('month', now)

function cashflowTx(
  id: string,
  type: 'income' | 'expense',
  amount: number,
  categoryId: string,
  occurredAt: string,
  accountId = 'a1',
): CashflowTransaction {
  return { id, type, amount, occurredAt, version: 1, accountId, categoryId }
}

function transferTx(id: string, amount: number, occurredAt: string): TransferTransaction {
  return {
    id,
    type: 'transfer',
    amount,
    occurredAt,
    version: 1,
    fromAccountId: 'a1',
    toAccountId: 'a2',
  }
}

function category(id: string, name: string, type: 'income' | 'expense'): Category {
  return { id, name, type, icon: 'pricetag', color: `#${id}`, archivedAt: null, version: 1 }
}

const categories: Category[] = [
  category('taxi', 'Такси', 'expense'),
  category('cafe', 'Кафе', 'expense'),
  category('salary', 'Зарплата', 'income'),
]

// Single-currency presentation: every amount is native RUB, no cached rates
// (the exact aggregate needs none).
const RUB_ONLY: MoneyPresentation = {
  currencyByAccountId: new Map([['a1', 'RUB']]),
  displayCurrency: 'RUB',
  rates: null,
}

// USD-based published rates: 1 USD = 90 RUB.
const RATES: CurrencyRates = {
  base: 'USD',
  asOf: '2026-08-05T00:00:00.000Z',
  rates: { USD: 1, RUB: 90 },
}

// Mixed presentation: RUB and USD accounts, display currency RUB.
const MIXED: MoneyPresentation = {
  currencyByAccountId: new Map([
    ['a1', 'RUB'],
    ['a2', 'USD'],
  ]),
  displayCurrency: 'RUB',
  rates: RATES,
}

describe('categoryTotals / periodTotal', () => {
  const txs = [
    cashflowTx('t1', 'expense', 1000, 'taxi', noon(2026, 7, 4)),
    cashflowTx('t2', 'expense', 233, 'taxi', noon(2026, 7, 5)),
    cashflowTx('t3', 'expense', 500, 'cafe', noon(2026, 7, 4)),
    cashflowTx('t4', 'income', 9000, 'salary', noon(2026, 7, 5)),
    transferTx('t5', 200, noon(2026, 7, 5)),
    // Previous week: outside the cursor's period.
    cashflowTx('t6', 'expense', 77, 'taxi', noon(2026, 6, 28)),
  ]

  it('aggregates per category, descending, for the period and direction', () => {
    const totals = categoryTotals(txs, categories, weekCursor, 'expense', RUB_ONLY)
    expect(totals.map((t) => [t.category.id, t.sortMinor])).toEqual([
      ['taxi', 1233],
      ['cafe', 500],
    ])
    // Row figures are exact per-currency texts.
    expect(totals.map((t) => t.amountText)).toEqual(['12,33\u00A0₽', '5\u00A0₽'])
  })

  it('sums the period per currency without crossing currencies', () => {
    const expense = periodTotal(txs, weekCursor, 'expense', RUB_ONLY)
    expect(expense.totals).toEqual([{ currency: 'RUB', amount: 1733 }])
    expect(expense.converted).toBeNull()
    expect(expense.isMixed).toBe(false)

    const income = periodTotal(txs, weekCursor, 'income', RUB_ONLY)
    expect(income.totals).toEqual([{ currency: 'RUB', amount: 9000 }])
  })

  it('converts a mixed period into the display currency and orders by converted figures', () => {
    const mixedTxs = [
      cashflowTx('m1', 'expense', 1000, 'taxi', noon(2026, 7, 4), 'a1'), // 10,00 ₽
      cashflowTx('m2', 'expense', 500, 'cafe', noon(2026, 7, 4), 'a2'), // $5,00
      cashflowTx('m3', 'expense', 2000, 'cafe', noon(2026, 7, 5), 'a1'), // + 20,00 ₽
    ]

    const total = periodTotal(mixedTxs, weekCursor, 'expense', MIXED)
    expect(total.isMixed).toBe(true)
    expect(total.totals).toEqual([
      { currency: 'RUB', amount: 3000 },
      { currency: 'USD', amount: 500 },
    ])
    // $5,00 converts at 1 USD = 90 RUB; sums stay integer minor units.
    expect(total.converted).toEqual({ currency: 'RUB', amount: 48_000 })
    expect(chartTotal(total)).toBe(48_000)

    // The mixed category's CONVERTED figure (47 000) outranks the RUB one.
    const totals = categoryTotals(mixedTxs, categories, weekCursor, 'expense', MIXED)
    expect(totals.map((t) => [t.category.id, t.sortMinor])).toEqual([
      ['cafe', 47_000],
      ['taxi', 1000],
    ])
  })

  it('degrades to exact per-currency figures when a required rate is missing', () => {
    const noUsdRate: MoneyPresentation = {
      currencyByAccountId: new Map([
        ['a1', 'RUB'],
        ['a2', 'USD'],
      ]),
      displayCurrency: 'RUB',
      rates: { base: 'USD', asOf: '', rates: { RUB: 90 } },
    }
    const mixedTxs = [
      cashflowTx('m1', 'expense', 1000, 'taxi', noon(2026, 7, 4), 'a1'),
      cashflowTx('m2', 'expense', 500, 'cafe', noon(2026, 7, 4), 'a2'),
    ]

    const total = periodTotal(mixedTxs, weekCursor, 'expense', noUsdRate)
    expect(total.converted).toBeNull()
    expect(chartTotal(total)).toBeNull()

    const totals = categoryTotals(mixedTxs, categories, weekCursor, 'expense', noUsdRate)
    expect(totals.map((t) => [t.category.id, t.sortMinor])).toEqual([
      ['taxi', 1000],
      ['cafe', 500],
    ])
  })

  it('counts unknown-category transactions in totals but renders no row', () => {
    const ghost = [cashflowTx('g1', 'expense', 42, 'ghost', noon(2026, 7, 4))]
    expect(categoryTotals(ghost, categories, weekCursor, 'expense', RUB_ONLY)).toEqual([])
    expect(periodTotal(ghost, weekCursor, 'expense', RUB_ONLY).totals).toEqual([
      { currency: 'RUB', amount: 42 },
    ])
  })

  it('renders an empty period as an exact zero of the display currency', () => {
    expect(categoryTotals([], categories, monthCursor, 'expense', RUB_ONLY)).toEqual([])
    const empty = periodTotal([], monthCursor, 'expense', RUB_ONLY)
    expect(empty.totals).toEqual([{ currency: 'RUB', amount: 0 }])
    expect(empty.converted).toBeNull()
    // A comparable-unit denominator of an empty period is plain zero.
    expect(chartTotal(empty)).toBe(0)
  })

  it('keeps the month cursor inside its own month only', () => {
    // Sunday Aug 2 is inside August (month cursor) but in the previous week
    // (Jul 27 – Aug 2), not the cursor's week (Aug 3 – 9).
    const earlyAugust = cashflowTx('t7', 'expense', 100, 'cafe', noon(2026, 7, 2))
    expect(
      categoryTotals([earlyAugust], categories, monthCursor, 'expense', RUB_ONLY),
    ).toHaveLength(1)
    expect(categoryTotals([earlyAugust], categories, weekCursor, 'expense', RUB_ONLY)).toEqual([])
  })
})

describe('chartTotal', () => {
  it('prefers the converted figure when present', () => {
    expect(
      chartTotal({
        totals: [
          { currency: 'RUB', amount: 1000 },
          { currency: 'USD', amount: 500 },
        ],
        isMixed: true,
        converted: { currency: 'RUB', amount: 46_000 },
      }),
    ).toBe(46_000)
  })

  it('falls back to the single-currency exact total', () => {
    expect(
      chartTotal({ totals: [{ currency: 'RUB', amount: 1733 }], isMixed: false, converted: null }),
    ).toBe(1733)
  })

  it('is null for a mixed aggregate without a converted figure', () => {
    expect(
      chartTotal({
        totals: [
          { currency: 'RUB', amount: 1000 },
          { currency: 'USD', amount: 500 },
        ],
        isMixed: true,
        converted: null,
      }),
    ).toBeNull()
  })
})

describe('percentLabel', () => {
  it('formats with ru comma, two digits max, no trailing zeros', () => {
    expect(percentLabel(20113, 30325)).toBe('66,32%')
    expect(percentLabel(2250, 10000)).toBe('22,5%')
    expect(percentLabel(30325, 30325)).toBe('100%')
  })

  it('renders an undefined share as 0%', () => {
    expect(percentLabel(0, 0)).toBe('0%')
    expect(percentLabel(500, 0)).toBe('0%')
  })
})

describe('toChartEntries', () => {
  const many: CategoryTotal[] = Array.from({ length: 7 }, (_, i) => ({
    category: category(`c${i}`, `Категория ${i}`, 'expense'),
    aggregate: { totals: [], isMixed: false, converted: null },
    amountText: `text ${i}`,
    sortMinor: 700 - i * 100,
  }))

  it('caps at the top 5 and aggregates the remainder into one entry', () => {
    const entries = toChartEntries(many)
    expect(entries.map((e) => e.id)).toEqual(['c0', 'c1', 'c2', 'c3', 'c4', OTHER_ENTRY_ID])
    expect(entries.at(-1)).toMatchObject({
      color: OTHER_ENTRY_COLOR,
      totalMinor: 200 + 100,
      amountText: 'text 5 · text 6',
    })
  })

  it('adds no remainder entry when categories fit', () => {
    expect(toChartEntries(many.slice(0, 5)).map((e) => e.id)).toEqual([
      'c0',
      'c1',
      'c2',
      'c3',
      'c4',
    ])
    expect(toChartEntries(many.slice(0, 2))).toHaveLength(2)
  })

  it('keeps category colors and descending order', () => {
    const entries = toChartEntries(many)
    expect(entries.slice(0, 5).map((e) => e.totalMinor)).toEqual([700, 600, 500, 400, 300])
    expect(entries[0].color).toBe('#c0')
    expect(entries[0].label).toBe('Категория 0')
  })
})
