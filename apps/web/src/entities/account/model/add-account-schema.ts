import z from 'zod'
import i18n from '@/shared/i18n'
import { isCurrencyCode } from '@trata/money'
import type { CurrencyCode } from '@/shared/lib/money'

export interface AddAccountFormValues {
  name: string
  openingBalance: number
  /** The creation currency (immutable after creation, accounts capability). */
  currency: CurrencyCode
}

export const createAddAccountSchema = () => {
  const { t } = i18n.global
  const currencyMessage = t('validation.select', { field: t('fields.currency') })

  return z.object({
    name: z
      .string({ error: t('validation.enter', { field: t('fields.name') }) })
      .min(1, t('validation.enter', { field: t('fields.name') })),
    openingBalance: z
      .number({ error: t('validation.enter', { field: t('fields.openingBalance') }) })
      .nonnegative(t('validation.mustBeNonNegative', { field: t('fields.openingBalance') })),
    // The creation currency is part of the form model again (multi-currency):
    // validated against the supported catalog, never passed through blindly.
    currency: z.custom<CurrencyCode>(isCurrencyCode, currencyMessage),
  })
}
