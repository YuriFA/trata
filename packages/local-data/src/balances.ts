// Pure balance derivation over the local debt-operation set (debts
// capability: balances are never stored). Per-debtor per-direction sums with
// no netting across directions; integer minor units end to end - formatting
// happens only at the display edge.

import type { DebtDirection, DebtOperation } from '@trata/api'

/** A debtor's balances in the two independent directions. */
export interface DirectionBalances {
  receivable: number
  payable: number
}

/** Balance of one debtor in one direction: Σ debt − Σ repayment. */
export function balanceInDirection(
  operations: readonly DebtOperation[],
  debtorId: string,
  direction: DebtDirection,
): number {
  return operations.reduce((sum, op) => {
    if (op.debtorId !== debtorId || op.direction !== direction) return sum
    return op.kind === 'debt' ? sum + op.amount : sum - op.amount
  }, 0)
}

/** Per-debtor balances in both directions; debtors with no operations are absent. */
export function balancesByDebtor(operations: readonly DebtOperation[]): Map<string, DirectionBalances> {
  const balances = new Map<string, DirectionBalances>()
  for (const op of operations) {
    const current = balances.get(op.debtorId) ?? { receivable: 0, payable: 0 }
    const key = op.direction
    current[key] = op.kind === 'debt' ? current[key] + op.amount : current[key] - op.amount
    balances.set(op.debtorId, current)
  }
  return balances
}

/** Direction totals: the sum of every debtor's balance in each direction. */
export function totalsByDirection(operations: readonly DebtOperation[]): DirectionBalances {
  const totals: DirectionBalances = { receivable: 0, payable: 0 }
  for (const op of operations) {
    totals[op.direction] =
      op.kind === 'debt' ? totals[op.direction] + op.amount : totals[op.direction] - op.amount
  }
  return totals
}
