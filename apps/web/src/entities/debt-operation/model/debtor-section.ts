// Per-debtor balance views shared by the debts page and the dashboard card:
// balances always derive from the operation history (debts capability) -
// never stored, never netted across directions.

import type { Debtor } from '@trata/api'
import { balanceInDirection } from '@trata/local-data'
import type { CurrencyBucket } from '@/shared/lib/money'
import type { DebtDirection, DebtOperation } from './types'

interface DebtorView {
  debtor: Debtor
  balance: number
}

interface DebtorSectionViews {
  /** Nonzero balances, sorted by balance desc, ties by name. */
  visible: DebtorView[]
  /** Zero balances (settled), sorted by name. */
  settled: DebtorView[]
}

/**
 * One direction's debtor list. Membership requires at least one operation in
 * that direction - a payable-only debtor never appears under «Owed to me»,
 * not even settled. No netting across directions.
 */
export function debtorSection(
  debtors: readonly Debtor[],
  operations: readonly DebtOperation[],
  direction: DebtDirection,
): DebtorSectionViews {
  const inDirection = new Set(
    operations.filter((operation) => operation.direction === direction).map((op) => op.debtorId),
  )
  const visible: DebtorView[] = []
  const settled: DebtorView[] = []
  for (const debtor of debtors) {
    if (!inDirection.has(debtor.id)) continue
    const balance = balanceInDirection(operations, debtor.id, direction)
    ;(balance === 0 ? settled : visible).push({ debtor, balance })
  }
  visible.sort((a, b) => b.balance - a.balance || a.debtor.name.localeCompare(b.debtor.name))
  settled.sort((a, b) => a.debtor.name.localeCompare(b.debtor.name))
  return { visible, settled }
}

/** Initials of the first and last word, uppercased; '?' for an empty name. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  const first = words[0]![0]!
  const last = words.length > 1 ? words[words.length - 1]![0]! : ''
  return (first + last).toUpperCase()
}

interface DebtorBalanceRow {
  debtor: Debtor
  direction: DebtDirection
  balance: number
}

/**
 * Dashboard-card rows: every debtor+direction pair with a nonzero balance,
 * largest absolute balance first (ties by name). A debtor active in both
 * directions renders as two rows - directions are never netted.
 */
export function debtorBalanceRows(
  debtors: readonly Debtor[],
  operations: readonly DebtOperation[],
): DebtorBalanceRow[] {
  const rows: DebtorBalanceRow[] = (['receivable', 'payable'] as const).flatMap((direction) =>
    debtorSection(debtors, operations, direction).visible.map((view) => ({
      debtor: view.debtor,
      direction,
      balance: view.balance,
    })),
  )
  return rows.sort(
    (a, b) =>
      Math.abs(b.balance) - Math.abs(a.balance) || a.debtor.name.localeCompare(b.debtor.name),
  )
}

/**
 * Native-currency buckets for one direction (multi-currency design D9):
 * each debtor's derived balance stays in the debtor's own (immutable)
 * currency. Feeds `aggregateByCurrency` for the per-currency + «≈»
 * presentation of the direction totals - sums never cross currencies.
 */
export function directionBucketsByCurrency(
  debtors: readonly Debtor[],
  operations: readonly DebtOperation[],
  direction: DebtDirection,
): CurrencyBucket[] {
  return debtorSection(debtors, operations, direction).visible.map(({ debtor, balance }) => ({
    currency: debtor.currency,
    amount: balance,
  }))
}

/**
 * Per-debtor net buckets (receivable − payable) in the debtor's currency -
 * the dashboard tile's figure; within one currency the net is meaningful
 * because a debtor's ledger is single-currency for life.
 */
export function netBucketsByCurrency(
  debtors: readonly Debtor[],
  operations: readonly DebtOperation[],
): CurrencyBucket[] {
  return debtors.flatMap((debtor) => {
    const receivable = balanceInDirection(operations, debtor.id, 'receivable')
    const payable = balanceInDirection(operations, debtor.id, 'payable')
    if (receivable === 0 && payable === 0) return []
    return [{ currency: debtor.currency, amount: receivable - payable }]
  })
}
