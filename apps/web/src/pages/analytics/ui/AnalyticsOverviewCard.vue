<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'
import { ChevronRight } from '@lucide/vue'
import { currentPeriod, monthLabel } from '@trata/dates'
import type { Category, Transaction } from '@trata/api'
import {
  categoryTotals,
  periodTotal,
  percentLabel,
  toChartEntries,
  type AnalyticsDirection,
} from '@/entities/analytics'
import { DonutChart, type DonutChartEntry } from '@/shared/ui/donut-chart'
import { ChartLegend } from '@/shared/ui/donut-chart'
import { CardAction, CardContent, CardHeader, CardTitle } from '@/shared/ui/card'
import { DEFAULT_CURRENCY, formatMoney } from '@/shared/lib/money'

const props = defineProps<{
  direction: AnalyticsDirection
  transactions: readonly Transaction[]
  categories: readonly Category[]
}>()

const { t, locale } = useI18n()
// Analytics totals are plain minor-unit sums with no conversion (analytics
// capability); the currency-less total is formatted in the fixed app
// display currency (currency-rub-only).
const displayCurrency = computed(() => DEFAULT_CURRENCY)

// The overview always shows the current device-local month; week/month/year
// selection lives on the detail screen (analytics capability).
const cursor = currentPeriod('month')

const title = computed(() =>
  props.direction === 'expense' ? t('analytics.expenses') : t('analytics.income'),
)
const total = computed(() => periodTotal(props.transactions, cursor, props.direction))
const entries = computed(() =>
  toChartEntries(categoryTotals(props.transactions, props.categories, cursor, props.direction), {
    top: 5,
    otherLabel: t('analytics.other'),
  }),
)
const totalText = computed(() => formatMoney(total.value, displayCurrency.value, locale.value))
const legendEntries = computed(() =>
  entries.value.map((entry) => ({
    ...entry,
    percent: percentLabel(entry.totalMinor, total.value, locale.value),
  })),
)
const donutEntries = computed<DonutChartEntry[]>(() =>
  entries.value.map((entry) => ({
    id: entry.id,
    label: entry.label,
    color: entry.color,
    value: entry.totalMinor,
  })),
)
const testId = computed(() =>
  props.direction === 'expense' ? 'analytics-card-expenses' : 'analytics-card-income',
)
const a11yLabel = computed(
  () =>
    `${title.value}, ${monthLabel(cursor.start.getFullYear(), cursor.start.getMonth(), locale.value)} ${cursor.start.getFullYear()}, ${totalText.value}`,
)

// No movement in the period: the donut renders its built-in neutral ring
// with the zero total in the center, and the empty-state message takes the
// legend's slot (analytics spec - donut presentation).
const hasData = computed(() => total.value > 0)
const emptyText = computed(() =>
  props.direction === 'expense' ? t('analytics.emptyExpense') : t('analytics.emptyIncome'),
)
// The empty chart announces the same message shown beside it; with data it
// summarizes title + period + total like the card link's label.
const chartAriaLabel = computed(() => (hasData.value ? a11yLabel.value : emptyText.value))
</script>

<template>
  <!-- The link IS the card surface (Card has no as-child): card classes on
       the link; the hover/focus ring matches the dashboard's clickable
       StatCard link (ring, no lift). -->
  <RouterLink
    :to="`/analytics/${direction}`"
    :data-testid="testId"
    :aria-label="a11yLabel"
    class="group bg-card text-card-foreground flex flex-col gap-2 rounded-lg border py-4 transition-shadow duration-200 hover:ring-1 hover:ring-muted-foreground/30 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring/50 md:py-6"
  >
    <CardHeader>
      <CardTitle>{{ title }}</CardTitle>
      <CardAction>
        <ChevronRight
          class="size-4 text-muted-foreground transition-transform duration-200 group-hover:translate-x-0.5"
          aria-hidden="true"
        />
      </CardAction>
    </CardHeader>
    <CardContent>
      <div class="flex items-center gap-6">
        <DonutChart
          :entries="donutEntries"
          :size="120"
          :stroke-width="14"
          :aria-label="chartAriaLabel"
        >
          <span class="text-[0.65rem] font-medium uppercase tracking-wide text-muted-foreground">
            {{ t('analytics.amountCaption') }}
          </span>
          <span class="text-sm font-semibold">{{ totalText }}</span>
        </DonutChart>
        <ChartLegend v-if="hasData" :entries="legendEntries" />
        <p v-else class="text-sm text-muted-foreground">{{ emptyText }}</p>
      </div>
    </CardContent>
  </RouterLink>
</template>
