// The plans forms' field rows (the edit-transaction field-rows idiom,
// design D7): the reference one-line rows — a leading icon with a muted
// label on the left, the value and a chevron on the right — plus the
// calendar date row and the inline note input row that the add/edit form
// and the manual confirm sheet share, and the add/edit form's own
// amount/name/account/category/option rows. Each row section subscribes
// to its own form slice and mounts its sheet itself (always mounted, so
// rows never unmount an open sheet).

import { useRef } from 'react'
import { useController, useFormContext, useFormState, useWatch } from 'react-hook-form'
import { View } from 'react-native'
import { calendarDayKey } from '@trata/dates'
import { currencySymbol } from '@trata/money'
import { useAccounts } from '@/entities/account'
import { useCategories } from '@/entities/category'
import { groupAmountInput } from '@/shared/lib/money/display'
import { sanitizeAmountInput } from '@/shared/lib/money/parse'
import { cn } from '@/shared/lib/utils'
import { AccountPickerSheet } from '@/shared/ui/account-picker-sheet'
import { BottomSheetInput, type BottomSheetRef } from '@/shared/ui/bottom-sheet'
import { CategoryPickerSheet } from '@/shared/ui/category-picker-sheet'
import { DatePickerSheet } from '@/shared/ui/date-picker-sheet'
import { FormError } from '@/shared/ui/form'
import { Icon, type IconName } from '@/shared/ui/icon'
import { CategoryAvatar } from '@/shared/ui/category-avatar'
import { Pressable } from '@/shared/ui/pressable'
import { SheetContentPortal } from '@/shared/ui/sheet-content-portal'
import { Text } from '@/shared/ui/text'
import { nextDueLabel } from '../model/selectors'
import type { PlanFormValues } from '../model/schema'
import { OptionPickerSheet, type OptionItem } from './option-picker-sheet'

type DateField = 'nextDue' | 'occurredOn'

/**
 * The reactive slice both plans schemas share with these rows: the add/edit
 * form structurally carries `nextDue` + `note`, the confirm sheet
 * `occurredOn` + `note` (the date FIELD name differs, like the former
 * toolbar's fixed slice).
 */
interface PlansRowValues {
  nextDue: string
  occurredOn: string
  note: string
}

/** A one-line picker row: leading icon, muted label left, value right, chevron. */
function PlansFieldRow({
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

/** The calendar date row plus its always-mounted sheet (field name per form). */
export function PlansDateFieldRow({ field, testID }: { field: DateField; testID: string }) {
  const { control, setValue } = useFormContext<PlansRowValues>()
  const { field: dateField } = useController({ name: field, control })
  const pickerRef = useRef<BottomSheetRef>(null)

  return (
    <>
      <PlansFieldRow
        label="Дата"
        value={nextDueLabel(dateField.value)}
        placeholder="Выберите дату"
        leadingIcon={
          <Icon name="calendar-outline" size={20} colorClassName="accent-muted-foreground" />
        }
        onPress={() => pickerRef.current?.present()}
        testID={testID}
      />
      <SheetContentPortal>
        <DatePickerSheet
          ref={pickerRef}
          selected={new Date(`${dateField.value}T00:00:00`)}
          onSelect={(date: Date) => setValue(field, calendarDayKey(date), { shouldValidate: true })}
        />
      </SheetContentPortal>
    </>
  )
}

/** The inline note input: a leading icon and a borderless sheet input. */
export function PlansNoteFieldRow({ testID }: { testID: string }) {
  const { control } = useFormContext<PlansRowValues>()
  const { field } = useController({ name: 'note', control })

  return (
    <BottomSheetInput
      testID={testID}
      leadingIcon="create-outline"
      className="border-0 bg-transparent px-0 py-3.5"
      placeholder="Заметка"
      value={field.value}
      onChangeText={field.onChange}
      onBlur={field.onBlur}
    />
  )
}

/** The required positive amount with the account's currency chip beside it. */
export function AmountField() {
  const { control, setValue } = useFormContext<PlanFormValues>()
  const { field, fieldState } = useController({ name: 'amount', control })
  const accounts = useAccounts().data ?? []
  const accountId = useWatch({ control, name: 'accountId' })
  // The plan's account owns the amount's currency; ₽ leads before one is
  // chosen (design D7).
  const currency = accounts.find((account) => account.id === accountId)?.currency ?? 'RUB'

  return (
    <View className="gap-1">
      <View className="flex-row items-center gap-3 rounded-2xl bg-secondary px-4 py-3">
        <View className="flex-1">
          <BottomSheetInput
            testID="plans-form-amount"
            className="border-0 bg-transparent px-0 py-1 text-3xl font-bold"
            accessibilityLabel="Сумма"
            keyboardType="decimal-pad"
            placeholder="0"
            value={groupAmountInput(field.value)}
            onChangeText={(text) =>
              setValue('amount', sanitizeAmountInput(text), { shouldValidate: true })
            }
            invalid={Boolean(fieldState.error)}
          />
        </View>
        <Text variant="h3" className="text-muted-foreground" testID="plans-form-currency">
          {currencySymbol(currency)}
        </Text>
      </View>
      <FormError testID="plans-form-amount-error">{fieldState.error?.message}</FormError>
    </View>
  )
}

/** The optional name (an empty string means an unnamed plan). */
export function NameField() {
  const { control } = useFormContext<PlanFormValues>()
  const { field } = useController({ name: 'name', control })

  return (
    <BottomSheetInput
      testID="plans-form-name"
      placeholder="Название (необязательно)"
      value={field.value}
      onChangeText={field.onChange}
      onBlur={field.onBlur}
    />
  )
}

/** The required account row («Счёт списания» / «Счёт зачисления») + picker. */
export function AccountRow({ label }: { label: string }) {
  const { control, setValue } = useFormContext<PlanFormValues>()
  const { field, fieldState } = useController({ name: 'accountId', control })
  const accounts = useAccounts().data ?? []
  const selected = accounts.find((account) => account.id === field.value)
  const pickerRef = useRef<BottomSheetRef>(null)

  return (
    <>
      <PlansFieldRow
        label={label}
        value={selected?.name}
        placeholder="Выберите счёт"
        leadingIcon={
          <Icon name="card-outline" size={20} colorClassName="accent-muted-foreground" />
        }
        onPress={() => pickerRef.current?.present()}
        testID="plans-form-account"
        invalid={Boolean(fieldState.error)}
      />
      <SheetContentPortal>
        <AccountPickerSheet
          ref={pickerRef}
          title={label}
          accounts={accounts}
          selectedId={field.value ?? ''}
          onSelect={(id) => setValue('accountId', id, { shouldValidate: true })}
          testIDPrefix="plans-form-account"
        />
      </SheetContentPortal>
    </>
  )
}

/** The required type-matched category row (colored icon) + picker. */
export function CategoryRow() {
  const { control, setValue } = useFormContext<PlanFormValues>()
  const { field, fieldState } = useController({ name: 'categoryId', control })
  const typeField = useController({ name: 'type', control })
  const categories = useCategories(typeField.field.value).data ?? []
  const selected = categories.find((category) => category.id === field.value)
  const pickerRef = useRef<BottomSheetRef>(null)

  return (
    <>
      <PlansFieldRow
        label="Категория"
        value={selected?.name}
        placeholder="Выберите категорию"
        leadingIcon={
          <CategoryAvatar
            icon={selected?.icon ?? '🏷️'}
            color={selected?.color}
            boxClassName="size-5"
            iconSize={11}
          />
        }
        onPress={() => pickerRef.current?.present()}
        testID="plans-form-category"
        invalid={Boolean(fieldState.error)}
      />
      <SheetContentPortal>
        <CategoryPickerSheet
          ref={pickerRef}
          categories={categories}
          selectedId={field.value ?? ''}
          onSelect={(id) => setValue('categoryId', id, { shouldValidate: true })}
        />
      </SheetContentPortal>
    </>
  )
}

type OptionField = 'regularity' | 'confirmMode' | 'reminder'

/**
 * A field row opening a single-choice option sheet. It subscribes only to
 * its own field, so a pick never re-renders the rest of the form
 * (forms.md §8). `onValueChange` observes transitions before the field is
 * written (e.g. the reminder permission request).
 */
export function OptionFieldRow({
  label,
  icon,
  field,
  testID,
  options,
  onValueChange,
}: {
  label: string
  icon: IconName
  field: OptionField
  testID: string
  options: ReadonlyArray<OptionItem<PlanFormValues[OptionField]>>
  onValueChange?: (next: PlanFormValues[OptionField], previous: PlanFormValues[OptionField]) => void
}) {
  const { control, setValue } = useFormContext<PlanFormValues>()
  const { field: fieldState } = useController({ name: field, control })
  const sheetRef = useRef<BottomSheetRef>(null)
  const selected = options.find((option) => option.value === fieldState.value)

  return (
    <>
      <PlansFieldRow
        label={label}
        value={selected?.label}
        placeholder="—"
        leadingIcon={<Icon name={icon} size={20} colorClassName="accent-muted-foreground" />}
        onPress={() => sheetRef.current?.present()}
        testID={testID}
      />
      <SheetContentPortal>
        <OptionPickerSheet
          ref={sheetRef}
          title={label}
          options={options}
          selected={fieldState.value}
          onSelect={(next) => {
            onValueChange?.(next, fieldState.value)
            setValue(field, next)
          }}
          testIDPrefix={testID}
        />
      </SheetContentPortal>
    </>
  )
}

/** The form-level (repository) error slot, isolated. */
export function RootError() {
  const { control } = useFormContext<PlanFormValues>()
  const { errors } = useFormState({ control })

  return <FormError testID="plans-form-error">{errors.root?.message}</FormError>
}
