// Per-type presentation for the plans screen: RU wording, mirroring the
// debts `kind.ts` pattern (openspec planned-payments + mobile-local-data
// "Plans screen data behavior").
// TODO(i18n): RU strings are hardcoded until react-i18next is wired.

import type {
  PlannedPaymentConfirmMode,
  PlannedPaymentRegularity,
  PlannedPaymentReminder,
  PlannedPaymentType,
} from '@trata/api'

interface PlanTypeCopy {
  /** Card title and per-type list sheet title: «Расходы» / «Доходы». */
  cardTitle: string
  /** Card description: «Подписки, платежи по кредитам и прочее». */
  cardDescription: string
  /** Bottom list-sheet CTA and the add form's submit label. */
  addAction: string
  /** Add form sheet title; the type is fixed from the card (design D7). */
  addTitle: string
  /** Edit form sheet title. */
  editTitle: string
  /** Required account field: «Счёт списания» / «Счёт зачисления». */
  accountLabel: string
}

export const PLAN_TYPE_VIEWS: Record<PlannedPaymentType, PlanTypeCopy> = {
  expense: {
    cardTitle: 'Расходы',
    cardDescription: 'Подписки, платежи по кредитам и прочее',
    addAction: 'Добавить расход',
    addTitle: 'Новый расход',
    editTitle: 'Расход',
    accountLabel: 'Счёт списания',
  },
  income: {
    cardTitle: 'Доходы',
    cardDescription: 'Зарплата, премии и прочее',
    addAction: 'Добавить доход',
    addTitle: 'Новый доход',
    editTitle: 'Доход',
    accountLabel: 'Счёт зачисления',
  },
}

/** Regularity option-sheet labels: «Каждый месяц» (design D7). */
export const PLANS_REGULARITY_OPTIONS: Record<PlannedPaymentRegularity, string> = {
  daily: 'Каждый день',
  weekly: 'Каждую неделю',
  monthly: 'Каждый месяц',
  yearly: 'Каждый год',
}

/** Regularity row phrases: «каждый месяц» (design D7). */
export const PLANS_REGULARITY_PHRASES: Record<PlannedPaymentRegularity, string> = {
  daily: 'каждый день',
  weekly: 'каждую неделю',
  monthly: 'каждый месяц',
  yearly: 'каждый год',
}

/** Confirmation-mode option labels: ручное / авто. */
export const PLANS_CONFIRM_MODE_LABELS: Record<PlannedPaymentConfirmMode, string> = {
  manual: 'Ручное',
  auto: 'Авто',
}

/** Confirmation-mode option captions (rendered under the option label). */
export const PLANS_CONFIRM_MODE_DESCRIPTIONS: Record<PlannedPaymentConfirmMode, string> = {
  manual: 'Платёж создаётся по подтверждению',
  auto: 'Платёж создаётся автоматически',
}

/** Reminder option labels: выкл / за день / в день. */
export const PLANS_REMINDER_LABELS: Record<PlannedPaymentReminder, string> = {
  off: 'Выкл',
  day_before: 'За день',
  on_day: 'В день',
}

export const PLANS_COPY = {
  screenTitle: 'Планы',
  /** Card figure suffix: «… ₽/мес». */
  monthlySuffix: '₽/мес',
  overdueBadge: 'Просрочен',
  listEmpty: 'Планов пока нет',
  confirmTitle: 'Подтвердить платёж',
  confirmAmountLabel: 'Сумма',
  confirmSubmit: 'Подтвердить',
  deleteTitle: 'Удалить план?',
} as const

/** Live plan count with the RU plural: «1 план» / «2 плана» / «5 планов». */
export function planCountLabel(count: number): string {
  // TODO(i18n): RU plural rules until mobile i18n wiring lands.
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) return `${count} план`
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${count} плана`
  return `${count} планов`
}
