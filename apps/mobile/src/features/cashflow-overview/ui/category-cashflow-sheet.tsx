// Category cashflow sheet (reference redesign): close/edit header, an
// in-sheet month navigator (own cursor - the screen month is only the
// opening state), the period total, a newest/oldest sort toggle, and the
// kind's transactions grouped by day with per-day totals. The footer pill
// stacks the transaction-creation sheet with this category preselected.
// Data comes from the sheet's own repository query filtered by category +
// kind + a UTC day range covering the in-sheet month; the selectors then
// trim that superset to the exact local month, so the sheet's list and
// total converge with the screen's category breakdown.
//
// The sheet stays mounted even without a category (it just shows fallback
// content): present() is called from the category row in the same tick that
// selects the category, so the ref must already be attached.

import { Fragment, useMemo, useRef, useState } from 'react'
import { View } from 'react-native'
import Animated from 'react-native-reanimated'
import type { Category } from '@trata/api'
import {
  monthRangeLabelShort,
  periodRangeLabel,
  periodToUtcDayRange,
  shiftPeriod,
  type MonthCursor,
  type PeriodCursor,
} from '@trata/dates'
import { useTransactions } from '@/entities/transaction'
import { Icon } from '@/shared/ui/icon'
import { IconButton } from '@/shared/ui/icon-button'
import { Pressable } from '@/shared/ui/pressable'
import { Text } from '@/shared/ui/text'
import { cn } from '@/shared/lib/utils'
import {
  BottomSheet,
  BottomSheetBody,
  BottomSheetHeader,
  BottomSheetRef,
  BottomSheetScrollView,
} from '@/shared/ui/bottom-sheet'
import { formatAmount } from '@/shared/lib/format/format'
import {
  cashflowDayGroupsInPeriod,
  currentMonth,
  totalCashflowInPeriod,
  type CashflowDayGroup,
  type CashflowKind,
} from '../model/selectors'
import { useCashflowAuthor } from '../model/use-cashflow-author'
import { CASHFLOW_KIND_VIEWS } from './kind'
import { EditCategorySheet } from './edit-category-sheet'
import { SheetFooter, useSheetFooterScroll } from '@/shared/ui/sheet-footer'

export interface CategoryCashflowSheetProps {
  ref: React.Ref<BottomSheetRef>
  kind: CashflowKind
  /** The category whose transactions are listed; falls back to neutral content. */
  category: Category | undefined
  categories: Category[]
  /**
   * The month the sheet opens on (existing dashboard/income callers); the
   * in-sheet navigator takes over after. Provide exactly one of
   * `initialCursor` / `initialPeriod`.
   */
  initialCursor?: MonthCursor
  /**
   * Analytics-period mode: the sheet opens on this week/month/year and its
   * navigator steps periods of the same kind. When omitted, the sheet runs
   * in the original month mode (short month label, month-step a11y labels).
   */
  initialPeriod?: PeriodCursor
  /**
   * Opens the kind's new-transaction sheet with this category preselected.
   * Composed by the hosting page (features must not import the
   * create-transaction slice - invariant #15).
   */
  onNewTransaction: (categoryId: string | undefined) => void
  /**
   * Opens the edit sheet for the tapped row. Composed by the hosting page
   * (features must not import the edit-transaction slice - invariant #15).
   */
  onEditTransaction?: (id: string) => void
}

const AnimatedBottomSheetScrollView = Animated.createAnimatedComponent(BottomSheetScrollView)

/** Newest-first groups flipped to oldest-first, rows included. */
function reverseGroups(groups: CashflowDayGroup[]): CashflowDayGroup[] {
  return groups
    .slice()
    .reverse()
    .map((group) => ({ ...group, rows: group.rows.slice().reverse() }))
}

function monthCursorToPeriod(cursor: MonthCursor): PeriodCursor {
  return { kind: 'month', start: new Date(cursor.year, cursor.month, 1) }
}

export function CategoryCashflowSheet({
  kind,
  category,
  categories,
  initialCursor,
  initialPeriod,
  onNewTransaction,
  onEditTransaction,
  ref,
}: CategoryCashflowSheetProps) {
  const { copy, ids } = CASHFLOW_KIND_VIEWS[kind]
  const isMonthMode = initialPeriod === undefined
  const initialPeriodCursor = initialPeriod ?? monthCursorToPeriod(initialCursor ?? currentMonth())
  const [period, setPeriod] = useState<PeriodCursor>(initialPeriodCursor)
  const [sortAscending, setSortAscending] = useState(false)
  const editCategorySheetRef = useRef<BottomSheetRef>(null)
  const { scrollHandler, buttonTranslationY } = useSheetFooterScroll()

  const categoryQuery = useTransactions(
    { type: kind, categoryId: category?.id, ...periodToUtcDayRange(period) },
    { enabled: category !== undefined },
  )

  // Depends on `categoryQuery.data` (a stable reference per fetch), not a
  // `?? []` fallback computed at render time.
  const author = useCashflowAuthor()
  const { groups, totalText } = useMemo(() => {
    const categoryTransactions = categoryQuery.data ?? []
    return {
      groups: cashflowDayGroupsInPeriod(categoryTransactions, categories, period, kind, author),
      totalText: formatAmount(totalCashflowInPeriod(categoryTransactions, period, kind)),
    }
  }, [categoryQuery.data, categories, period, kind, author])
  const orderedGroups = sortAscending ? reverseGroups(groups) : groups
  const periodLabel = isMonthMode
    ? monthRangeLabelShort(period.start.getFullYear(), period.start.getMonth())
    : periodRangeLabel(period)
  const emptyText = period.kind === 'month' ? copy.monthEmpty : copy.periodEmpty

  const handleEdit = () => {
    editCategorySheetRef.current?.present()
  }

  // Every presentation starts at the opening period: the in-sheet
  // navigation is ephemeral per open, not a lasting selection.
  const handleSheetChange = (index: number) => {
    if (index >= 0) setPeriod(initialPeriodCursor)
  }

  return (
    <>
      <BottomSheet
        ref={ref}
        snapPoints={['90%']}
        stackBehavior="push"
        testID={ids.categorySheet}
        onChange={handleSheetChange}
        footerComponent={(props) => (
          <SheetFooter
            {...props}
            testID={ids.categoryNewTransactionButton}
            buttonTranslationY={buttonTranslationY}
            onPress={() => onNewTransaction(category?.id)}
            label={copy.newTransaction}
          />
        )}
      >
        <BottomSheetHeader
          title={category?.name ?? 'Категория'}
          right={
            <IconButton
              icon="create-outline"
              size="md"
              accessibilityLabel="Редактировать категорию"
              testID={ids.categoryEdit}
              onPress={handleEdit}
            />
          }
        />

        <View className="flex-row items-center justify-between px-4 py-2">
          <IconButton
            icon="chevron-back"
            size="sm"
            accessibilityLabel={isMonthMode ? 'Предыдущий месяц' : 'Предыдущий период'}
            testID={ids.categoryPrevMonth}
            onPress={() => setPeriod((current) => shiftPeriod(current, -1))}
          />
          <Text
            variant="body-sm"
            className="font-medium text-foreground"
            testID={ids.categoryPeriod}
          >
            {periodLabel}
          </Text>
          <IconButton
            icon="chevron-forward"
            size="sm"
            accessibilityLabel={isMonthMode ? 'Следующий месяц' : 'Следующий период'}
            testID={ids.categoryNextMonth}
            onPress={() => setPeriod((current) => shiftPeriod(current, 1))}
          />
        </View>

        <AnimatedBottomSheetScrollView testID={ids.categorySheet} onScroll={scrollHandler}>
          <BottomSheetBody className="gap-6 pt-2 pb-32">
            {/* TODO(i18n): RU wording until mobile i18n wiring lands. */}
            <Text variant="caption" testID={ids.categoryTotal}>
              {totalText} {copy.totalWord}
            </Text>

            <View className="flex-row items-center justify-between">
              <Text variant="button" className="font-medium text-foreground">
                {copy.allTitle}
              </Text>
              <IconButton
                icon={sortAscending ? 'arrow-up' : 'arrow-down'}
                size="sm"
                accessibilityLabel={sortAscending ? 'Сначала старые' : 'Сначала новые'}
                testID={ids.categorySort}
                onPress={() => setSortAscending((value) => !value)}
              />
            </View>

            {orderedGroups.length === 0 ? (
              <Text variant="body" className="text-muted-foreground">
                {emptyText}
              </Text>
            ) : (
              orderedGroups.map((group) => (
                <View key={group.key} className="gap-3" testID={`${ids.categoryDay}-${group.key}`}>
                  <View className="flex-row items-center justify-between">
                    <Text variant="button" className="font-medium text-foreground">
                      {group.title}
                    </Text>
                    <Text variant="button" className="text-muted-foreground">
                      {group.totalText}
                    </Text>
                  </View>

                  {group.rows.map((row, index) => (
                    <Fragment key={row.id}>
                      {index > 0 ? <View className="h-px bg-border/10" /> : null}
                      <Pressable
                        className="flex-row items-center gap-4"
                        testID={`${ids.categoryRowItem}-${row.id}`}
                        accessibilityRole="button"
                        accessibilityLabel={`Редактировать: ${row.description || row.categoryName}`}
                        disabled={!onEditTransaction}
                        onPress={() => onEditTransaction?.(row.id)}
                      >
                        <View
                          className={cn(
                            'h-10 w-10 items-center justify-center rounded-full',
                            row.categoryColor ? undefined : 'bg-muted',
                          )}
                          style={
                            row.categoryColor ? { backgroundColor: row.categoryColor } : undefined
                          }
                        >
                          <Icon name={row.categoryIcon} size={20} colorClassName="accent-white" />
                        </View>
                        <View className="flex-1 gap-0.5">
                          <Text variant="body" className="text-foreground" numberOfLines={1}>
                            {row.description || row.categoryName}
                          </Text>
                          {row.authorLabel ? (
                            <Text
                              variant="caption"
                              className="text-muted-foreground"
                              testID={`${ids.categoryRowItem}-${row.id}-author`}
                            >
                              {row.authorLabel}
                            </Text>
                          ) : null}
                        </View>
                        <Text variant="button">{row.amountText}</Text>
                      </Pressable>
                    </Fragment>
                  ))}
                </View>
              ))
            )}
          </BottomSheetBody>
        </AnimatedBottomSheetScrollView>
      </BottomSheet>

      <EditCategorySheet ref={editCategorySheetRef} category={category} />
    </>
  )
}
