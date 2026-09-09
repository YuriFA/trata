// Balance derivation selectors (debts capability: balances are pure
// functions of the operation set - never stored, no netting across
// directions, over-repayment yields a negative balance).

import { describe, expect, it } from 'vitest'
import type { DebtOperation } from '@trata/api'
import { balanceInDirection, balancesByDebtor, totalsByDirection } from './balances'

const op = (
  overrides: Partial<Pick<DebtOperation, 'debtorId' | 'direction' | 'kind' | 'amount'>> & {
    id: string
  },
): DebtOperation => ({
  id: overrides.id,
  debtorId: overrides.debtorId ?? 'anna',
  direction: overrides.direction ?? 'receivable',
  kind: overrides.kind ?? 'debt',
  amount: overrides.amount ?? 100_000,
  note: '',
  occurredAt: '2026-01-02T00:00:00.000Z',
  version: 1,
})

describe('balance derivation', () => {
  it('sums debt minus repayment per debtor and direction', () => {
    const operations = [
      op({ id: '1', kind: 'debt', amount: 500_000 }),
      op({ id: '2', kind: 'repayment', amount: 150_000 }),
      op({ id: '3', kind: 'repayment', amount: 100_000 }),
    ]

    expect(balanceInDirection(operations, 'anna', 'receivable')).toBe(250_000)
    expect(balancesByDebtor(operations).get('anna')).toEqual({
      receivable: 250_000,
      payable: 0,
    })
  })

  it('never nets the two directions of the same debtor', () => {
    const operations = [
      op({ id: '1', direction: 'receivable', kind: 'debt', amount: 500_000 }),
      op({ id: '2', direction: 'payable', kind: 'debt', amount: 200_000 }),
    ]

    const balances = balancesByDebtor(operations).get('anna')
    expect(balances).toEqual({ receivable: 500_000, payable: 200_000 })
    expect(totalsByDirection(operations)).toEqual({ receivable: 500_000, payable: 200_000 })
  })

  it('keeps directions independent across debtors (section totals)', () => {
    const operations = [
      op({ id: '1', debtorId: 'anna', direction: 'receivable', amount: 500_000 }),
      op({
        id: '2',
        debtorId: 'sergey',
        direction: 'receivable',
        kind: 'repayment',
        amount: 50_000,
      }),
      op({ id: '3', debtorId: 'sergey', direction: 'payable', amount: 200_000 }),
    ]

    expect(totalsByDirection(operations)).toEqual({ receivable: 450_000, payable: 200_000 })
  })

  it('allows over-repayment: the balance goes negative', () => {
    const operations = [
      op({ id: '1', kind: 'debt', amount: 500_000 }),
      op({ id: '2', kind: 'repayment', amount: 600_000 }),
    ]

    expect(balanceInDirection(operations, 'anna', 'receivable')).toBe(-100_000)
  })

  it('derives a zero balance for a fully repaid debtor (settled)', () => {
    const operations = [
      op({ id: '1', kind: 'debt', amount: 500_000 }),
      op({ id: '2', kind: 'repayment', amount: 500_000 }),
    ]

    expect(balanceInDirection(operations, 'anna', 'receivable')).toBe(0)
    expect(balancesByDebtor(operations).get('anna')).toEqual({ receivable: 0, payable: 0 })
  })

  it('ignores other debtors and other directions in a single lookup', () => {
    const operations = [
      op({ id: '1', debtorId: 'sergey', direction: 'receivable', amount: 999_999 }),
      op({ id: '2', debtorId: 'anna', direction: 'payable', amount: 777_777 }),
      op({ id: '3', debtorId: 'anna', direction: 'receivable', kind: 'debt', amount: 300_000 }),
    ]

    expect(balanceInDirection(operations, 'anna', 'receivable')).toBe(300_000)
  })
})
