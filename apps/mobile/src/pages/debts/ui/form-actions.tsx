// The debts action toolbar (the create-transaction form-actions idiom,
// design D9): a one-row toolbar with the date toggle (quick-date chips +
// always-mounted calendar sheet) and the circular submit. Both debts forms —
// the operation form and the combined contact+debt form — share it; the
// reactive slice it touches is `occurredAt`, which both schemas carry.
//
// The toolbar owns only the date reveal flag; every reactive part is a
// self-subscribing leaf (components-and-state §4, forms.md §8).

import { memo, useCallback, useMemo, useRef, useState } from 'react'
import { useFormContext, useFormState, useWatch } from 'react-hook-form'
import { View } from 'react-native'
import { nowIso } from '@trata/dates'
import {
  DateButton,
  QuickDateRow,
  TransactionSubmitButton,
  occurredAtForDaysAgo,
} from '@/features/create-transaction'
import type { BottomSheetRef } from '@/shared/ui/bottom-sheet'
import { DatePickerSheet } from '@/shared/ui/date-picker-sheet'
import { SheetContentPortal } from '@/shared/ui/sheet-content-portal'

/** The reactive slice both debts schemas share with the toolbar. */
interface DebtsFormActionsValues {
  occurredAt: string
}

export function DebtsFormActions({
  testIDPrefix,
  pending,
  onSubmit,
  submitAccessibilityLabel,
}: {
  /** testID stem, e.g. `debts-operation` → `debts-operation-date-button`. */
  testIDPrefix: string
  pending: boolean
  onSubmit: () => void
  submitAccessibilityLabel: string
}) {
  // Ephemeral UI state only - the values themselves live in the form.
  const [quickDatesOpen, setQuickDatesOpen] = useState(false)
  const toggleQuickDates = useCallback(() => setQuickDatesOpen((open) => !open), [])

  return (
    <View className="gap-4">
      <DebtsDateField testIDPrefix={testIDPrefix} open={quickDatesOpen} />

      <View className="flex-row items-center py-2 border-t border-t-border">
        <DebtsDateFieldButton
          testIDPrefix={testIDPrefix}
          open={quickDatesOpen}
          onToggle={toggleQuickDates}
        />
        <DebtsSubmitField
          testID={`${testIDPrefix}-submit`}
          accessibilityLabel={submitAccessibilityLabel}
          pending={pending}
          onPress={onSubmit}
        />
      </View>
    </View>
  )
}

/**
 * The date concern: quick-date chips plus the calendar sheet they open when
 * expanded. The calendar stays always mounted - collapsing the row must not
 * unmount an open sheet.
 */
const DebtsDateField = memo(function DebtsDateField({
  testIDPrefix,
  open,
}: {
  testIDPrefix: string
  open: boolean
}) {
  const { control, setValue } = useFormContext<DebtsFormActionsValues>()
  const occurredAt = useWatch({ control, name: 'occurredAt' }) ?? nowIso()
  const datePickerRef = useRef<BottomSheetRef>(null)
  const selectedDate = useMemo(() => new Date(occurredAt), [occurredAt])

  return (
    <>
      {open ? (
        <QuickDateRow
          testIDPrefix={testIDPrefix}
          occurredAt={occurredAt}
          onSelectDaysAgo={(daysAgo) =>
            setValue('occurredAt', occurredAtForDaysAgo(daysAgo), { shouldValidate: true })
          }
          onOpenCalendar={() => datePickerRef.current?.present()}
        />
      ) : null}
      <SheetContentPortal>
        <DatePickerSheet
          ref={datePickerRef}
          selected={selectedDate}
          onSelect={(date: Date) =>
            setValue('occurredAt', date.toISOString(), { shouldValidate: true })
          }
        />
      </SheetContentPortal>
    </>
  )
})

const DebtsDateFieldButton = memo(function DebtsDateFieldButton({
  testIDPrefix,
  open,
  onToggle,
}: {
  testIDPrefix: string
  open: boolean
  onToggle: () => void
}) {
  const { control } = useFormContext<DebtsFormActionsValues>()
  const occurredAt = useWatch({ control, name: 'occurredAt' }) ?? nowIso()

  return (
    <DateButton
      testID={`${testIDPrefix}-date-button`}
      occurredAt={occurredAt}
      expanded={open}
      onToggle={onToggle}
    />
  )
})

/** The submit control, isolated: it alone subscribes to form validity. */
const DebtsSubmitField = memo(function DebtsSubmitField({
  testID,
  accessibilityLabel,
  pending,
  onPress,
}: {
  testID: string
  accessibilityLabel: string
  pending: boolean
  onPress: () => void
}) {
  const { control } = useFormContext<DebtsFormActionsValues>()
  const { isValid, isSubmitting, errors } = useFormState({ control })
  // A repository error parked at the root slot flips RHF's `isValid` off
  // even though the values still pass the schema - the button must stay
  // pressable so the user can retry (handleSubmit re-validates and clears
  // the root error itself).
  const valuesValid = isValid || Boolean(errors.root)

  return (
    <TransactionSubmitButton
      className="ml-auto"
      testID={testID}
      accessibilityLabel={accessibilityLabel}
      disabled={!valuesValid}
      loading={isSubmitting || pending}
      onPress={onPress}
    />
  )
})
