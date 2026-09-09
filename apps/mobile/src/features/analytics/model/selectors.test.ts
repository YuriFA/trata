import { describe, expect, it } from '@jest/globals'
import type { CashflowTransaction, Category, TransferTransaction } from '@trata/api'
import { currentPeriod, type PeriodCursor } from '@trata/dates'
import { OTHER_ENTRY_COLOR, OTHER_ENTRY_ID } from '../config/other-entry'
import { categoryTotals, percentLabel, periodTotal, toChartEntries } from './selectors'

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
): CashflowTransaction {
  return { id, type, amount, occurredAt, version: 1, accountId: 'a1', categoryId }
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
    const totals = categoryTotals(txs, categories, weekCursor, 'expense')
    expect(totals.map((t) => [t.category.id, t.totalMinor])).toEqual([
      ['taxi', 1233],
      ['cafe', 500],
    ])
  })

  it('excludes transfers from both directions', () => {
    expect(periodTotal(txs, weekCursor, 'expense')).toBe(1733)
    expect(periodTotal(txs, weekCursor, 'income')).toBe(9000)
  })

  it('counts unknown-category transactions in totals but renders no row', () => {
    const ghost = [cashflowTx('g1', 'expense', 42, 'ghost', noon(2026, 7, 4))]
    expect(categoryTotals(ghost, categories, weekCursor, 'expense')).toEqual([])
    expect(periodTotal(ghost, weekCursor, 'expense')).toBe(42)
  })

  it('returns empty aggregates for an empty period', () => {
    expect(categoryTotals([], categories, monthCursor, 'expense')).toEqual([])
    expect(periodTotal([], monthCursor, 'expense')).toBe(0)
  })

  it('keeps the month cursor inside its own month only', () => {
    // Sunday Aug 2 is inside August (month cursor) but in the previous week
    // (Jul 27 – Aug 2), not the cursor's week (Aug 3 – 9).
    const earlyAugust = cashflowTx('t7', 'expense', 100, 'cafe', noon(2026, 7, 2))
    expect(categoryTotals([earlyAugust], categories, monthCursor, 'expense')).toHaveLength(1)
    expect(categoryTotals([earlyAugust], categories, weekCursor, 'expense')).toEqual([])
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
  const many = Array.from({ length: 7 }, (_, i) => ({
    category: category(`c${i}`, `Категория ${i}`, 'expense'),
    totalMinor: 700 - i * 100,
  }))

  it('caps at the top 5 and aggregates the remainder into one entry', () => {
    const entries = toChartEntries(many)
    expect(entries.map((e) => e.id)).toEqual(['c0', 'c1', 'c2', 'c3', 'c4', OTHER_ENTRY_ID])
    expect(entries.at(-1)).toMatchObject({
      color: OTHER_ENTRY_COLOR,
      totalMinor: 200 + 100,
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
