import { describe, it, expect } from 'vitest'
import type { Category, Transaction } from '@trata/api'
import { currentPeriod, shiftPeriod } from '@trata/dates'
import { categoryTotals, percentLabel, periodTotal, toChartEntries } from './selectors'
import { OTHER_ENTRY_ID } from './other-entry'

const categories: Category[] = [
  {
    id: 'c1',
    name: 'Такси',
    type: 'expense',
    icon: 'car',
    color: '#7c5cff',
    archivedAt: null,
    version: 1,
  },
  {
    id: 'c2',
    name: 'Еда',
    type: 'expense',
    icon: 'food',
    color: '#22c55e',
    archivedAt: null,
    version: 1,
  },
  {
    id: 'c3',
    name: 'Книги',
    type: 'expense',
    icon: 'book',
    color: '#f97316',
    archivedAt: null,
    version: 1,
  },
  {
    id: 'i1',
    name: 'Зарплата',
    type: 'income',
    icon: 'cash',
    color: '#3b82f6',
    archivedAt: null,
    version: 1,
  },
]

function tx(overrides: Partial<Transaction>): Transaction {
  return {
    id: 't',
    type: 'expense',
    amount: 100,
    description: '',
    occurredAt: '2026-01-15T12:00:00Z',
    accountId: 'a1',
    categoryId: 'c1',
    ...overrides,
  } as Transaction
}

describe('periodTotal', () => {
  it('sums minor units of the direction in the exact local period', () => {
    const cursor = currentPeriod('month')
    const transactions = [
      tx({ id: 't1', type: 'expense', amount: 20113, occurredAt: new Date().toISOString() }),
      tx({ id: 't2', type: 'expense', amount: 10212, occurredAt: new Date().toISOString() }),
      tx({ id: 't3', type: 'income', amount: 50000, occurredAt: new Date().toISOString() }),
      // Different period: excluded from the total.
      tx({
        id: 't4',
        type: 'expense',
        amount: 999,
        occurredAt: shiftPeriod(cursor, -2).start.toISOString(),
      }),
    ]
    expect(periodTotal(transactions, cursor, 'expense')).toBe(30325)
    expect(periodTotal(transactions, cursor, 'income')).toBe(50000)
  })

  it('excludes transfers from both directions', () => {
    const cursor = currentPeriod('month')
    const transactions = [
      tx({
        id: 't1',
        type: 'transfer',
        amount: 1000,
        occurredAt: new Date().toISOString(),
        fromAccountId: 'a1',
        toAccountId: 'a2',
        categoryId: undefined,
      }),
    ]
    expect(periodTotal(transactions, cursor, 'expense')).toBe(0)
    expect(periodTotal(transactions, cursor, 'income')).toBe(0)
  })
})

describe('categoryTotals', () => {
  it('returns per-category totals sorted descending, omitting categories without movement', () => {
    const cursor = currentPeriod('month')
    const transactions = [
      tx({ id: 't1', amount: 1000, categoryId: 'c1', occurredAt: new Date().toISOString() }),
      tx({ id: 't2', amount: 3000, categoryId: 'c2', occurredAt: new Date().toISOString() }),
      tx({ id: 't3', amount: 500, categoryId: 'c1', occurredAt: new Date().toISOString() }),
    ]
    const totals = categoryTotals(transactions, categories, cursor, 'expense')
    expect(totals.map((item) => item.category.id)).toEqual(['c2', 'c1'])
    expect(totals[0]!.totalMinor).toBe(3000)
    expect(totals[1]!.totalMinor).toBe(1500)
  })

  it('keeps transactions with a missing category in the period total but out of rows', () => {
    const cursor = currentPeriod('month')
    const transactions = [
      tx({ id: 't1', amount: 700, categoryId: undefined, occurredAt: new Date().toISOString() }),
      tx({ id: 't2', amount: 300, categoryId: 'c1', occurredAt: new Date().toISOString() }),
    ]
    expect(categoryTotals(transactions, categories, cursor, 'expense')).toHaveLength(1)
    expect(periodTotal(transactions, cursor, 'expense')).toBe(1000)
  })
})

describe('percentLabel', () => {
  it('rounds to whole percents', () => {
    expect(percentLabel(20113, 30325, 'ru')).toBe('66%')
    expect(percentLabel(20113, 30325, 'en')).toBe('66%')
    expect(percentLabel(1000, 2000, 'en')).toBe('50%')
    expect(percentLabel(250, 2000, 'en')).toBe('13%')
  })

  it('renders 0% for an undefined share', () => {
    expect(percentLabel(100, 0, 'ru')).toBe('0%')
    expect(percentLabel(100, -5, 'ru')).toBe('0%')
  })
})

describe('toChartEntries', () => {
  const manyCategories: Category[] = Array.from({ length: 7 }, (_, index) => ({
    id: `c${index + 1}`,
    name: `Категория ${index + 1}`,
    type: 'expense',
    icon: 'star',
    color: '#7c5cff',
    archivedAt: null,
    version: 1,
  }))
  const totals = (amounts: number[]) =>
    amounts.map((totalMinor, index) => ({
      category: manyCategories[index]!,
      totalMinor,
    }))

  it('caps at the top N and aggregates the remainder into one «other» entry', () => {
    const entries = toChartEntries(totals([500, 400, 300, 200, 100, 60, 40]), {
      top: 5,
      otherLabel: 'Прочие',
    })
    expect(entries).toHaveLength(6)
    expect(entries[4]!.totalMinor).toBe(100)
    expect(entries[5]).toMatchObject({ id: OTHER_ENTRY_ID, label: 'Прочие', totalMinor: 100 })
  })

  it('renders every category individually without a cap (detail chart)', () => {
    const entries = toChartEntries(totals([500, 400, 300, 200, 100, 60, 40]))
    expect(entries).toHaveLength(7)
    expect(entries.some((entry) => entry.id === OTHER_ENTRY_ID)).toBe(false)
  })
})
