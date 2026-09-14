// Pure selectors for the debts screen over the DOMAIN types from
// @trata/api: per-direction debtor sections with the settled
// partition and balance-descending sort, plus the day-grouped history of one
// debtor-direction ledger. Integer money math only (minor units); formatting
// happens only at the display edge (formatAmount).

import type {
  DebtDirection,
  DebtOperation,
  DebtOperationKind,
  Debtor,
  HouseholdMember,
} from '@trata/api'
import { calendarDayKey, fullDayLabel } from '@trata/dates'
import { formatAmount } from '@/shared/lib/format/format'
import { balancesByDebtor } from '@trata/local-data'
import { authorLabel } from '@/entities/household'

export interface DebtorBalanceView {
  debtor: Debtor
  /** Balance in the section's direction (may be negative on over-repayment). */
  balance: number
  balanceText: string
}

export interface DebtorSectionView {
  /** Nonzero balances, sorted by balance descending (ties by name). */
  visible: DebtorBalanceView[]
  /** Zero-balance (settled) debtors, hidden behind the reveal affordance. */
  settled: DebtorBalanceView[]
}

/**
 * One direction's debtor section: every debtor with at least one operation in
 * the direction, partitioned into visible (nonzero balance, sorted by balance
 * descending) and settled (zero balance, sorted by name).
 */
export function debtorSection(
  debtors: Debtor[],
  operations: DebtOperation[],
  direction: DebtDirection,
): DebtorSectionView {
  const balances = balancesByDebtor(operations)
  // Section membership requires operations in this direction: a payable-only
  // debtor has a 0 receivable balance in the map but never belongs in
  // «МНЕ ДОЛЖНЫ» (not even behind the reveal).
  const debtorsInDirection = new Set(
    operations.filter((op) => op.direction === direction).map((op) => op.debtorId),
  )
  const views: DebtorBalanceView[] = []

  for (const debtor of debtors) {
    if (!debtorsInDirection.has(debtor.id)) continue
    const balance = balances.get(debtor.id)?.[direction] ?? 0
    // The debtor's ledger is single-currency for life (debts capability):
    // rows always present the balance in the debtor's own currency.
    views.push({ debtor, balance, balanceText: formatAmount(balance, debtor.currency) })
  }

  const byBalanceDesc = (a: DebtorBalanceView, b: DebtorBalanceView) =>
    b.balance - a.balance || a.debtor.name.localeCompare(b.debtor.name, 'ru')
  const byName = (a: DebtorBalanceView, b: DebtorBalanceView) =>
    a.debtor.name.localeCompare(b.debtor.name, 'ru')

  return {
    visible: views.filter((view) => view.balance !== 0).sort(byBalanceDesc),
    settled: views.filter((view) => view.balance === 0).sort(byName),
  }
}

interface DebtHistoryRowView {
  id: string
  kind: DebtOperationKind
  /** Signed display text: debt grows («+»), repayment shrinks («−»). */
  amountText: string
  note: string
  /**
   * Compact authorship marker (household-ux 2.4); null renders nothing
   * (own/unknown author, single-member household).
   */
  authorLabel: string | null
}

/** Authorship context threaded from the screen (members cache + user id). */
export interface DebtAuthorContext {
  members: readonly HouseholdMember[]
  currentUserId: string | null | undefined
}

export interface DebtHistoryDayGroup {
  /** Local calendar date "2026-08-17"; stable key for testIDs. */
  key: string
  /** "17 августа" */
  title: string
  rows: DebtHistoryRowView[]
}

/**
 * Day-grouped operation history of one debtor-direction ledger, newest day
 * first, rows newest first within a day (the cashflow list-sheet grouping).
 */
export function debtorHistoryGroups(
  operations: DebtOperation[],
  debtorId: string,
  direction: DebtDirection,
  /** The debtor's (immutable) ledger currency: every amount is native. */
  currency: Debtor['currency'],
  author?: DebtAuthorContext,
): DebtHistoryDayGroup[] {
  const matching = operations
    .filter((op) => op.debtorId === debtorId && op.direction === direction)
    .sort((a, b) =>
      a.occurredAt !== b.occurredAt ? (a.occurredAt < b.occurredAt ? 1 : -1) : a.id < b.id ? 1 : -1,
    )

  const groups: DebtHistoryDayGroup[] = []
  for (const op of matching) {
    const key = calendarDayKey(new Date(op.occurredAt))
    const row: DebtHistoryRowView = {
      id: op.id,
      kind: op.kind,
      amountText: `${op.kind === 'debt' ? '+' : '−'}\u00A0${formatAmount(op.amount, currency)}`,
      note: op.note,
      authorLabel: author ? authorLabel(op.authorId, author.members, author.currentUserId) : null,
    }
    const current = groups[groups.length - 1]
    if (current?.key === key) current.rows.push(row)
    else groups.push({ key, title: fullDayLabel(op.occurredAt), rows: [row] })
  }
  return groups
}
