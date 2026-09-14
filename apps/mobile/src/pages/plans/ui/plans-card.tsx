import { View } from 'react-native'
import type { PlannedPaymentType } from '@trata/api'
import { Card } from '@/shared/ui/card'
import { Icon } from '@/shared/ui/icon'
import { Pressable } from '@/shared/ui/pressable'
import { Text } from '@/shared/ui/text'
import { PLAN_TYPE_VIEWS, planCountLabel } from '../model/kind'
import { monthlyTotalText, type PlanCardFigures } from '../model/selectors'

/** One type's entry card: live count + normalized «X ₽/мес» figure. */
export function PlansTypeCard({
  type,
  figures,
  onPress,
}: {
  type: PlannedPaymentType
  figures: PlanCardFigures
  onPress: () => void
}) {
  const view = PLAN_TYPE_VIEWS[type]

  return (
    <Pressable
      testID={`plans-card-${type}`}
      accessibilityRole="button"
      accessibilityLabel={`${view.cardTitle}: ${planCountLabel(figures.count)}`}
      className="active:opacity-70"
      onPress={onPress}
    >
      <Card variant="elevated" className="gap-1">
        <View className="flex-row items-center justify-between">
          <View className="flex-row items-center gap-2">
            <Icon
              name={type === 'expense' ? 'arrow-up' : 'arrow-down'}
              size={16}
              colorClassName="accent-muted-foreground"
            />
            <Text variant="h3">{view.cardTitle}</Text>
          </View>
          <Text variant="body-sm" className="text-muted-foreground" testID={`plans-count-${type}`}>
            {planCountLabel(figures.count)}
          </Text>
        </View>
        <Text variant="body-sm" className="text-muted-foreground">
          {view.cardDescription}
        </Text>
        {/* The testID sits on the figure itself so flows assert the number. */}
        <Text variant="h3" className="text-foreground" testID={`plans-total-${type}`}>
          {monthlyTotalText(figures.monthly)}
        </Text>
      </Card>
    </Pressable>
  )
}
