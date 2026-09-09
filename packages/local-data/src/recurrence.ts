// Recurrence math (design D2): the TS twin of the backend's
// `domain.AdvanceNextDue`. Both implementations are pinned by the same
// table-driven vectors (clamp-and-recover: Jan 31 → Feb 28/29 → Mar 31), so a
// locally confirmed plan and the server's auto job compute identical series.
// Plain UTC `Date` arithmetic — no date-fns (facade rule).

import type { CalendarDay, PlannedPayment, PlannedPaymentRegularity } from '@trata/api'

const MS_PER_DAY = 86_400_000
const MONTHS_PER_YEAR = 12

/** Days in a (0-indexed) UTC month — the clamp bound for short months. */
function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate()
}

function toUtcMidnight(day: CalendarDay): Date {
  return new Date(`${day}T00:00:00Z`)
}

function toCalendarDay(date: Date): CalendarDay {
  return date.toISOString().slice(0, 10)
}

/** Clamps `day` into the target month, mirroring the Go `clampDay`. */
function clampDay(day: number, year: number, monthIndex: number): number {
  return Math.min(day, daysInMonth(year, monthIndex))
}

/**
 * The occurrence date that follows `nextDue`, computed from the anchor per
 * the regularity: monthly keeps the anchor's day-of-month (clamped to the
 * target month's length, recovering afterwards), weekly keeps the weekday,
 * yearly keeps the anchor's month-and-day (Feb 29 clamps to Feb 28 in
 * non-leap years). The anchor never moves — advancement must not poison it.
 */
export function advanceNextDue(
  nextDue: CalendarDay,
  anchor: CalendarDay,
  regularity: PlannedPaymentRegularity,
): CalendarDay {
  const next = toUtcMidnight(nextDue)
  const anchorDate = toUtcMidnight(anchor)

  switch (regularity) {
    case 'daily':
      return toCalendarDay(new Date(next.getTime() + MS_PER_DAY))
    case 'weekly':
      return toCalendarDay(new Date(next.getTime() + 7 * MS_PER_DAY))
    case 'yearly': {
      const year = next.getUTCFullYear() + 1
      const month = anchorDate.getUTCMonth()
      return toCalendarDay(
        new Date(Date.UTC(year, month, clampDay(anchorDate.getUTCDate(), year, month))),
      )
    }
    case 'monthly':
    default: {
      let year = next.getUTCFullYear()
      let month = next.getUTCMonth() + 1
      if (month > 11) {
        month = 0
        year += 1
      }
      return toCalendarDay(
        new Date(Date.UTC(year, month, clampDay(anchorDate.getUTCDate(), year, month))),
      )
    }
  }
}

/**
 * Normalized monthly figure of one plan's amount (integer minor units):
 * monthly as-is, yearly ÷12, weekly ×52/12, daily ×365/12 — rounded half-up.
 * The card total is the sum over live plans; display formats via
 * `formatAmount`, never a float in between.
 */
export function monthlyAmount(amount: number, regularity: PlannedPaymentRegularity): number {
  switch (regularity) {
    case 'monthly':
      return amount
    case 'yearly':
      return Math.round(amount / MONTHS_PER_YEAR)
    case 'weekly':
      return Math.round((amount * 52) / MONTHS_PER_YEAR)
    case 'daily':
      return Math.round((amount * 365) / MONTHS_PER_YEAR)
  }
}

/** Sum of the normalized monthly figures of the given plans. */
export function monthlyTotal(
  plans: ReadonlyArray<Pick<PlannedPayment, 'amount' | 'regularity'>>,
): number {
  return plans.reduce((total, plan) => total + monthlyAmount(plan.amount, plan.regularity), 0)
}
