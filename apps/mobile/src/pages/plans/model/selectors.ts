// Pure selectors for the plans screen over the DOMAIN types from
// @trata/api: per-type card figures (live count + normalized
// monthly total), the next-due-ascending list order (overdue plans come
// first by construction), the overdue flag, and the name-or-category row
// title. Integer money math only (minor units); formatting happens only at
// the display edge (formatAmount).

import type { CalendarDay, Category, PlannedPayment, PlannedPaymentType } from '@trata/api'
import { fullDayLabel } from '@trata/dates'
import { monthlyTotal } from '@/entities/planned-payment'
import { formatAmount } from '@/shared/lib/format/format'
import { PLANS_COPY } from './kind'

export interface PlanCardFigures {
  /** Live plans of the type. */
  count: number
  /** Sum of the plans' normalized monthly amounts (minor units). */
  monthlyTotal: number
}

export function plansFigures(plans: PlannedPayment[], type: PlannedPaymentType): PlanCardFigures {
  const ofType = plans.filter((plan) => plan.type === type)
  return { count: ofType.length, monthlyTotal: monthlyTotal(ofType) }
}

/**
 * Next-due ascending (ties by id for stability): overdue plans carry the
 * earliest dates, so they sort first by construction.
 */
export function plansSortedByNextDue(plans: PlannedPayment[]): PlannedPayment[] {
  return [...plans].sort((a, b) =>
    a.nextDue !== b.nextDue ? (a.nextDue < b.nextDue ? -1 : 1) : a.id < b.id ? -1 : 1,
  )
}

/**
 * An occurrence is due once its scheduled calendar day has arrived, so a
 * due-today plan is already overdue. `today` is the USER'S local calendar
 * day (the visible day boundary - `calendarDayKey`); the server's
 * auto-confirm job keeps its own UTC day boundary (design D2: it has no
 * user timezone).
 */
export function isPlanOverdue(plan: PlannedPayment, today: CalendarDay): boolean {
  return plan.nextDue <= today
}

/** Row title: the plan's name, or its category's name when unnamed. */
export function planRowTitle(plan: PlannedPayment, categories: Category[]): string {
  if (plan.name !== '') return plan.name
  return categories.find((category) => category.id === plan.categoryId)?.name ?? ''
}

/** Local-midnight construction keeps the label on the picked day itself. */
export function nextDueLabel(day: CalendarDay): string {
  return fullDayLabel(new Date(`${day}T00:00:00`))
}

/** Card figure: «1 099 ₽/мес» — the compact amount plus the monthly suffix. */
export function monthlyTotalText(amountMinor: number): string {
  // formatAmount already suffixes «₽»; swap it for the per-month form.
  const compact = formatAmount(amountMinor).replace(/[\u00A0\u202F]₽$/, '')
  return `${compact}\u00A0${PLANS_COPY.monthlySuffix}`
}
