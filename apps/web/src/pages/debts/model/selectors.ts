// Pure view-model helpers for the debts screen, ported from the mobile page
// selectors. The per-debtor balance views (sections, initials) live in the
// debt-operation entity - the dashboard debts card is their second consumer;
// only the history helpers stay page-local. Balances derive from the
// operation history via the package's balance helpers (never stored) - the
// debts capability's core rule.

import { calendarDayKey, fullDayLabel } from '@trata/dates'
import type { DebtDirection, DebtOperation } from '@/entities/debt-operation'

export { debtorSection, initialsOf } from '@/entities/debt-operation'

export interface DebtorHistoryGroup {
  key: string
  title: string
  operations: DebtOperation[]
}

/** Day-grouped operation history of one debtor+direction, newest first. */
export function debtorHistoryGroups(
  operations: readonly DebtOperation[],
  debtorId: string,
  direction: DebtDirection,
  locale: string,
): DebtorHistoryGroup[] {
  const own = operations
    .filter((op) => op.debtorId === debtorId && op.direction === direction)
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || b.id.localeCompare(a.id))
  const byDay = new Map<string, DebtOperation[]>()
  for (const operation of own) {
    const key = calendarDayKey(new Date(operation.occurredAt))
    byDay.set(key, [...(byDay.get(key) ?? []), operation])
  }
  return [...byDay.entries()].map(([key, dayOperations]) => ({
    key,
    title: fullDayLabel(new Date(dayOperations[0]!.occurredAt), locale),
    operations: dayOperations,
  }))
}

/** The debtor's latest operation timestamp in one direction (null when none). */
export function lastOperationAt(
  operations: readonly DebtOperation[],
  debtorId: string,
  direction: DebtDirection,
): string | null {
  const own = operations.filter(
    (operation) => operation.debtorId === debtorId && operation.direction === direction,
  )
  if (own.length === 0) return null
  return own.reduce(
    (latest, operation) => (operation.occurredAt > latest ? operation.occurredAt : latest),
    own[0]!.occurredAt,
  )
}
