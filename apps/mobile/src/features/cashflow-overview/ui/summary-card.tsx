import { Pressable, View } from 'react-native'
import { Icon } from '@/shared/ui/icon'
import { IconButton } from '@/shared/ui/icon-button'
import { Text } from '@/shared/ui/text'
import { monthRangeLabel } from '@trata/dates'
import type { MonthCursor } from '../model/selectors'

export interface SummaryCardProps {
  title?: string
  /** Pre-formatted period total; the caller owns which figure it is. */
  amountText: string
  cursor: MonthCursor
  onPrevPeriod: () => void
  onNextPeriod: () => void
  /** When set, the title becomes a pressable that opens the caller's picker. */
  onTitlePress?: () => void
  /** testID stem: `home` (dashboard) or `income`. */
  testIDPrefix: string
}

/**
 * Presentational period summary: title, amount, and month navigation. The
 * dashboard wraps it with its mode picker; the income screen mounts it with
 * a fixed title.
 */
export function SummaryCard({
  title,
  amountText,
  cursor,
  onPrevPeriod,
  onNextPeriod,
  onTitlePress,
  testIDPrefix,
}: SummaryCardProps) {
  const periodLabel = monthRangeLabel(cursor.year, cursor.month)

  return (
    <View className="gap-2">
      {title && (
        <View className="flex-row items-center justify-between">
          {onTitlePress ? (
            <Pressable
              testID={`${testIDPrefix}-summary-mode`}
              accessibilityRole="button"
              accessibilityLabel="Изменить отображение суммы"
              className="flex-row items-center gap-1 active:opacity-70"
              onPress={onTitlePress}
            >
              <Text variant="display">{title}</Text>
              <Icon name="chevron-down" size={24} colorClassName="accent-muted-foreground" />
            </Pressable>
          ) : (
            <Text variant="display">{title}</Text>
          )}
        </View>
      )}

      <View className="flex-row items-center justify-between">
        <Text variant="h1" className="text-foreground">
          {amountText}
        </Text>
        <View className="flex-row items-center gap-1">
          <IconButton
            testID={`${testIDPrefix}-period-prev`}
            icon="chevron-back"
            size="sm"
            accessibilityLabel="Предыдущий месяц"
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            onPress={onPrevPeriod}
          />
          <Text variant="caption">{periodLabel}</Text>
          <IconButton
            testID={`${testIDPrefix}-period-next`}
            icon="chevron-forward"
            size="sm"
            accessibilityLabel="Следующий месяц"
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            onPress={onNextPeriod}
          />
        </View>
      </View>
    </View>
  )
}
