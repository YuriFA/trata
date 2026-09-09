import { z } from 'zod'
import { nowIso } from '@trata/dates'
import { parseMajorUnitsToMinor } from '@/shared/lib/money/parse'

// TODO(i18n): RU validation messages until mobile i18n wiring lands.
export type TransactionFlowKind = 'expense' | 'income' | 'transfer'

// Today's guard carried over verbatim (design D6): parseable AND at least
// 1 minor unit.
const amountField = z
  .string()
  .min(1, 'Введите сумму')
  .refine((value) => {
    const parsedAmount = parseMajorUnitsToMinor(value)
    return parsedAmount !== null && parsedAmount >= 1
  }, 'Некорректная сумма')

// The note is free-form and optional; the date is always constructed by the
// date controls (quick chips or calendar), never free-typed, so it carries no
// format validation of its own.
const noteField = z.string()
const occurredAtField = z.string().min(1)

export const createTransactionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('expense'),
    amount: amountField,
    description: noteField,
    occurredAt: occurredAtField,
    accountId: z.string().min(1, 'Выберите счёт'),
    categoryId: z.string().min(1, 'Выберите категорию'),
  }),
  z.object({
    kind: z.literal('income'),
    amount: amountField,
    description: noteField,
    occurredAt: occurredAtField,
    accountId: z.string().min(1, 'Выберите счёт'),
    categoryId: z.string().min(1, 'Выберите категорию'),
  }),
  z.object({
    kind: z.literal('transfer'),
    amount: amountField,
    description: noteField,
    occurredAt: occurredAtField,
    fromAccountId: z.string().min(1, 'Выберите счёт списания'),
    toAccountId: z.string().min(1, 'Выберите счёт зачисления'),
  }),
])

export type CreateTransactionFormValues = z.infer<typeof createTransactionSchema>

/**
 * One complete variant for a flow kind; call fresh so `occurredAt` is "now".
 * `defaultCategoryId` preselects the category for expense/income flows (e.g.
 * when creating from inside a category's expense sheet); transfers ignore it.
 */
export function createTransactionDefaultValues(
  kind: TransactionFlowKind,
  defaultCategoryId?: string,
): CreateTransactionFormValues {
  const base = { amount: '', description: '', occurredAt: nowIso() }
  const categoryId = defaultCategoryId ?? ''
  switch (kind) {
    case 'transfer':
      return { kind, ...base, fromAccountId: '', toAccountId: '' }
    case 'income':
      return { kind, ...base, accountId: '', categoryId }
    case 'expense':
      return { kind, ...base, accountId: '', categoryId }
  }
}
