// Zod schemas for the debts page forms (conventions forms.md §1): the amount
// stays a digit string; the schema only checks parseability to positive minor
// units - conversion happens once in the values→payload mappers (forms.md §4).

import { z } from 'zod'
import { nowIso } from '@trata/dates'
import { parseMajorUnitsToMinor } from '@/shared/lib/money/parse'

const amountField = z
  .string()
  .min(1, 'Введите сумму')
  .refine((value) => {
    const minor = parseMajorUnitsToMinor(value)
    return minor !== null && minor > 0
  }, 'Некорректная сумма')

export const operationSchema = z.object({
  kind: z.enum(['debt', 'repayment']),
  direction: z.enum(['receivable', 'payable']),
  debtorId: z.string().min(1, 'Выберите должника'),
  amount: amountField,
  occurredAt: z.string().min(1, 'Выберите дату'),
  note: z.string(),
})

export type OperationFormValues = z.infer<typeof operationSchema>

export function operationDefaultValues(
  overrides: Partial<OperationFormValues> = {},
): OperationFormValues {
  return {
    kind: 'debt',
    direction: 'receivable',
    debtorId: '',
    amount: '',
    occurredAt: nowIso(),
    note: '',
    ...overrides,
  }
}

export const debtorSchema = z.object({
  name: z.string().trim().min(1, 'Введите имя'),
  note: z.string(),
})

export type DebtorFormValues = z.infer<typeof debtorSchema>

// The combined per-section creation form (design D9): one submit creates a
// debtor and their initial debt; the direction comes from the section, not
// from form values.
export const debtorDebtSchema = z.object({
  name: z.string().trim().min(1, 'Введите имя'),
  amount: amountField,
  occurredAt: z.string().min(1, 'Выберите дату'),
  note: z.string(),
})

export type DebtorDebtFormValues = z.infer<typeof debtorDebtSchema>

export function debtorDebtDefaultValues(
  overrides: Partial<DebtorDebtFormValues> = {},
): DebtorDebtFormValues {
  return {
    name: '',
    amount: '',
    occurredAt: nowIso(),
    note: '',
    ...overrides,
  }
}
