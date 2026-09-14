// Analytics tab: two current-month overview cards (expenses / income) with
// a donut-by-category chart and a matching legend each (design D5-D7). The
// tab always shows the current device-local month - week/month/year
// exploration lives on the detail screen.
// TODO(i18n): RU copy stays hardcoded until react-i18next is wired (see
// apps/mobile/AGENTS.md §i18n).

import { ScrollView, View } from 'react-native'
import { useRouter } from 'expo-router'
import type { Category, Transaction } from '@trata/api'
import { currentPeriod, monthLabel, periodToUtcDayRange, type PeriodCursor } from '@trata/dates'
import {
  ChartLegend,
  DonutChart,
  categoryTotals,
  chartTotal,
  periodTotal,
  toChartEntries,
  useAnalyticsPresentation,
  type AnalyticsDirection,
  type ChartEntry,
} from '@/features/analytics'
import { useCategoriesIncludingArchived } from '@/entities/category'
import { useTransactions } from '@/entities/transaction'
import { Card } from '@/shared/ui/card'
import { Icon } from '@/shared/ui/icon'
import { Pressable } from '@/shared/ui/pressable'
import { Screen } from '@/shared/ui/screen'
import { Text } from '@/shared/ui/text'
import {
  aggregateDetailText,
  aggregateHeroText,
  rateDateLabel,
  type MoneyPresentation,
} from '@/shared/lib/money/aggregate'

const DIRECTION_VIEWS: Record<
  AnalyticsDirection,
  { title: string; testId: string; emptyText: string }
> = {
  expense: {
    title: 'Расходы',
    testId: 'analytics-card-expenses',
    // TODO(spec-drift): the analytics spec's tab-card empty state is now a
    // neutral-ring donut with the zero total in the center and this message
    // in the legend's slot (web: web-analytics-empty-donut). Mobile keeps
    // the legacy text-only state until a parity change lands - see
    // docs/technical-debt.md (Mobile).
    emptyText: 'Нет расходов за этот период',
  },
  income: {
    title: 'Доходы',
    testId: 'analytics-card-income',
    emptyText: 'Нет доходов за этот период',
  },
}

/** Compact speech summary of the capped breakdown ("Такси 66%, Кафе 20%"). */
function chartSummaryLabel(entries: ChartEntry[], unitTotal: number | null): string {
  // Percentages need one shared unit; the missing-rates degradation names
  // the exact per-currency figures instead.
  if (unitTotal === null || unitTotal <= 0) {
    return entries.map((entry) => `${entry.label} ${entry.amountText}`).join(', ')
  }
  return entries
    .map((entry) => `${entry.label} ${Math.round((entry.totalMinor / unitTotal) * 100)}%`)
    .join(', ')
}

interface OverviewCardProps {
  direction: AnalyticsDirection
  cursor: PeriodCursor
  transactions: Transaction[]
  categories: Category[]
  presentation: MoneyPresentation
  onPress: () => void
}

function AnalyticsOverviewCard({
  direction,
  cursor,
  transactions,
  categories,
  presentation,
  onPress,
}: OverviewCardProps) {
  const view = DIRECTION_VIEWS[direction]
  const totals = categoryTotals(transactions, categories, cursor, direction, presentation)
  const total = periodTotal(transactions, cursor, direction, presentation)
  const entries = toChartEntries(totals)
  const unitTotal = chartTotal(total)
  const monthName = monthLabel(cursor.start.getFullYear(), cursor.start.getMonth())

  return (
    <Pressable
      testID={view.testId}
      accessibilityRole="button"
      accessibilityLabel={`${view.title} за ${monthName} ${cursor.start.getFullYear()}, ${aggregateHeroText(total)}`}
      onPress={onPress}
    >
      <Card variant="elevated" className="gap-4">
        <View className="flex-row items-center justify-between">
          <Text variant="h3">{view.title}</Text>
          <Icon name="chevron-forward" size={20} colorClassName="accent-muted-foreground" />
        </View>
        {entries.length === 0 ? (
          <Text variant="body-sm" className="text-muted-foreground">
            {view.emptyText}
          </Text>
        ) : (
          <View className="flex-row items-center gap-5">
            <DonutChart
              segments={entries.map((entry) => ({
                id: entry.id,
                value: entry.totalMinor,
                color: entry.color,
              }))}
              size={120}
              strokeWidth={14}
              accessibilityLabel={`${view.title} по категориям: ${chartSummaryLabel(entries, unitTotal)}`}
            >
              <View className="items-center px-3">
                <Text variant="caption" className="uppercase text-muted-foreground">
                  СУММА
                </Text>
                <Text variant="label" className="font-semibold">
                  {aggregateHeroText(total)}
                </Text>
              </View>
            </DonutChart>
            <ChartLegend entries={entries} testIdPrefix={`${view.testId}-legend`} />
          </View>
        )}
        {/* The «≈» figure carries its exact per-currency breakdown and the
            rate's as-of date (the exchange-rates presentation rule). */}
        {total.converted && presentation.rates ? (
          <Text
            variant="caption"
            className="text-muted-foreground"
            testID={`analytics-${direction}-rate-date`}
          >
            {aggregateDetailText(total)} · курс на {rateDateLabel(presentation.rates.asOf)}
          </Text>
        ) : null}
      </Card>
    </Pressable>
  )
}

export function AnalyticsScreen() {
  const router = useRouter()

  const cursor = currentPeriod('month')
  const range = periodToUtcDayRange(cursor)
  const expenseQuery = useTransactions({ type: 'expense', ...range })
  const incomeQuery = useTransactions({ type: 'income', ...range })
  const categoriesQuery = useCategoriesIncludingArchived()
  const categories = categoriesQuery.data ?? []
  const presentation = useAnalyticsPresentation()

  const handleOpenDetail = (direction: AnalyticsDirection) => {
    router.push({ pathname: '/analytics-detail', params: { type: direction } })
  }

  return (
    <Screen testID="screen-analytics">
      <ScrollView>
        <View className="gap-6 p-6">
          <Text variant="display">Аналитика</Text>
          <AnalyticsOverviewCard
            direction="expense"
            cursor={cursor}
            transactions={expenseQuery.data ?? []}
            categories={categories}
            presentation={presentation}
            onPress={() => handleOpenDetail('expense')}
          />
          <AnalyticsOverviewCard
            direction="income"
            cursor={cursor}
            transactions={incomeQuery.data ?? []}
            categories={categories}
            presentation={presentation}
            onPress={() => handleOpenDetail('income')}
          />
        </View>
      </ScrollView>
    </Screen>
  )
}
