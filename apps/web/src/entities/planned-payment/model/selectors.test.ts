import { describe, it, expect } from 'vitest'
import type { Category } from '@expense-tracker/api'
import type { PlannedPayment } from './types'
import { isPlanOverdue, nextDueLabel, planRowTitle, plansSortedByNextDue } from './selectors'

const categories: Category[] = [
  {
    id: 'c1',
    name: 'Развлечения',
    type: 'expense',
    icon: 'tv',
    color: '#7c5cff',
    archivedAt: null,
    version: 1,
  },
]

function plan(overrides: Partial<PlannedPayment> = {}): PlannedPayment {
  return {
    id: 'p1',
    type: 'expense',
    amount: 59900,
    name: 'Netflix',
    accountId: 'a1',
    categoryId: 'c1',
    nextDue: '2026-09-05',
    anchorDate: '2026-09-05',
    regularity: 'monthly',
    confirmMode: 'manual',
    reminder: 'off',
    note: '',
    version: 1,
    ...overrides,
  }
}

describe('plans selectors', () => {
  it('sorts by next-due ascending with id tiebreak (overdue first by construction)', () => {
    const sorted = plansSortedByNextDue([
      plan({ id: 'p3', nextDue: '2026-10-01' }),
      plan({ id: 'p1', nextDue: '2026-08-01' }),
      plan({ id: 'p2', nextDue: '2026-09-01' }),
      plan({ id: 'p0', nextDue: '2026-08-01' }),
    ])
    expect(sorted.map((item) => item.id)).toEqual(['p0', 'p1', 'p2', 'p3'])
  })

  it('overdue means nextDue has arrived (UTC day comparison, today included)', () => {
    const today = '2026-08-27'
    expect(isPlanOverdue(plan({ nextDue: '2026-08-27' }), today)).toBe(true)
    expect(isPlanOverdue(plan({ nextDue: '2026-08-26' }), today)).toBe(true)
    expect(isPlanOverdue(plan({ nextDue: '2026-08-28' }), today)).toBe(false)
  })

  it('the row title falls back to the category name for unnamed plans', () => {
    expect(planRowTitle(plan(), categories)).toBe('Netflix')
    expect(planRowTitle(plan({ name: '' }), categories)).toBe('Развлечения')
    expect(planRowTitle(plan({ name: '', categoryId: 'missing' }), categories)).toBe('')
  })

  it('nextDueLabel renders the calendar day in the locale', () => {
    expect(nextDueLabel('2026-08-17', 'ru')).toBe('17 августа')
    expect(nextDueLabel('2026-08-17', 'en')).toBe('17 August')
  })
})
