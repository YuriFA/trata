import { memo, useMemo, useRef } from 'react'
import { useFormContext, useWatch } from 'react-hook-form'
import { nowIso } from '@trata/dates'
import type { BottomSheetRef } from '@/shared/ui/bottom-sheet'
import { occurredAtForDaysAgo } from '../model/quick-dates'
import type { CreateTransactionFormValues } from '../model/schema'
import { DatePickerSheet } from '@/shared/ui/date-picker-sheet'
import { SheetContentPortal } from '@/shared/ui/sheet-content-portal'
import { DateButton, QuickDateRow } from './date-selector-row'

/**
 * The date concern of the action toolbar, split across its two visual spots:
 * `DateField` renders the quick-date chips plus the calendar sheet they open,
 * `DateFieldButton` the toggle in the toolbar row. Each subscribes to
 * `occurredAt` on its own; the reveal flag belongs to the toolbar, not to the
 * form.
 */
export const DateField = memo(function DateField({ open }: { open: boolean }) {
  const { control, setValue } = useFormContext<CreateTransactionFormValues>()
  const occurredAt = useWatch({ control, name: 'occurredAt' }) ?? nowIso()
  const datePickerRef = useRef<BottomSheetRef>(null)
  const selectedDate = useMemo(() => new Date(occurredAt), [occurredAt])

  const handleQuickDateSelect = (daysAgo: number) =>
    setValue('occurredAt', occurredAtForDaysAgo(daysAgo), { shouldValidate: true })
  const handleCalendarSelect = (date: Date) =>
    setValue('occurredAt', date.toISOString(), { shouldValidate: true })

  return (
    <>
      {open ? (
        <QuickDateRow
          occurredAt={occurredAt}
          onSelectDaysAgo={handleQuickDateSelect}
          onOpenCalendar={() => datePickerRef.current?.present()}
        />
      ) : null}
      {/* Always mounted, never inside the conditional QuickDateRow: picking a
          day or collapsing the row must not unmount an open sheet. */}
      <SheetContentPortal>
        <DatePickerSheet
          ref={datePickerRef}
          selected={selectedDate}
          onSelect={handleCalendarSelect}
        />
      </SheetContentPortal>
    </>
  )
})

export const DateFieldButton = memo(function DateFieldButton({
  open,
  onToggle,
}: {
  open: boolean
  onToggle: () => void
}) {
  const { control } = useFormContext<CreateTransactionFormValues>()
  const occurredAt = useWatch({ control, name: 'occurredAt' }) ?? nowIso()

  return <DateButton occurredAt={occurredAt} expanded={open} onToggle={onToggle} />
})
