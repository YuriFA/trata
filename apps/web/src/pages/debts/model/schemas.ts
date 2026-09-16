// Zod schema factories for the debts dialogs (validation messages resolve
// `t()` at form mount - web form convention 3). Amount is majors inside the
// form and converts to minor units exactly once in the submit handler.

import z from 'zod'
import i18n from '@/shared/i18n'
import { isCurrencyCode } from '@trata/money'
import type { CurrencyCode } from '@/shared/lib/money'

export interface OperationFormValues {
  kind: 'debt' | 'repayment'
  amount: number
  occurredAt: string
}

export interface DebtorDebtFormValues {
  name: string
  /** The immutable ledger currency, sent with the debtor create payload. */
  currency: CurrencyCode
  amount: number
  occurredAt: string
}

export interface RenameDebtorFormValues {
  name: string
}

export const createOperationSchema = () => {
  const { t } = i18n.global
  return z.object({
    kind: z.enum(['debt', 'repayment']),
    amount: z
      .number({ error: t('validation.enter', { field: t('fields.amount') }) })
      .positive(t('validation.mustBePositive', { field: t('fields.amount') })),
    occurredAt: z.string().min(1, t('validation.select', { field: t('fields.date') })),
  })
}

export const createDebtorDebtSchema = () => {
  const { t } = i18n.global
  return z.object({
    name: z
      .string()
      .trim()
      .min(1, t('validation.enter', { field: t('fields.name') })),
    // The debtor's immutable ledger currency (debts capability): validated
    // against the supported catalog, sent with the create payload.
    currency: z.custom<CurrencyCode>(
      isCurrencyCode,
      t('validation.select', { field: t('fields.currency') }),
    ),
    amount: z
      .number({ error: t('validation.enter', { field: t('fields.amount') }) })
      .positive(t('validation.mustBePositive', { field: t('fields.amount') })),
    occurredAt: z.string().min(1, t('validation.select', { field: t('fields.date') })),
  })
}

export const createRenameDebtorSchema = () => {
  const { t } = i18n.global
  return z.object({
    name: z
      .string()
      .trim()
      .min(1, t('validation.enter', { field: t('fields.name') })),
  })
}
