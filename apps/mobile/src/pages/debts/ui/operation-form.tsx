// The debt-operation form (edit + fixed-context create variants, conventions
// forms.md §2/§3): static «Контакт» / «Направление» context rows, the Долг ↔
// Списание kind switch (create mode), keypad-only amount, and the one-row
// action toolbar with expandable quick dates and note (design D9). The create
// entry point is a contact's history sheet, so the contact and direction are
// always fixed context. The amount stays a digit string in form values; the
// named mappers convert to int64 minor units exactly once at the submission
// boundary (forms.md §4). Edit mode carries the record's CAS `version`;
// direction/kind/debtor are immutable server-side, so they render as static
// context rows.
//
// The root owns the form lifecycle and submission. Field sections subscribe
// to their own slice through useFormContext; the over-repayment warning reads
// the live amount, kind, and debtor selection in one isolated subscriber.

import { useEffect, useMemo } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { FormProvider, useController, useForm, useFormContext, useWatch } from 'react-hook-form'
import { Alert, View } from 'react-native'
import type { DebtDirection, DebtOperation, DebtOperationRepository } from '@trata/api'
import { AmountKeypad, applyKeypadInput, type KeypadKey } from '@/features/create-transaction'
import {
  useCreateDebtOperation,
  useDeleteDebtOperation,
  useDebtors,
  useDebtOperations,
  useUpdateDebtOperation,
} from '@/entities/debt'
import { balanceInDirection } from '@trata/local-data'
import { getRepositoryErrorText } from '@/shared/lib/data/repository-errors-ru'
import { formatAmount } from '@/shared/lib/format/format'
import { parseMajorUnitsToMinor } from '@/shared/lib/money/parse'
import { minorToInputValue } from '@/shared/lib/money/display'
import { BottomSheetHeader } from '@/shared/ui/bottom-sheet'
import { FormError } from '@/shared/ui/form'
import { IconButton } from '@/shared/ui/icon-button'
import { Pressable } from '@/shared/ui/pressable'
import { Text } from '@/shared/ui/text'
import { cn } from '@/shared/lib/utils'
import {
  DEBTS_CONTACT_NOUN,
  DEBTS_COPY,
  DEBT_DIRECTION_VIEWS,
  DEBT_KIND_LABELS,
} from '../model/kind'
import { operationDefaultValues, operationSchema, type OperationFormValues } from '../model/schema'
import { DebtsFormActions } from './form-actions'

interface FixedContext {
  debtorId: string
  direction: DebtDirection
}

/** Either an edit (operation given) or a fixed-context create (design D9). */
export type OperationFormProps =
  | { operation: DebtOperation; fixed?: never; onSuccess: () => void }
  | { operation?: undefined; fixed: FixedContext; onSuccess: () => void }

function toCreatePayload(
  values: OperationFormValues,
): Parameters<DebtOperationRepository['create']>[0] {
  return {
    debtorId: values.debtorId,
    direction: values.direction,
    kind: values.kind,
    // The schema's refine guarantees parseability; the fallback only
    // satisfies the parser's `number | null` return type.
    amount: parseMajorUnitsToMinor(values.amount) ?? 0,
    note: values.note.trim(),
    occurredAt: values.occurredAt,
  }
}

function toUpdatePayload(
  values: OperationFormValues,
  version: number,
): Parameters<DebtOperationRepository['update']>[1] {
  return {
    version,
    amount: parseMajorUnitsToMinor(values.amount) ?? 0,
    note: values.note.trim(),
    occurredAt: values.occurredAt,
  }
}

/** Two-option segmented control (the transaction type-switch idiom). */
function SegmentedSwitch<T extends string>({
  options,
  value,
  onChange,
  testIDPrefix,
}: {
  options: Array<{ value: T; label: string }>
  value: T
  onChange: (value: T) => void
  testIDPrefix: string
}) {
  return (
    <View className="flex-row rounded-xl bg-muted p-1" testID={testIDPrefix}>
      {options.map((option) => {
        const active = option.value === value
        return (
          <Pressable
            key={option.value}
            testID={`${testIDPrefix}-${option.value}`}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            className={cn(
              'flex-1 items-center rounded-lg py-2',
              active ? 'bg-card shadow-sm' : undefined,
            )}
            onPress={() => onChange(option.value)}
          >
            <Text
              variant="body-sm"
              className={cn('font-medium', active ? 'text-foreground' : 'text-muted-foreground')}
            >
              {option.label}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}

/** Static context row for immutable fields. */
function StaticRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-center justify-between py-2">
      <Text variant="body-sm" className="text-muted-foreground">
        {label}
      </Text>
      <Text variant="body" className="text-foreground" numberOfLines={1}>
        {value}
      </Text>
    </View>
  )
}

/** The Долг ↔ Списание kind switch (create mode only). */
function KindFields() {
  const { control, setValue } = useFormContext<OperationFormValues>()
  const kind = useWatch({ control, name: 'kind' })

  return (
    <SegmentedSwitch
      testIDPrefix="debts-operation-kind"
      value={kind}
      onChange={(next) => setValue('kind', next, { shouldValidate: true })}
      options={[
        { value: 'debt', label: DEBT_KIND_LABELS.debt },
        { value: 'repayment', label: DEBT_KIND_LABELS.repayment },
      ]}
    />
  )
}

/** The amount display (keypad-driven) with its validation error. */
function AmountField() {
  const { control } = useFormContext<OperationFormValues>()
  const { field, fieldState } = useController({ name: 'amount', control })

  return (
    <View className="gap-1 pt-2">
      <Text variant="h1" className="text-center text-foreground" testID="debts-operation-amount">
        {field.value ? field.value.replace('.', ',') : '0'}
      </Text>
      <FormError testID="debts-operation-amount-error">{fieldState.error?.message}</FormError>
    </View>
  )
}

/**
 * Over-repayment warning (isolated subscriber): fires when a repayment's
 * parsed amount exceeds the debtor's remaining balance in the direction.
 * Warns only - the operation is accepted (debts capability D2).
 */
function OverRepaymentWarning() {
  const { control } = useFormContext<OperationFormValues>()
  const kind = useWatch({ control, name: 'kind' })
  const debtorId = useWatch({ control, name: 'debtorId' })
  const direction = useWatch({ control, name: 'direction' })
  const amount = useWatch({ control, name: 'amount' })
  const operations = useDebtOperations().data ?? []

  if (kind !== 'repayment' || !debtorId) return null
  const minor = parseMajorUnitsToMinor(amount ?? '')
  if (minor === null || minor <= 0) return null

  const remaining = balanceInDirection(operations, debtorId, direction)
  if (minor <= remaining) return null

  return (
    <Text variant="caption" className="text-warning" testID="debts-operation-over-repayment">
      {DEBTS_COPY.overRepayment(formatAmount(remaining))}
    </Text>
  )
}

export function OperationForm(props: OperationFormProps) {
  const debtors = useDebtors().data ?? []

  // Edit derives its context from the record itself; create receives the
  // contact+direction it was opened with. Both arms narrow the props union.
  const defaults = useMemo<OperationFormValues>(() => {
    const operation = props.operation
    if (operation) {
      return {
        kind: operation.kind,
        direction: operation.direction,
        debtorId: operation.debtorId,
        amount: minorToInputValue(operation.amount),
        occurredAt: operation.occurredAt,
        note: operation.note,
      }
    }
    return operationDefaultValues({
      kind: 'debt',
      direction: props.fixed.direction,
      debtorId: props.fixed.debtorId,
    })
    // Stable page state in both variants - defaults must not re-derive per
    // render, or the reset effect below would wipe the user's typing.
  }, [props.operation, props.fixed])

  const form = useForm<OperationFormValues>({
    resolver: zodResolver(operationSchema),
    defaultValues: defaults,
    mode: 'onChange',
  })
  const createOperation = useCreateDebtOperation()
  const updateOperation = useUpdateDebtOperation()
  const deleteOperation = useDeleteDebtOperation()
  const pending =
    createOperation.isPending || updateOperation.isPending || deleteOperation.isPending

  // The hosts outlive the sheet's open/close cycle (the create one is
  // permanently mounted, the edit one held while editingOperation is
  // set), so prefill/reset is explicit, never assumed from the content
  // remounting (forms.md §3); trigger() recomputes validity for the
  // fresh defaults.
  useEffect(() => {
    form.reset(defaults)
    void form.trigger()
  }, [defaults, form])

  const handleAmountKey = (key: KeypadKey) => {
    form.setValue('amount', applyKeypadInput(form.getValues('amount'), key), {
      shouldValidate: true,
    })
  }

  const handleDeleteConfirm = async () => {
    const operation = props.operation
    if (!operation) return
    try {
      await deleteOperation.mutateAsync(operation.id)
      props.onSuccess()
    } catch (cause) {
      form.setError('root', { message: getRepositoryErrorText(cause) })
    }
  }

  const handleDelete = () => {
    // TODO(i18n): RU wording until mobile i18n wiring lands.
    Alert.alert('Удалить операцию?', undefined, [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Удалить', style: 'destructive', onPress: () => void handleDeleteConfirm() },
    ])
  }

  const handleSubmit = async (values: OperationFormValues) => {
    const operation = props.operation
    try {
      if (operation) {
        await updateOperation.mutateAsync({
          id: operation.id,
          payload: toUpdatePayload(values, operation.version),
        })
      } else {
        await createOperation.mutateAsync(toCreatePayload(values))
        form.reset(defaults)
      }
      props.onSuccess()
    } catch (cause) {
      form.setError('root', { message: getRepositoryErrorText(cause) })
    }
  }

  const context = props.operation
    ? { debtorId: props.operation.debtorId, direction: props.operation.direction }
    : props.fixed
  const selectedDebtor = debtors.find((debtor) => debtor.id === context.debtorId)

  return (
    <FormProvider {...form}>
      <View className="flex-1">
        <BottomSheetHeader
          title={props.operation ? 'Операция' : DEBTS_COPY.newOperation}
          subtitle={selectedDebtor?.name}
          right={
            props.operation ? (
              <IconButton
                icon="trash-outline"
                size="md"
                colorClassName="accent-destructive"
                accessibilityLabel="Удалить операцию"
                testID="debts-operation-delete"
                disabled={pending}
                onPress={handleDelete}
              />
            ) : undefined
          }
        />
        <View className="flex-1 gap-3 px-4">
          <View className="gap-1">
            <StaticRow
              label={DEBTS_CONTACT_NOUN}
              value={selectedDebtor?.name ?? context.debtorId}
            />
            <StaticRow
              label="Направление"
              value={DEBT_DIRECTION_VIEWS[context.direction].summaryLabel}
            />
            {props.operation ? (
              <StaticRow label="Тип" value={DEBT_KIND_LABELS[props.operation.kind]} />
            ) : null}
          </View>

          {props.operation ? null : <KindFields />}

          <AmountField />

          <OverRepaymentWarning />

          <FormError testID="debts-operation-error">
            {form.formState.errors.root?.message}
          </FormError>

          <DebtsFormActions
            testIDPrefix="debts-operation"
            pending={pending}
            onSubmit={form.handleSubmit(handleSubmit)}
            submitAccessibilityLabel={props.operation ? 'Сохранить операцию' : 'Добавить операцию'}
          />
        </View>

        <AmountKeypad onKey={handleAmountKey} testIDPrefix="debts-operation" />
      </View>
    </FormProvider>
  )
}
