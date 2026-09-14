// Analytics detail: the period-scoped (week/month/year) expense or income
// breakdown by category for one direction (design D5-D7, D10). One
// parametrized screen, not two: the direction changes only copy and the
// query's type filter. The chart is interactive: tapping a segment selects
// its category (scaled segment, dimmed siblings, row moved to top), row
// checkboxes include/exclude categories from the chart (renormalized among
// the included; the list always shows full-period figures), and tapping a
// row drills into that category via the shared period-aware cashflow sheet.
// Periods step via the flanking arrows or a swipe over the chart: the swipe
// tracks the finger (the adjacent period's chart slides in during the drag -
// see PeriodChartCarousel) and the step settles on release. A period
// without movement renders the SAME composition with zero figures (neutral
// empty ring, every direction category listed at 0) - no separate empty
// state. Every period change resets selection and filtering.
// TODO(i18n): RU copy stays hardcoded until react-i18next is wired (see
// apps/mobile/AGENTS.md §i18n).

import { useRef, useState } from 'react'
import { View } from 'react-native'
import {
  currentPeriod,
  periodRangeLabel,
  periodToUtcDayRange,
  shiftPeriod,
  type AnalyticsPeriodKind,
  type PeriodCursor,
} from '@trata/dates'
import {
  DonutChart,
  OTHER_ENTRY_COLOR,
  categoryTotals,
  chartTotal,
  percentLabel,
  periodTotal,
  useAnalyticsPresentation,
  zeroCategoryTotal,
  type AnalyticsDirection,
  type CategoryTotal,
  type DonutSegment,
} from '@/features/analytics'
import { CASHFLOW_KIND_VIEWS, CategoryCashflowSheet } from '@/features/cashflow-overview'
import { NewTransactionSheet } from '@/features/create-transaction'
import { EditTransactionSheet } from '@/features/edit-transaction'
import { useCategoriesIncludingArchived, type Category } from '@/entities/category'
import { useTransactions, type Transaction } from '@/entities/transaction'
import { Button } from '@/shared/ui/button'
import { Card } from '@/shared/ui/card'
import { Icon } from '@/shared/ui/icon'
import { Pressable } from '@/shared/ui/pressable'
import { Screen } from '@/shared/ui/screen'
import { ScreenHeader, ScreenScrollView } from '@/shared/ui/screen-header'
import { Text } from '@/shared/ui/text'
import {
  aggregateDetailText,
  aggregateHeroText,
  rateDateLabel,
  type MoneyPresentation,
} from '@/shared/lib/money/aggregate'
import type { BottomSheetRef } from '@/shared/ui/bottom-sheet'
import { cn } from '@/shared/lib/utils'
import {
  CHART_SIZE,
  CHART_STROKE,
  PeriodChartCarousel,
  type PeriodCarouselPages,
} from './period-chart-carousel'

const PERIOD_KINDS: Array<{ kind: AnalyticsPeriodKind; label: string; testId: string }> = [
  { kind: 'week', label: 'Неделя', testId: 'analytics-period-week' },
  { kind: 'month', label: 'Месяц', testId: 'analytics-period-month' },
  { kind: 'year', label: 'Год', testId: 'analytics-period-year' },
]

const DIRECTION_VIEWS: Record<AnalyticsDirection, { title: string; allLabel: string }> = {
  expense: { title: 'Расходы', allLabel: 'Все расходы' },
  income: { title: 'Доходы', allLabel: 'Все доходы' },
}

// The content wrapper's horizontal padding (px-6 below); the carousel bleeds
// past it so its pages travel edge-to-edge (PeriodChartCarousel contentInset).
const CONTENT_INSET = 24

function neighborSegments(
  transactions: Transaction[],
  categories: Category[],
  cursor: PeriodCursor,
  direction: AnalyticsDirection,
  presentation: MoneyPresentation,
): DonutSegment[] {
  const withMovement = categoryTotals(
    transactions,
    categories,
    cursor,
    direction,
    presentation,
  ).filter(({ sortMinor }) => sortMinor > 0)
  if (withMovement.length === 0) {
    return [{ id: 'empty-period', value: 1, color: OTHER_ENTRY_COLOR }]
  }
  return withMovement.map(({ category, sortMinor }) => ({
    id: category.id,
    value: sortMinor,
    color: category.color,
  }))
}

/**
 * Round checkbox controlling chart inclusion. Category rows pass their
 * color: the circle is category-colored and the checkmark carries the state
 * (unchecked dims). The master toggle keeps the neutral primary/border look.
 */
function ChartCheckbox({
  checked,
  onToggle,
  testID,
  label,
  color,
}: {
  checked: boolean
  onToggle: () => void
  testID: string
  label: string
  color?: string
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={label}
      onPress={onToggle}
      className={cn(
        'h-6 w-6 items-center justify-center rounded-full border',
        color ? 'border-transparent' : checked ? 'border-primary bg-primary' : 'border-border',
        color && !checked && 'opacity-40',
      )}
      style={color ? { backgroundColor: color } : undefined}
    >
      {checked ? (
        <Icon
          name="checkmark"
          size={14}
          colorClassName={color ? 'accent-white' : 'accent-primary-foreground'}
        />
      ) : null}
    </Pressable>
  )
}

export interface AnalyticsDetailScreenProps {
  direction: AnalyticsDirection
}

export function AnalyticsDetailScreen({ direction }: AnalyticsDetailScreenProps) {
  const view = DIRECTION_VIEWS[direction]
  const { copy, ids } = CASHFLOW_KIND_VIEWS[direction]
  const [cursor, setCursor] = useState<PeriodCursor>(() => currentPeriod('month'))
  // Bumped on kind switches so the carousel tears any in-flight session down.
  const [resetEpoch, setResetEpoch] = useState(0)
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | undefined>(undefined)
  const [excludedIds, setExcludedIds] = useState<ReadonlySet<string>>(() => new Set())
  const [drillDownCategoryId, setDrillDownCategoryId] = useState<string | undefined>(undefined)
  const sheetRef = useRef<BottomSheetRef>(null)
  const newTransactionRef = useRef<BottomSheetRef>(null)
  const [prefillCategoryId, setPrefillCategoryId] = useState<string | undefined>(undefined)
  const editTransactionRef = useRef<BottomSheetRef>(null)
  const [editingTransactionId, setEditingTransactionId] = useState<string | undefined>(undefined)

  const transactionsQuery = useTransactions({ type: direction, ...periodToUtcDayRange(cursor) })
  // Adjacent periods feed the carousel's neighbor pages; their query keys
  // differ per period, so they are simply always mounted (cheap local reads).
  const prevCursor = shiftPeriod(cursor, -1)
  const nextCursor = shiftPeriod(cursor, 1)
  const prevTransactions =
    useTransactions({ type: direction, ...periodToUtcDayRange(prevCursor) }).data ?? []
  const nextTransactions =
    useTransactions({ type: direction, ...periodToUtcDayRange(nextCursor) }).data ?? []
  const categoriesQuery = useCategoriesIncludingArchived(direction)
  const transactions = transactionsQuery.data ?? []
  const categories = categoriesQuery.data ?? []

  const presentation = useAnalyticsPresentation()

  const total = periodTotal(transactions, cursor, direction, presentation)
  const rangeLabel = periodRangeLabel(cursor)
  const kind = cursor.kind

  // The list shows EVERY direction category (0 when without movement);
  // the chart charts the included categories with movement.
  const movementTotals = categoryTotals(transactions, categories, cursor, direction, presentation)
  const movementByCategory = new Map(movementTotals.map((total) => [total.category.id, total]))
  const allTotals: CategoryTotal[] = categories
    .map(
      (category) =>
        movementByCategory.get(category.id) ??
        zeroCategoryTotal(category, presentation.displayCurrency),
    )
    .sort((a, b) => b.sortMinor - a.sortMinor)

  // Every period change resets selection and filtering and the carousel
  // commits through the stepper (conventions §2 - the reset lives in the
  // handlers, not in an effect).
  const applyPeriod = (next: PeriodCursor) => {
    setCursor(next)
    setSelectedCategoryId(undefined)
    setExcludedIds(new Set())
  }
  const handleCarouselCommit = (step: 1 | -1) => applyPeriod(shiftPeriod(cursor, step))
  // A kind switch jumps the cursor outside the stepper, so any in-flight
  // carousel session must be dropped (resetEpoch drives the teardown).
  const handleSelectKind = (nextKind: AnalyticsPeriodKind) => {
    applyPeriod(currentPeriod(nextKind))
    setResetEpoch((epoch) => epoch + 1)
  }

  const handleToggleCategory = (categoryId: string) => {
    if (categoryId === selectedCategoryId) setSelectedCategoryId(undefined)
    setExcludedIds((current) => {
      const next = new Set(current)
      if (next.has(categoryId)) next.delete(categoryId)
      else next.add(categoryId)
      return next
    })
  }
  const includedTotals = allTotals.filter(({ category }) => !excludedIds.has(category.id))
  const allIncluded = includedTotals.length === allTotals.length
  const handleToggleAll = () => {
    setExcludedIds(() =>
      allIncluded ? new Set(allTotals.map(({ category }) => category.id)) : new Set(),
    )
  }

  const handlePressSegment = (segmentId: string) => {
    setSelectedCategoryId((current) => (current === segmentId ? undefined : segmentId))
  }
  const handleOpenCategory = (categoryId: string) => {
    setDrillDownCategoryId(categoryId)
    sheetRef.current?.present()
  }
  const handleNewTransaction = (categoryId: string | undefined) => {
    setPrefillCategoryId(categoryId)
    newTransactionRef.current?.present()
  }
  const handleEditTransaction = (id: string) => {
    setEditingTransactionId(id)
    editTransactionRef.current?.present()
  }

  const includedWithMovement = includedTotals.filter(({ sortMinor }) => sortMinor > 0)
  const chartSegments: DonutSegment[] =
    includedWithMovement.length === 0
      ? [{ id: 'empty-period', value: 1, color: OTHER_ENTRY_COLOR }]
      : includedWithMovement.map(({ category, sortMinor }) => ({
          id: category.id,
          value: sortMinor,
          color: category.color,
        }))

  const carouselPages: PeriodCarouselPages = {
    prev: {
      segments: neighborSegments(prevTransactions, categories, prevCursor, direction, presentation),
      rangeLabel: periodRangeLabel(prevCursor).toUpperCase(),
    },
    cur: {
      segments: chartSegments,
      rangeLabel: rangeLabel.toUpperCase(),
      selectedSegmentId: selectedCategoryId,
    },
    next: {
      segments: neighborSegments(nextTransactions, categories, nextCursor, direction, presentation),
      rangeLabel: periodRangeLabel(nextCursor).toUpperCase(),
    },
  }

  const orderedTotals = selectedCategoryId
    ? [
        ...allTotals.filter(({ category }) => category.id === selectedCategoryId),
        ...allTotals.filter(({ category }) => category.id !== selectedCategoryId),
      ]
    : allTotals

  // Percentages need one shared unit (the «≈» conversion or a single
  // currency); the missing-rates degradation names exact figures instead.
  const unitTotal = chartTotal(total)
  const chartSummary =
    unitTotal === null
      ? movementTotals
          .map(({ category, amountText }) => `${category.name} ${amountText}`)
          .join(', ')
      : unitTotal > 0
        ? movementTotals
            .map(
              ({ category, sortMinor }) =>
                `${category.name} ${Math.round((sortMinor / unitTotal) * 100)}%`,
            )
            .join(', ')
        : 'нет данных за период'

  const sheetCategory = categories.find((category) => category.id === drillDownCategoryId)

  return (
    <Screen testID="screen-analytics-detail" topInset={false}>
      <ScreenHeader title={view.title} />

      <ScreenScrollView>
        <View className="gap-6 px-6 pb-8">
          <View className="flex-row gap-2">
            {PERIOD_KINDS.map((option) => (
              <Button
                key={option.kind}
                variant={option.kind === kind ? 'primary' : 'outline'}
                text={option.label}
                className="flex-1"
                onPress={() => handleSelectKind(option.kind)}
                testID={option.testId}
                accessibilityState={{ selected: option.kind === kind }}
              />
            ))}
          </View>
          <View className="gap-1 self-start" testID="analytics-detail-total">
            <View className="flex-row items-baseline gap-2">
              <Text variant="h2" className="font-bold">
                {aggregateHeroText(total)}
              </Text>
              <Text variant="caption">всего</Text>
              {/* The «≈» figure names its rate's as-of date. */}
              {total.converted && presentation.rates ? (
                <Text variant="caption" testID="analytics-total-rate-date">
                  курс на {rateDateLabel(presentation.rates.asOf)}
                </Text>
              ) : null}
            </View>
            {/* The exact per-currency breakdown under a converted hero. */}
            {aggregateDetailText(total) ? (
              <Text variant="caption" className="text-muted-foreground">
                {aggregateDetailText(total)}
              </Text>
            ) : null}
          </View>

          {/* Only the chart steps - the swipe tracks the finger and settles
              on release; the total, arrows, and breakdown stay static. */}
          <PeriodChartCarousel
            pages={carouselPages}
            onCommit={handleCarouselCommit}
            resetEpoch={resetEpoch}
            contentInset={CONTENT_INSET}
          >
            <DonutChart
              segments={chartSegments}
              size={CHART_SIZE}
              strokeWidth={CHART_STROKE}
              selectedSegmentId={selectedCategoryId}
              onPressSegment={handlePressSegment}
              accessibilityLabel={`${view.title} по категориям: ${chartSummary}`}
            >
              <Text
                variant="label"
                className="px-6 text-center uppercase text-muted-foreground"
                testID="analytics-period-label"
              >
                {rangeLabel.toUpperCase()}
              </Text>
            </DonutChart>
          </PeriodChartCarousel>

          <Card variant="elevated" className="gap-4" testID="analytics-category-list">
            <View className="flex-row items-center gap-3" testID="analytics-total-row">
              <ChartCheckbox
                checked={allIncluded}
                onToggle={handleToggleAll}
                testID="analytics-total-check"
                label={`${view.allLabel}, показывать все категории`}
              />
              <Text variant="body" className="flex-1 font-semibold">
                {view.allLabel}
              </Text>
              <View className="items-end">
                <Text variant="body" className="font-semibold">
                  {aggregateHeroText(total)}
                </Text>
                {unitTotal !== null ? <Text variant="caption">100%</Text> : null}
              </View>
            </View>
            {orderedTotals.map(({ category, amountText, sortMinor }) => (
              <Pressable
                key={category.id}
                className={cn(
                  'flex-row items-center gap-3',
                  selectedCategoryId !== undefined &&
                    category.id !== selectedCategoryId &&
                    'opacity-50',
                )}
                testID={`analytics-category-${category.id}`}
                accessibilityRole="button"
                accessibilityLabel={copy.categoryRowA11yLabel(category.name)}
                onPress={() => handleOpenCategory(category.id)}
              >
                <ChartCheckbox
                  checked={!excludedIds.has(category.id)}
                  onToggle={() => handleToggleCategory(category.id)}
                  testID={`analytics-category-check-${category.id}`}
                  label={`${category.name}, показывать на графике`}
                  color={category.color}
                />
                <Text variant="body" className="flex-1">
                  {category.name}
                </Text>
                <View className="items-end">
                  <Text variant="body" className="font-semibold">
                    {amountText}
                  </Text>
                  {/* Percentages exist only in a shared unit; the
                      missing-rates degradation hides them entirely. */}
                  {unitTotal !== null ? (
                    <Text variant="caption">{percentLabel(sortMinor, unitTotal)}</Text>
                  ) : null}
                </View>
              </Pressable>
            ))}
          </Card>
        </View>
      </ScreenScrollView>

      <CategoryCashflowSheet
        ref={sheetRef}
        kind={direction}
        category={sheetCategory}
        categories={categories}
        initialPeriod={cursor}
        onNewTransaction={handleNewTransaction}
        onEditTransaction={handleEditTransaction}
      />
      <NewTransactionSheet
        ref={newTransactionRef}
        kind={direction}
        defaultCategoryId={prefillCategoryId}
        testID={ids.categoryNewTransactionSheet}
      />
      <EditTransactionSheet ref={editTransactionRef} transactionId={editingTransactionId} />
    </Screen>
  )
}
