import { useEffect, useMemo, useRef } from 'react'
import { useController, useFormContext, useWatch } from 'react-hook-form'
import { View } from 'react-native'
import { fullDayLabel } from '@trata/dates'
import { convert, currencySymbol, type CurrencyRates } from '@trata/money'
import { useAccounts } from '@/entities/account'
import { useCategories } from '@/entities/category'
import { FormError, FormLabel } from '@/shared/ui/form'
import { Icon } from '@/shared/ui/icon'
import { CategoryAvatar } from '@/shared/ui/category-avatar'
import { Pressable } from '@/shared/ui/pressable'
import { Text } from '@/shared/ui/text'
import { BottomSheetInput, type BottomSheetRef } from '@/shared/ui/bottom-sheet'
import { AccountPickerSheet } from '@/shared/ui/account-picker-sheet'
import { CategoryPickerSheet } from '@/shared/ui/category-picker-sheet'
import { DatePickerSheet } from '@/shared/ui/date-picker-sheet'
import { SheetContentPortal } from '@/shared/ui/sheet-content-portal'
import { useRates } from '@/shared/lib/db/rates'
import { groupAmountInput, minorToInputValue } from '@/shared/lib/money/display'
import { parseMajorUnitsToMinor, sanitizeAmountInput } from '@/shared/lib/money/parse'
import { cn } from '@/shared/lib/utils'
import type { EditTransactionFormValues } from '../model/schema'

/**
 * The edit form's stacked rows (reference layout): one concern per line, a
 * muted label with a leading icon on the left, the value and a chevron on
 * the right. Each row section subscribes to its own form slice and mounts
 * its picker sheet itself (always mounted, so conditional rows never unmount
 * an open sheet). The cash/transfer split mirrors the create form's
 * AccountField vs TransferFields.
 */

function FieldRow({
  label,
  value,
  placeholder,
  leadingIcon,
  onPress,
  testID,
  invalid = false,
}: {
  label: string
  value: string | undefined
  placeholder: string
  leadingIcon: React.ReactNode
  onPress: () => void
  testID: string
  invalid?: boolean
}) {
  const isPlaceholder = value === undefined

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value ?? placeholder}`}
      className="flex-row items-center gap-3 py-3.5"
      onPress={onPress}
    >
      {leadingIcon}
      <Text variant="body" className="text-muted-foreground">
        {label}
      </Text>
      <Text
        variant="body"
        className={cn(
          'flex-1 text-right',
          isPlaceholder || invalid ? 'text-muted-foreground' : 'text-foreground',
        )}
        numberOfLines={1}
      >
        {value ?? placeholder}
      </Text>
      <Icon name="chevron-forward" size={16} colorClassName="accent-muted-foreground" />
    </Pressable>
  )
}

/** The expense/income/adjustment account selector row plus its picker sheet. */
export function CashflowAccountRow({ kind }: { kind: 'expense' | 'income' | 'adjustment' }) {
  const { control, setValue } = useFormContext<EditTransactionFormValues>()
  const { field, fieldState } = useController({ name: 'accountId', control })
  const accounts = useAccounts().data ?? []
  const pickerRef = useRef<BottomSheetRef>(null)
  const selectedAccount = accounts.find((account) => account.id === field.value)
  // Adjustment has no direction: the neutral label, no delta wording.
  const label =
    kind === 'income' ? 'Счёт пополнения' : kind === 'expense' ? 'Счёт списания' : 'Счёт'

  return (
    <>
      <FieldRow
        label={label}
        value={selectedAccount?.name}
        placeholder="Выберите счёт"
        leadingIcon={
          <Icon name="card-outline" size={20} colorClassName="accent-muted-foreground" />
        }
        onPress={() => pickerRef.current?.present()}
        testID="edit-transaction-account"
        invalid={Boolean(fieldState.error)}
      />
      <SheetContentPortal>
        <AccountPickerSheet
          ref={pickerRef}
          title={label}
          accounts={accounts}
          selectedId={field.value ?? ''}
          onSelect={(id) => setValue('accountId', id, { shouldValidate: true })}
          testIDPrefix="edit-transaction-account"
        />
      </SheetContentPortal>
    </>
  )
}

/**
 * The transfer variant's source and destination rows: both pickers and the
 * cross-currency bridge (ported from the create form's TransferFields).
 * Multi-currency: the destination candidates are every OTHER account - the
 * currencies may differ, and the schema's `crossCurrency` flag mirrors the
 * effective pair so the destination-amount iff-rule validates like any
 * field.
 */
export function TransferAccountRows() {
  const { control, getValues, setValue } = useFormContext<EditTransactionFormValues>()
  const fromField = useController({ name: 'fromAccountId', control })
  const toField = useController({ name: 'toAccountId', control })
  const accounts = useAccounts().data ?? []
  const fromAccount = accounts.find((account) => account.id === fromField.field.value)
  const toAccount = accounts.find((account) => account.id === toField.field.value)
  const fromPickerRef = useRef<BottomSheetRef>(null)
  const toPickerRef = useRef<BottomSheetRef>(null)

  const crossCurrency =
    fromAccount !== undefined &&
    toAccount !== undefined &&
    fromAccount.currency !== toAccount.currency

  useEffect(() => {
    if (getValues('crossCurrency') !== crossCurrency) {
      setValue('crossCurrency', crossCurrency, { shouldValidate: true })
    }
  }, [crossCurrency, getValues, setValue])

  const handleFromSelect = (id: string) => {
    setValue('fromAccountId', id, { shouldValidate: true })
  }

  return (
    <>
      <FieldRow
        label="Счёт списания"
        value={fromAccount?.name}
        placeholder="Выберите счёт"
        leadingIcon={
          <Icon name="card-outline" size={20} colorClassName="accent-muted-foreground" />
        }
        onPress={() => fromPickerRef.current?.present()}
        testID="edit-transaction-from"
        invalid={Boolean(fromField.fieldState.error)}
      />
      <FieldRow
        label="Счёт пополнения"
        value={toAccount?.name}
        placeholder="Выберите счёт"
        leadingIcon={
          <Icon name="card-outline" size={20} colorClassName="accent-muted-foreground" />
        }
        onPress={() => toPickerRef.current?.present()}
        testID="edit-transaction-to"
        invalid={Boolean(toField.fieldState.error)}
      />
      <DestinationAmountRow />
      <SheetContentPortal>
        <AccountPickerSheet
          ref={fromPickerRef}
          title="Счёт списания"
          accounts={accounts}
          selectedId={fromField.field.value ?? ''}
          onSelect={handleFromSelect}
          testIDPrefix="edit-transaction-from"
        />
      </SheetContentPortal>
      <SheetContentPortal>
        <AccountPickerSheet
          ref={toPickerRef}
          title="Счёт пополнения"
          accounts={accounts.filter((account) => account.id !== fromAccount?.id)}
          selectedId={toField.field.value ?? ''}
          onSelect={(id) => setValue('toAccountId', id, { shouldValidate: true })}
          testIDPrefix="edit-transaction-to"
        />
      </SheetContentPortal>
    </>
  )
}

/** "1.2345" -> "1,2345": display-grade rate with trailing zeros trimmed. */
function formatRate(rate: number): string {
  return rate.toFixed(4).replace(/0+$/, '').replace(/\.$/, '').replace('.', ',')
}

/** RU conversion hint from the cached snapshot: "Курс: 1 USD ≈ 90,5 RUB". */
function conversionHint(from: string, to: string, rates: CurrencyRates): string | null {
  const fromRate = rates.rates[from]
  const toRate = rates.rates[to]
  if (fromRate === undefined || toRate === undefined || fromRate === 0) return null
  return `Курс: 1 ${from} \u2248 ${formatRate(toRate / fromRate)} ${to}`
}

/**
 * The edit form's destination amount for cross-currency transfers
 * (multi-currency 6.3): prefilled from the record's stored figure, editable,
 * and re-suggested from the cached rate whenever the figure is empty (a
 * fresh cross-currency pair after switching accounts). Same-currency
 * transfers render nothing.
 */
function DestinationAmountRow() {
  const { control, getValues, setValue } = useFormContext<EditTransactionFormValues>()
  const { field, fieldState } = useController({ name: 'destinationAmount', control })
  const crossCurrency = useWatch({ control, name: 'crossCurrency' })
  const sourceAmount = useWatch({ control, name: 'amount' })
  const fromId = useWatch({ control, name: 'fromAccountId' })
  const toId = useWatch({ control, name: 'toAccountId' })
  const accounts = useAccounts().data ?? []
  const rates = useRates().data ?? null

  const from = accounts.find((account) => account.id === fromId)
  const to = accounts.find((account) => account.id === toId)
  const touchedRef = useRef(false)
  useEffect(() => {
    touchedRef.current = false
  }, [fromId, toId])

  useEffect(() => {
    if (!crossCurrency || touchedRef.current || !from || !to || !rates) return
    const sourceMinor = parseMajorUnitsToMinor(sourceAmount)
    if (sourceMinor === null || sourceMinor < 1) return
    const converted = convert(sourceMinor, from.currency, to.currency, rates)
    if (converted === null || converted < 1) return
    if (getValues('destinationAmount') === '') {
      setValue('destinationAmount', minorToInputValue(converted), { shouldValidate: true })
    }
  }, [crossCurrency, sourceAmount, from, to, rates, getValues, setValue])

  if (!crossCurrency) return null

  return (
    <View className="gap-1 py-2">
      <FormLabel>Сумма зачисления</FormLabel>
      <View className="flex-row items-center gap-3 rounded-2xl bg-secondary px-4 py-3">
        <View className="flex-1">
          <BottomSheetInput
            testID="edit-transaction-destination-amount"
            className="border-0 bg-transparent px-0 py-1 text-xl font-bold"
            accessibilityLabel="Сумма зачисления"
            keyboardType="decimal-pad"
            placeholder="0"
            value={groupAmountInput(field.value ?? '')}
            onChangeText={(text) => {
              touchedRef.current = true
              field.onChange(sanitizeAmountInput(text))
            }}
            invalid={Boolean(fieldState.error)}
          />
        </View>
        {to ? (
          <Text variant="h3" className="text-muted-foreground">
            {currencySymbol(to.currency)}
          </Text>
        ) : null}
      </View>
      {from && to && rates ? (
        <Text variant="caption" className="text-muted-foreground">
          {conversionHint(from.currency, to.currency, rates)}
        </Text>
      ) : null}
      <FormError testID="edit-transaction-destination-amount-error">
        {fieldState.error?.message}
      </FormError>
    </View>
  )
}

/** The category row (cash flows only): colored icon, name, picker sheet. */
export function CategoryFieldRow({ kind }: { kind: 'expense' | 'income' }) {
  const { control, setValue } = useFormContext<EditTransactionFormValues>()
  const { field, fieldState } = useController({ name: 'categoryId', control })
  const categories = useCategories().data ?? []
  const pickerRef = useRef<BottomSheetRef>(null)
  const category = categories.find((item) => item.id === field.value)

  return (
    <>
      <FieldRow
        label="Категория"
        value={category?.name}
        placeholder="Выберите категорию"
        leadingIcon={
          <CategoryAvatar
            icon={category?.icon ?? '🏷️'}
            color={category?.color}
            boxClassName="size-5"
            iconSize={11}
          />
        }
        onPress={() => pickerRef.current?.present()}
        testID="edit-transaction-category"
        invalid={Boolean(fieldState.error)}
      />
      <SheetContentPortal>
        <CategoryPickerSheet
          ref={pickerRef}
          categories={categories.filter((item) => item.type === kind)}
          selectedId={field.value ?? ''}
          onSelect={(id) => setValue('categoryId', id, { shouldValidate: true })}
        />
      </SheetContentPortal>
    </>
  )
}

export function DateFieldRow() {
  const { control, setValue } = useFormContext<EditTransactionFormValues>()
  const { field, fieldState } = useController({ name: 'occurredAt', control })
  const pickerRef = useRef<BottomSheetRef>(null)
  // `new Date('')` is an Invalid Date that crashes the calendar's month
  // label, so the prefill gap falls back to "now".
  const selectedDate = useMemo(
    () => (field.value ? new Date(field.value) : new Date()),
    [field.value],
  )

  return (
    <>
      <FieldRow
        label="Дата"
        value={field.value ? fullDayLabel(field.value) : undefined}
        placeholder="Выберите дату"
        leadingIcon={
          <Icon name="calendar-outline" size={20} colorClassName="accent-muted-foreground" />
        }
        onPress={() => pickerRef.current?.present()}
        testID="edit-transaction-date"
        invalid={Boolean(fieldState.error)}
      />
      <SheetContentPortal>
        <DatePickerSheet
          ref={pickerRef}
          selected={selectedDate}
          onSelect={(date: Date) =>
            setValue('occurredAt', date.toISOString(), { shouldValidate: true })
          }
        />
      </SheetContentPortal>
    </>
  )
}

export function NoteField() {
  const { control } = useFormContext<EditTransactionFormValues>()
  const { field } = useController({ name: 'description', control })

  return (
    <BottomSheetInput
      testID="edit-transaction-note"
      placeholder="Заметка"
      value={field.value}
      onChangeText={field.onChange}
    />
  )
}
