// Per-type plan list sheet (design D7): the tapped card's plans as a flat
// list sorted by next-due ascending (overdue plans come first by
// construction, badged «Просрочен»), rows titled name-or-category, and the
// bottom «Добавить расход/доход» CTA pinned above the safe area in a
// SheetFooter (the category-cashflow sheet idiom) so it stays reachable no
// matter how long the list grows. Manual plans carry a row-level confirm
// affordance; auto plans do not (the server job owns their execution).

import { View } from 'react-native'
import Animated from 'react-native-reanimated'
import type { Category, HouseholdMember, PlannedPayment, PlannedPaymentType } from '@trata/api'
import {
  BottomSheet,
  BottomSheetHeader,
  BottomSheetScrollView,
  type BottomSheetRef,
} from '@/shared/ui/bottom-sheet'
import { SheetFooter, useSheetFooterScroll } from '@/shared/ui/sheet-footer'
import { Icon } from '@/shared/ui/icon'
import { IconButton } from '@/shared/ui/icon-button'
import { Pressable } from '@/shared/ui/pressable'
import { Text } from '@/shared/ui/text'
import { formatAmount } from '@/shared/lib/format/format'
import { nativeCurrencyOf, type MoneyPresentation } from '@/shared/lib/money/aggregate'
import { authorLabel } from '@/entities/household'
import { PLANS_COPY, PLANS_REGULARITY_PHRASES, PLAN_TYPE_VIEWS } from '../model/kind'
import { isPlanOverdue, nextDueLabel, planRowTitle, plansSortedByNextDue } from '../model/selectors'
import { calendarDayKey } from '@trata/dates'

const AnimatedBottomSheetScrollView = Animated.createAnimatedComponent(BottomSheetScrollView)

export interface PlansListSheetProps {
  ref: React.Ref<BottomSheetRef>
  type: PlannedPaymentType
  plans: PlannedPayment[]
  categories: Category[]
  /** Authorship marker context (household-ux 2.4). */
  author?: { members: readonly HouseholdMember[]; currentUserId: string | null | undefined }
  /** Money presentation (multi-currency D9): rows show the plan's account currency. */
  presentation: MoneyPresentation
  /** Opens the keyed add form for this type (page composition). */
  onAdd: (type: PlannedPaymentType) => void
  onEdit: (plan: PlannedPayment) => void
  /** Opens the confirm sheet (manual plans only). */
  onConfirm: (plan: PlannedPayment) => void
}

export function PlansListSheet({
  ref,
  type,
  plans,
  categories,
  presentation,
  author,
  onAdd,
  onEdit,
  onConfirm,
}: PlansListSheetProps) {
  const view = PLAN_TYPE_VIEWS[type]
  const rows = plansSortedByNextDue(plans.filter((plan) => plan.type === type))
  const { scrollHandler, buttonTranslationY } = useSheetFooterScroll()

  return (
    <BottomSheet
      ref={ref}
      testID="plans-list-sheet"
      snapPoints={['70%']}
      stackBehavior="push"
      footerComponent={(props) => (
        <SheetFooter
          {...props}
          testID="plans-list-add"
          buttonTranslationY={buttonTranslationY}
          onPress={() => onAdd(type)}
          label={view.addAction}
        />
      )}
    >
      {/* Header + scroll view as DIRECT children (the category-cashflow
          structure): an extra flex-1 BottomSheetView wrapper around the
          scroll view breaks the sheet's scroll-gesture coordination, and
          Maestro scrolls stop working inside it. */}
      <BottomSheetHeader title={view.cardTitle} subtitle={view.cardDescription} />
      <AnimatedBottomSheetScrollView testID="plans-list-sheet" onScroll={scrollHandler}>
        {/* pb-32 clears the pinned footer pill and its gradient fade. */}
        <View className="gap-1 px-4 pb-32">
          {rows.length === 0 ? (
            <Text variant="body-sm" className="py-2 text-muted-foreground">
              {PLANS_COPY.listEmpty}
            </Text>
          ) : (
            rows.map((plan) => (
              <PlanRow
                key={plan.id}
                plan={plan}
                categories={categories}
                presentation={presentation}
                author={author}
                onPress={() => onEdit(plan)}
                onConfirm={() => onConfirm(plan)}
              />
            ))
          )}
        </View>
      </AnimatedBottomSheetScrollView>
    </BottomSheet>
  )
}

function PlanRow({
  plan,
  categories,
  presentation,
  author,
  onPress,
  onConfirm,
}: {
  plan: PlannedPayment
  categories: Category[]
  presentation: MoneyPresentation
  author?: { members: readonly HouseholdMember[]; currentUserId: string | null | undefined }
  onPress: () => void
  onConfirm: () => void
}) {
  // The visible "today" is the user's local calendar day.
  const overdue = isPlanOverdue(plan, calendarDayKey(new Date()))
  const title = planRowTitle(plan, categories)
  const subtitle = `${PLANS_REGULARITY_PHRASES[plan.regularity]} · ${nextDueLabel(plan.nextDue)}`
  const currency = nativeCurrencyOf(plan, presentation)
  const authorMarker = author
    ? authorLabel(plan.authorId, author.members, author.currentUserId)
    : null

  return (
    <Pressable
      testID={`plans-row-${plan.id}`}
      accessibilityLabel={`${title}, ${formatAmount(plan.amount, currency)}, ${subtitle}`}
      className="flex-row items-center gap-3 py-3 active:opacity-70"
      onPress={onPress}
    >
      <View className="flex-1 gap-1">
        <View className="flex-row items-center gap-2">
          <Text variant="body" className="flex-1 text-foreground" numberOfLines={1}>
            {title}
          </Text>
          <Text variant="body" className="font-medium text-foreground">
            {formatAmount(plan.amount, currency)}
          </Text>
        </View>
        <View className="flex-row items-center gap-2">
          <Text variant="caption" className="text-muted-foreground">
            {subtitle}
          </Text>
          {authorMarker ? (
            <Text
              variant="caption"
              className="text-muted-foreground"
              testID={`plans-row-${plan.id}-author`}
            >
              {authorMarker}
            </Text>
          ) : null}
          {overdue ? (
            <View
              className="rounded-full bg-destructive/15 px-2 py-0.5"
              testID={`plans-row-${plan.id}-overdue`}
            >
              <Text variant="caption" className="text-destructive">
                {PLANS_COPY.overdueBadge}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
      {plan.confirmMode === 'manual' ? (
        <IconButton
          icon="checkmark-circle-outline"
          size="md"
          colorClassName="accent-primary"
          accessibilityLabel={`${PLANS_COPY.confirmTitle}: ${title}`}
          testID={`plans-row-${plan.id}-confirm`}
          onPress={onConfirm}
        />
      ) : null}
      <Icon name="chevron-forward" size={16} colorClassName="accent-muted-foreground" />
    </Pressable>
  )
}
