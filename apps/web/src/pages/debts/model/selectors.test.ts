import { describe, it, expect } from 'vitest'
import type { Debtor } from '@trata/api'
import type { DebtOperation } from '@/entities/debt-operation'
import { debtorHistoryGroups, debtorSection, initialsOf, lastOperationAt } from './selectors'

const debtors: Debtor[] = [
  { id: 'd1', name: 'Анна', note: '', version: 1 },
  { id: 'd2', name: 'Борис', note: '', version: 1 },
  { id: 'd3', name: 'Вера', note: '', version: 1 },
]

function op(overrides: Partial<DebtOperation>): DebtOperation {
  return {
    id: 'op',
    debtorId: 'd1',
    direction: 'receivable',
    kind: 'debt',
    amount: 1000,
    note: '',
    occurredAt: '2026-08-20T12:00:00.000Z',
    version: 1,
    ...overrides,
  }
}

describe('debtorSection', () => {
  it('splits visible vs settled with balances derived from the history', () => {
    const operations = [
      op({ id: 'o1', debtorId: 'd1', direction: 'receivable', kind: 'debt', amount: 500000 }),
      op({ id: 'o2', debtorId: 'd1', direction: 'receivable', kind: 'repayment', amount: 150000 }),
      op({ id: 'o3', debtorId: 'd2', direction: 'receivable', kind: 'debt', amount: 200000 }),
      op({ id: 'o4', debtorId: 'd2', direction: 'receivable', kind: 'repayment', amount: 200000 }),
      op({ id: 'o5', debtorId: 'd3', direction: 'payable', kind: 'debt', amount: 9900 }),
    ]

    const receivable = debtorSection(debtors, operations, 'receivable')
    // d3 has only payable operations: absent from the receivable section even
    // settled (membership requires an operation in the direction).
    expect(receivable.visible.map((view) => view.debtor.id)).toEqual(['d1'])
    expect(receivable.visible[0]!.balance).toBe(350000)
    expect(receivable.settled.map((view) => view.debtor.id)).toEqual(['d2'])

    const payable = debtorSection(debtors, operations, 'payable')
    expect(payable.visible.map((view) => view.debtor.id)).toEqual(['d3'])
    expect(payable.settled).toHaveLength(0)
  })

  it('sorts visible by balance desc with name tiebreak, settled by name', () => {
    const operations = [
      op({ id: 'o1', debtorId: 'd1', kind: 'debt', amount: 100 }),
      op({ id: 'o2', debtorId: 'd2', kind: 'debt', amount: 300 }),
      op({ id: 'o3', debtorId: 'd3', kind: 'debt', amount: 300 }),
      op({ id: 'o4', debtorId: 'd3', kind: 'repayment', amount: 100 }),
    ]
    const section = debtorSection(debtors, operations, 'receivable')
    expect(section.visible.map((view) => [view.debtor.id, view.balance])).toEqual([
      ['d2', 300],
      ['d3', 200],
      ['d1', 100],
    ])
  })

  it('keeps negative balances (over-repayment) visible', () => {
    const operations = [
      op({ id: 'o1', debtorId: 'd1', kind: 'debt', amount: 5000 }),
      op({ id: 'o2', debtorId: 'd1', kind: 'repayment', amount: 6000 }),
    ]
    const section = debtorSection(debtors, operations, 'receivable')
    expect(section.visible[0]!.balance).toBe(-1000)
  })
})

describe('debtorHistoryGroups', () => {
  it('groups by local day, newest day first, newest op first within a day', () => {
    const operations = [
      op({ id: 'o1', occurredAt: '2026-08-19T10:00:00.000Z' }),
      op({ id: 'o2', occurredAt: '2026-08-20T08:00:00.000Z' }),
      op({ id: 'o3', occurredAt: '2026-08-20T18:00:00.000Z' }),
      op({ id: 'o4', debtorId: 'd2', occurredAt: '2026-08-21T08:00:00.000Z' }),
      op({ id: 'o5', direction: 'payable', occurredAt: '2026-08-21T08:00:00.000Z' }),
    ]
    const groups = debtorHistoryGroups(operations, 'd1', 'receivable', 'en')
    expect(groups.map((group) => group.key)).toHaveLength(2)
    expect(groups[0]!.operations.map((operation) => operation.id)).toEqual(['o3', 'o2'])
    expect(groups[1]!.operations.map((operation) => operation.id)).toEqual(['o1'])
  })
})

describe('debtor avatar helpers', () => {
  it('initials take the first letters of the first and last word', () => {
    expect(initialsOf('Анна Петрова')).toBe('АП')
    expect(initialsOf('Борис')).toBe('Б')
    expect(initialsOf('   ')).toBe('?')
  })
})

describe('lastOperationAt', () => {
  it('returns the latest timestamp of the debtor+direction, null when absent', () => {
    const operations = [
      op({
        id: 'o1',
        debtorId: 'd1',
        direction: 'receivable',
        occurredAt: '2026-08-20T12:00:00.000Z',
      }),
      op({
        id: 'o2',
        debtorId: 'd1',
        direction: 'receivable',
        occurredAt: '2026-08-24T09:00:00.000Z',
      }),
      // Other debtor / other direction never leak into the meta line.
      op({
        id: 'o3',
        debtorId: 'd2',
        direction: 'receivable',
        occurredAt: '2026-08-25T09:00:00.000Z',
      }),
      op({
        id: 'o4',
        debtorId: 'd1',
        direction: 'payable',
        occurredAt: '2026-08-26T09:00:00.000Z',
      }),
    ]
    expect(lastOperationAt(operations, 'd1', 'receivable')).toBe('2026-08-24T09:00:00.000Z')
    expect(lastOperationAt(operations, 'd3', 'receivable')).toBeNull()
  })
})
