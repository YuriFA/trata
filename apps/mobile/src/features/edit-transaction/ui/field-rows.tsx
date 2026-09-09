import { useMemo, useRef } from 'react'
import { useController, useFormContext } from 'react-hook-form'
import { fullDayLabel } from '@trata/dates'
import { useAccounts } from '@/entities/account'
import { useCategories } from '@/entities/category'
import { BottomSheetInput, type BottomSheetRef } from '@/shared/ui/bottom-sheet'
import { Icon } from '@/shared/ui/icon'
import { CategoryAvatar } from '@/shared/ui/category-avatar'
import { Pressable } from '@/shared/ui/pressable'
import { Text } from '@/shared/ui/text'
import { AccountPickerSheet } from '@/shared/ui/account-picker-sheet'
import { CategoryPickerSheet } from '@/shared/ui/category-picker-sheet'
import { DatePickerSheet } from '@/shared/ui/date-picker-sheet'
import { SheetContentPortal } from '@/shared/ui/sheet-content-portal'
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
 * same-currency candidate rule derived from the source (ported from the
 * create form's TransferFields).
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

  // Destinations stay a UI-level derivation: same currency as the source,
  // distinct from it (the schema cannot see currencies and must not duplicate
  // the rule).
  const toCandidates = fromAccount
    ? accounts.filter(
        (account) => account.currency === fromAccount.currency && account.id !== fromAccount.id,
      )
    : []

  const handleFromSelect = (id: string) => {
    setValue('fromAccountId', id, { shouldValidate: true })
    // A destination that no longer matches the new source's currency is
    // cleared - the candidate rule is re-derived from the new selection.
    const from = accounts.find((account) => account.id === id)
    const to = accounts.find((account) => account.id === getValues('toAccountId'))
    if (from && to && to.currency !== from.currency) {
      setValue('toAccountId', '')
    }
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
          accounts={toCandidates}
          selectedId={toField.field.value ?? ''}
          onSelect={(id) => setValue('toAccountId', id, { shouldValidate: true })}
          testIDPrefix="edit-transaction-to"
        />
      </SheetContentPortal>
    </>
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
