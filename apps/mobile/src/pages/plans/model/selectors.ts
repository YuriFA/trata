// Pure selectors for the plans screen over the DOMAIN types from
// @trata/api: per-type card figures (live count + normalized monthly
// aggregate), the next-due-ascending list order (overdue plans come
// first by construction), the overdue flag, and the name-or-category row
// title. Integer money math only (minor units); formatting happens only at
// the display edge. Multi-currency: a plan's amounts live in its account's
// currency (no plan currency field, design D8), so the card figure is a
// per-currency aggregate with the optional «≈» conversion (design D9).

import type { CalendarDay, Category, PlannedPayment, PlannedPaymentType } from '@trata/api'
import { fullDayLabel } from '@trata/dates'
import { monthlyTotal } from '@/entities/planned-payment'
import {
  aggregateByCurrency,
  aggregateHeroText,
  nativeCurrencyOf,
  type CurrencyAggregate,
  type MoneyPresentation,
} from '@/shared/lib/money/aggregate'
import { PLANS_COPY } from './kind'

export interface PlanCardFigures {
  /** Live plans of the type. */
  count: number
  /** Sum of the plans' monthly-normalized amounts, per currency + «≈». */
  monthly: CurrencyAggregate
}

export function plansFigures(
  plans: PlannedPayment[],
  type: PlannedPaymentType,
  presentation: MoneyPresentation,
): PlanCardFigures {
  const ofType = plans.filter((plan) => plan.type === type)
  return {
    count: ofType.length,
    monthly: aggregateByCurrency(
      ofType.map((plan) => ({
        currency: nativeCurrencyOf(plan, presentation),
        amount: monthlyTotal([plan]),
      })),
      presentation.displayCurrency,
      presentation.rates,
    ),
  }
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

/** Card figure: «1 099 ₽/мес» — the aggregate hero plus the monthly suffix. */
export function monthlyTotalText(monthly: CurrencyAggregate): string {
  // The hero ends in the display currency's symbol for the exact and
  // «≈»-converted figures; the per-month form swaps that symbol for
  // «₽/мес». The missing-rates per-currency join keeps its figures verbatim
  // and gains a plain «/мес».
  const hero = aggregateHeroText(monthly)
  return hero.endsWith('₽')
    ? `${hero.slice(0, -1).replace(/[\u00A0\u202F]$/, '')}\u00A0${PLANS_COPY.monthlySuffix}`
    : `${hero}\u00A0/мес`
}

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
