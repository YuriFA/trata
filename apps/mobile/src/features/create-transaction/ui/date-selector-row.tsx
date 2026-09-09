import { Pressable, ScrollView } from 'react-native'
import { Icon } from '@/shared/ui/icon'
import { Text } from '@/shared/ui/text'
import { cn } from '@/shared/lib/utils'
import { calendarDaysAgo, relativeDayLabel } from '@trata/dates'
import { quickDateOptions } from '../model/quick-dates'

/** The date control in the action row: "Сегодня" / "Вчера" / "14 АВГ.". */
export function DateButton({
  occurredAt,
  expanded,
  onToggle,
  testID = 'new-transaction-date-button',
}: {
  occurredAt: string
  expanded: boolean
  onToggle: () => void
  /** Override for reuse outside the transaction form (e.g. debts). */
  testID?: string
}) {
  const label = relativeDayLabel(occurredAt)

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`Дата: ${label}`}
      accessibilityState={{ expanded }}
      className="h-11 flex-row items-center gap-2 px-2"
      onPress={onToggle}
    >
      <Icon
        name="calendar-outline"
        size={20}
        colorClassName={expanded ? 'accent-primary' : 'accent-muted-foreground'}
      />
      <Text variant="body-sm" className="text-foreground">
        {label}
      </Text>
    </Pressable>
  )
}

/**
 * Quick-date chips revealed above the action row: the last seven days plus
 * "Другой", which opens the calendar sheet. Labels are derived from the
 * current date, never hardcoded.
 */
export function QuickDateRow({
  occurredAt,
  onSelectDaysAgo,
  onOpenCalendar,
  testIDPrefix = 'new-transaction',
}: {
  occurredAt: string
  onSelectDaysAgo: (daysAgo: number) => void
  onOpenCalendar: () => void
  /** Override for reuse outside the transaction form (e.g. debts). */
  testIDPrefix?: string
}) {
  const selectedDaysAgo = calendarDaysAgo(occurredAt)

  return (
    <ScrollView
      horizontal
      testID={`${testIDPrefix}-quick-dates`}
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 8 }}
    >
      {quickDateOptions().map((option) => (
        <QuickDateChip
          key={option.daysAgo}
          testID={`${testIDPrefix}-quick-date-${option.daysAgo}`}
          label={option.label}
          selected={selectedDaysAgo === option.daysAgo}
          onPress={() => onSelectDaysAgo(option.daysAgo)}
        />
      ))}
      <QuickDateChip
        testID={`${testIDPrefix}-quick-date-other`}
        label="Другой"
        selected={false}
        onPress={onOpenCalendar}
      />
    </ScrollView>
  )
}

function QuickDateChip({
  label,
  selected,
  onPress,
  testID,
}: {
  label: string
  selected: boolean
  onPress: () => void
  testID: string
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      className={cn(
        'rounded-full border px-4 py-2',
        selected ? 'border-primary bg-secondary' : 'border-border',
      )}
      onPress={onPress}
    >
      <Text variant="body-sm" className={selected ? 'font-medium text-primary' : 'text-foreground'}>
        {label}
      </Text>
    </Pressable>
  )
}
