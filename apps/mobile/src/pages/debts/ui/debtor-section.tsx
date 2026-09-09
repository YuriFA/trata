import { useState } from 'react'
import { View } from 'react-native'
import type { DebtDirection } from '@trata/api'
import { Text } from '@/shared/ui/text'
import { Pressable } from '@/shared/ui/pressable'
import { Icon } from '@/shared/ui/icon'
import { DEBT_DIRECTION_VIEWS } from '../model/kind'
import type { DebtorSectionView } from '../model/selectors'
import { DebtorRow } from './debtor-row'
import { Card } from '@/shared/ui/card'

/**
 * One direction's debtor list: section header with the circular «+» that
 * opens the combined contact+debt form for this direction (design D9),
 * balance-descending rows, and the settled (zero-balance) debtors hidden
 * behind a reveal row that carries the count.
 */
export function DebtorSection({
  direction,
  section,
  onDebtorPress,
  onAdd,
}: {
  direction: DebtDirection
  section: DebtorSectionView
  onDebtorPress: (debtorId: string, direction: DebtDirection) => void
  /** Opens the combined contact+debt sheet for this direction (page composition). */
  onAdd: (direction: DebtDirection) => void
}) {
  const view = DEBT_DIRECTION_VIEWS[direction]
  const [settledRevealed, setSettledRevealed] = useState(false)

  const rows = settledRevealed ? [...section.visible, ...section.settled] : section.visible

  return (
    <Card variant="elevated" className="gap-1" testID={`debts-section-${direction}`}>
      <View className="flex-row items-center justify-between">
        <Text variant="body" className="font-medium text-muted-foreground">
          {view.sectionTitle}
        </Text>
        <Pressable
          testID={`debts-section-add-${direction}`}
          accessibilityRole="button"
          accessibilityLabel={view.sheetTitle}
          className="active:opacity-70"
          onPress={() => onAdd(direction)}
        >
          <View className="h-10 w-10 items-center justify-center rounded-full bg-muted">
            <Icon name="add" size={24} colorClassName="accent-foreground" />
          </View>
        </Pressable>
      </View>

      {rows.length === 0 ? (
        <Text variant="body-sm" className="py-2 text-muted-foreground">
          {view.sectionEmpty}
        </Text>
      ) : (
        rows.map((row) => (
          <DebtorRow
            key={row.debtor.id}
            view={row}
            onPress={() => onDebtorPress(row.debtor.id, direction)}
          />
        ))
      )}

      {section.settled.length > 0 && (
        <Pressable
          testID={`debts-settled-reveal-${direction}`}
          accessibilityRole="button"
          className="py-2 active:opacity-70"
          onPress={() => setSettledRevealed((revealed) => !revealed)}
        >
          <Text variant="body-sm" className="text-muted-foreground">
            {settledRevealed
              ? // TODO(i18n): RU wording until mobile i18n wiring lands.
                'Скрыть рассчитавшихся'
              : `Показать рассчитавшихся (${section.settled.length})`}
          </Text>
        </Pressable>
      )}
    </Card>
  )
}
