import { useState } from 'react'
import { View } from 'react-native'
import { Icon } from '@/shared/ui/icon'
import { Text } from '@/shared/ui/text'
import { Pressable } from '@/shared/ui/pressable'
import { cn } from '@/shared/lib/utils'
import {
  calendarDayKey,
  monthGrid,
  monthLabel,
  nextMonth,
  previousMonth,
  weekdayLabels,
  type MonthCursor,
} from '@trata/dates'
import {
  BottomSheet,
  BottomSheetHeader,
  BottomSheetRef,
  BottomSheetView,
} from '@/shared/ui/bottom-sheet'

/**
 * Month-grid calendar sheet for the "Другой" quick-date action. Picking a day
 * reports it up and dismisses the sheet; the chosen day keeps the current
 * time of day.
 */
export function DatePickerSheet({
  ref,
  selected,
  onSelect,
}: {
  ref: React.Ref<BottomSheetRef>
  selected: Date
  onSelect: (date: Date) => void
}) {
  const [view, setView] = useState<MonthCursor>(() => ({
    year: selected.getFullYear(),
    month: selected.getMonth(),
  }))
  const now = new Date()
  const isViewingSelectedMonth =
    view.year === selected.getFullYear() && view.month === selected.getMonth()

  const shiftMonth = (delta: 1 | -1) =>
    setView((current) => (delta === -1 ? previousMonth(current) : nextMonth(current)))

  const handleDayPress = (day: number) => {
    onSelect(
      new Date(view.year, view.month, day, now.getHours(), now.getMinutes(), now.getSeconds()),
    )
    if (ref && typeof ref !== 'function') ref.current?.dismiss()
  }

  return (
    <BottomSheet
      ref={ref}
      snapPoints={['60%']}
      testID="new-transaction-date-picker"
      stackBehavior="push"
    >
      <BottomSheetView testID="new-transaction-calendar">
        <BottomSheetHeader title={`${monthLabel(view.year, view.month)} ${view.year}`} />
        <View className="gap-2 px-4 pb-6">
          <View className="flex-row items-center justify-between">
            <Pressable
              testID="new-transaction-calendar-prev"
              accessibilityRole="button"
              accessibilityLabel="Предыдущий месяц"
              className="h-10 w-10 items-center justify-center"
              onPress={() => shiftMonth(-1)}
            >
              <Icon name="chevron-back" size={20} colorClassName="accent-muted-foreground" />
            </Pressable>
            <Text variant="label" className="text-muted-foreground">
              {weekdayLabels().join(' ')}
            </Text>
            <Pressable
              testID="new-transaction-calendar-next"
              accessibilityRole="button"
              accessibilityLabel="Следующий месяц"
              className="h-10 w-10 items-center justify-center"
              onPress={() => shiftMonth(1)}
            >
              <Icon name="chevron-forward" size={20} colorClassName="accent-muted-foreground" />
            </Pressable>
          </View>

          {monthGrid(view.year, view.month).map((week, weekIndex) => (
            <View key={weekIndex} className="flex-row">
              {week.map((day, dayIndex) => {
                // Placeholder keys must not collide with the day-number
                // keys of the same row's real cells.
                if (day === null) return <View key={`pad-${dayIndex}`} className="h-11 flex-1" />
                const isSelected = isViewingSelectedMonth && day === selected.getDate()
                const isToday =
                  view.year === now.getFullYear() &&
                  view.month === now.getMonth() &&
                  day === now.getDate()
                const dateKey = calendarDayKey(new Date(view.year, view.month, day))
                return (
                  <Pressable
                    key={day}
                    testID={`new-transaction-calendar-day-${dateKey}`}
                    accessibilityRole="button"
                    accessibilityLabel={`${day} ${monthLabel(view.year, view.month)}`}
                    accessibilityState={{ selected: isSelected }}
                    className={cn(
                      'h-11 flex-1 items-center justify-center rounded-full',
                      isSelected && 'bg-primary',
                      !isSelected && isToday && 'border border-primary',
                    )}
                    onPress={() => handleDayPress(day)}
                  >
                    <Text
                      variant="body-sm"
                      className={isSelected ? 'text-primary-foreground' : 'text-foreground'}
                    >
                      {day}
                    </Text>
                  </Pressable>
                )
              })}
            </View>
          ))}
        </View>
      </BottomSheetView>
    </BottomSheet>
  )
}
