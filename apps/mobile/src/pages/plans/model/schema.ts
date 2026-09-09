// Zod schema for the plans add/edit form (conventions forms.md §2): one
// discriminated union on the immutable `type` fixed from the tapped card; the
// amount stays a digit string that the schema only checks for parseability to
// positive minor units — the single conversion happens in the named
// values→payload mappers (forms.md §4). `nextDue` is a calendar day; past
// dates are legal (a plan may start already overdue).

import { z } from 'zod'
import { calendarDayKey } from '@trata/dates'
import type {
  CreatePlannedPaymentPayload,
  PlannedPayment,
  PlannedPaymentType,
  UpdatePlannedPaymentPayload,
} from '@trata/api'
import { minorToInputValue } from '@/shared/lib/money/display'
import { parseMajorUnitsToMinor } from '@/shared/lib/money/parse'

const CALENDAR_DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

const amountField = z
  .string()
  .min(1, 'Введите сумму')
  .refine((value) => {
    const minor = parseMajorUnitsToMinor(value)
    return minor !== null && minor > 0
  }, 'Некорректная сумма')

const planFormShape = {
  amount: amountField,
  // Optional: an empty string means an unnamed plan (never an error).
  name: z.string(),
  accountId: z.string().min(1, 'Выберите счёт'),
  categoryId: z.string().min(1, 'Выберите категорию'),
  nextDue: z
    .string()
    .min(1, 'Выберите дату')
    .refine((value) => CALENDAR_DAY_PATTERN.test(value), 'Некорректная дата'),
  regularity: z.enum(['daily', 'weekly', 'monthly', 'yearly']),
  confirmMode: z.enum(['manual', 'auto']),
  reminder: z.enum(['off', 'day_before', 'on_day']),
  note: z.string(),
}

export const planFormSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('expense'), ...planFormShape }),
  z.object({ type: z.literal('income'), ...planFormShape }),
])

export type PlanFormValues = z.infer<typeof planFormSchema>

export function planFormDefaultValues(
  type: PlannedPaymentType,
  overrides: Partial<Omit<PlanFormValues, 'type'>> = {},
): PlanFormValues {
  return {
    type,
    amount: '',
    name: '',
    accountId: '',
    categoryId: '',
    // Today is only the starting point — the calendar has no lower bound.
    nextDue: calendarDayKey(new Date()),
    // The overwhelmingly common case leads (design D7).
    regularity: 'monthly',
    confirmMode: 'manual',
    reminder: 'off',
    note: '',
    ...overrides,
  }
}

export function toCreatePayload(values: PlanFormValues): CreatePlannedPaymentPayload {
  return {
    type: values.type,
    // The schema's refine guarantees parseability; the fallback only
    // satisfies the parser's `number | null` return type.
    amount: parseMajorUnitsToMinor(values.amount) ?? 0,
    name: values.name.trim(),
    note: values.note.trim(),
    accountId: values.accountId,
    categoryId: values.categoryId,
    nextDue: values.nextDue,
    regularity: values.regularity,
    confirmMode: values.confirmMode,
    reminder: values.reminder,
  }
}

/**
 * The edit form always carries the full field state: an untouched value
 * re-sends the same string, an emptied name/note clears it (D3).
 */
export function toUpdatePayload(
  values: PlanFormValues,
  version: number,
): UpdatePlannedPaymentPayload {
  return {
    version,
    amount: parseMajorUnitsToMinor(values.amount) ?? 0,
    name: values.name.trim(),
    note: values.note.trim(),
    accountId: values.accountId,
    categoryId: values.categoryId,
    nextDue: values.nextDue,
    regularity: values.regularity,
    confirmMode: values.confirmMode,
    reminder: values.reminder,
  }
}

// Manual-confirmation form: the account and category are fixed context from
// the plan (static rows in the sheet); the amount, the occurrence date, and
// the note are editable.
export const confirmPlanSchema = z.object({
  amount: amountField,
  /** Calendar day the confirmed payment occurred on. */
  occurredOn: z
    .string()
    .min(1, 'Выберите дату')
    .refine((value) => CALENDAR_DAY_PATTERN.test(value), 'Некорректная дата'),
  note: z.string(),
})

export type ConfirmPlanFormValues = z.infer<typeof confirmPlanSchema>

export function confirmPlanDefaultValues(plan: PlannedPayment): ConfirmPlanFormValues {
  return {
    amount: minorToInputValue(plan.amount),
    // The occurrence's scheduled date is the default (spec: manual
    // confirmation); the note prefills with the plan's name so an untouched
    // submit keeps the note-equals-plan-name rule.
    occurredOn: plan.nextDue,
    note: plan.name,
  }
}
