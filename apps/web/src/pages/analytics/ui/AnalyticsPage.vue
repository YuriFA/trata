<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { currentPeriod, monthLabel, periodToUtcDayRange } from '@trata/dates'
import { useTransactions } from '@/entities/transaction'
import { useCategoriesIncludingArchived } from '@/entities/category'
import { ErrorState } from '@/shared/ui/error-state'
import { PageHeader } from '@/shared/ui/page-header'
import { Skeleton } from '@/shared/ui/skeleton'
import AnalyticsOverviewCard from './AnalyticsOverviewCard.vue'

const { t, locale } = useI18n()

// Both cards share one month-scoped read per direction; figures derive in
// memory from the selectors (no network dependency - analytics capability).
const cursor = currentPeriod('month')
const range = periodToUtcDayRange(cursor)

const monthCaption = computed(
  () =>
    `${monthLabel(cursor.start.getFullYear(), cursor.start.getMonth(), locale.value)} ${cursor.start.getFullYear()}`,
)

const {
  data: expenses,
  isPending: expensesPending,
  error: expensesError,
  refetch: refetchExpenses,
} = useTransactions({ type: 'expense', ...range })
const {
  data: incomes,
  isPending: incomesPending,
  error: incomesError,
  refetch: refetchIncomes,
} = useTransactions({ type: 'income', ...range })
const {
  data: categories,
  isPending: categoriesPending,
  error: categoriesError,
  refetch: refetchCategories,
  // Including archived: this is a join over existing records -
  // archived categories stay visible in history/analytics/filters.
} = useCategoriesIncludingArchived()

// Skeletons only while NO data exists yet: background refetches
// (invalidation, sync cycle) keep the rendered cards in place.
const isPending = computed(
  () => expensesPending.value || incomesPending.value || categoriesPending.value,
)
const error = computed(() => expensesError.value || incomesError.value || categoriesError.value)
const refetch = () => Promise.all([refetchExpenses(), refetchIncomes(), refetchCategories()])
</script>

<template>
  <section>
    <PageHeader :title="t('pages.analytics')" :subtitle="monthCaption" />

    <div v-if="isPending" class="mt-6 grid gap-4 md:grid-cols-2">
      <Skeleton class="h-48 rounded-xl" data-testid="analytics-skeleton" />
      <Skeleton class="h-48 rounded-xl" />
    </div>
    <div v-else-if="error" class="mt-6">
      <ErrorState @retry="refetch" />
    </div>
    <div v-else class="mt-6 grid gap-4 md:grid-cols-2">
      <AnalyticsOverviewCard
        direction="expense"
        :transactions="expenses ?? []"
        :categories="categories ?? []"
      />
      <AnalyticsOverviewCard
        direction="income"
        :transactions="incomes ?? []"
        :categories="categories ?? []"
      />
    </div>
  </section>
</template>
