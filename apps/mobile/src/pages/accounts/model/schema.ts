import { z } from 'zod'
import { isCurrencyCode, type CurrencyCode } from '@trata/money'
import { parseMajorUnitsToMinor } from '@/shared/lib/money/parse'

// TODO(i18n): RU validation messages until mobile i18n wiring lands.
// Multi-currency (app-currency): the form offers the full 18-currency
// catalog and submits the chosen currency with the created account.
export const newAccountSchema = z.object({
  name: z.string().trim().min(1, 'Введите название счёта'),
  currency: z.custom<CurrencyCode>((value) => isCurrencyCode(value), 'Выберите валюту'),
  openingBalance: z
    .string()
    .refine((value) => parseMajorUnitsToMinor(value) !== null, 'Некорректная сумма'),
})

export type NewAccountFormValues = z.infer<typeof newAccountSchema>
