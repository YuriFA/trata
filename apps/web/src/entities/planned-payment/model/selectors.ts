// Pure view-model helpers for plan lists, ported from the mobile page
// selectors. Overdue is a UTC-day comparison against the plan's next-due
// calendar day (planned-payments capability); advancement math itself lives
// in the package (advanceNextDue) - the web adds no recurrence logic.

import type { Category } from '@trata/api'
import type { PlannedPayment } from './types'
import { fullDayLabel } from '@trata/dates'

/** Next-due ascending (overdue plans first by construction); ties by id. */
export function plansSortedByNextDue(plans: readonly PlannedPayment[]): PlannedPayment[] {
  return [...plans].sort((a, b) => a.nextDue.localeCompare(b.nextDue) || a.id.localeCompare(b.id))
}

/**
 * Whether the plan's next occurrence is overdue. `today` is the USER'S
 * local calendar day (the visible day boundary - `currentDay()`); the
 * server's auto-confirm job keeps its own UTC day boundary (design D2:
 * it has no user timezone). "Due" means the scheduled calendar day has
 * arrived, so a due-today plan is already overdue.
 */
export function isPlanOverdue(plan: PlannedPayment, today: string): boolean {
  return plan.nextDue <= today
}

/** The row title: the plan's name, or the category's name when unnamed. */
export function planRowTitle(plan: PlannedPayment, categories: readonly Category[]): string {
  if (plan.name) return plan.name
  return categories.find((category) => category.id === plan.categoryId)?.name ?? ''
}

/** Locale label of a next-due calendar day («17 августа»). */
export function nextDueLabel(day: string, locale: string): string {
  return fullDayLabel(new Date(`${day}T00:00:00`), locale)
}
