// Per-direction presentation for the debts screen: RU wording and testID
// stems, mirroring the cashflow-overview `kind.ts` pattern.
// TODO(i18n): RU strings are hardcoded until react-i18next is wired.

import type { DebtDirection, DebtOperationKind } from '@trata/api'

interface DebtDirectionCopy {
  /** Summary row label: «Мне должны» / «Я должен». */
  summaryLabel: string
  /** Section header: «Мне должны» / «Я должен». */
  sectionTitle: string
  /** Section empty state when nobody holds a nonzero balance. */
  sectionEmpty: string
  /** Combined contact+debt form title (design D9): «Кто должен» / «Кому должен». */
  sheetTitle: string
}

export const DEBT_DIRECTION_VIEWS: Record<DebtDirection, DebtDirectionCopy> = {
  receivable: {
    summaryLabel: 'Мне должны',
    sectionTitle: 'Мне должны',
    sectionEmpty: 'Вам никто не должен',
    sheetTitle: 'Кто должен',
  },
  payable: {
    summaryLabel: 'Я должен',
    sectionTitle: 'Я должен',
    sectionEmpty: 'Вы никому не должны',
    sheetTitle: 'Кому должен',
  },
}

/** Operation kind labels: «Долг» grows the owed amount, «Списание» shrinks it. */
export const DEBT_KIND_LABELS: Record<DebtOperationKind, string> = {
  debt: 'Долг',
  repayment: 'Списание',
}

/** Direction-neutral noun for a person the user tracks debts with (design D9). */
export const DEBTS_CONTACT_NOUN = 'Контакт'

export const DEBTS_COPY = {
  screenTitle: 'Долги',
  /** History sheet footer CTA (fixed-context operation form, Долг by default). */
  newOperation: 'Новая операция',
  historyEmpty: 'Операций пока нет',
  /** Over-repayment warning in the operation form (warn, never block). */
  overRepayment: (remaining: string) =>
    `Списание больше остатка долга (${remaining}). Баланс станет отрицательным.`,
} as const
