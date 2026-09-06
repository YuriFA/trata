<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { periodToUtcDayRange, type PeriodCursor } from '@expense-tracker/dates'
import { categoryTotals, periodTotal, percentLabel } from '@/entities/analytics'
import { useTransactions } from '@/entities/transaction'
import { CategoryAvatar } from '@/shared/ui/category-avatar'
import { useCategoriesIncludingArchived } from '@/entities/category'
import type { Category } from '@expense-tracker/api'
import { CategoryCashflowDialog } from '@/widgets/category-cashflow-dialog'
import { NewCategoryDialog } from '@/features/transaction/add'
import DashboardCard from './DashboardCard.vue'
import { Skeleton } from '@/shared/ui/skeleton'
import { ErrorState } from '@/shared/ui/error-state'
import { DEFAULT_CURRENCY, formatMoney } from '@/shared/lib/money'

// Expense breakdown of the selected dashboard month (the page owns the
// period cursor), derived in memory with the same selectors as the
// analytics page (analytics capability) - no extra backend aggregate.
// The dashed footer row opens the shared new-category dialog (expenses);
// a row opens the category's month transactions in the shared overlay.
const props = defineProps<{
  /** Selected dashboard month; the breakdown re-scopes with it. */
  cursor: PeriodCursor
}>()
const { t, locale } = useI18n()
const range = computed(() => periodToUtcDayRange(props.cursor))

const {
  data: transactions,
  isPending: transactionsPending,
  error: txError,
  refetch: refetchTx,
} = useTransactions(() => ({ type: 'expense', ...range.value }))
const {
  data: categories,
  isPending: categoriesPending,
  error: categoriesError,
  refetch: refetchCategories,
  // Including archived: this is a join over existing records -
  // archived categories stay visible in history/analytics/filters.
} = useCategoriesIncludingArchived()

// Skeletons only while NO data exists yet: background refetches
// (invalidation, sync cycle) keep the rendered rows in place.
const isPending = computed(() => transactionsPending.value || categoriesPending.value)
const error = computed(() => txError.value || categoriesError.value)
const refetch = () => Promise.all([refetchTx(), refetchCategories()])

const totalMinor = computed(() => periodTotal(transactions.value ?? [], props.cursor, 'expense'))
const rows = computed(() =>
  categoryTotals(transactions.value ?? [], categories.value ?? [], props.cursor, 'expense'),
)

const format = (value: number) => formatMoney(value, DEFAULT_CURRENCY, locale.value)

// The "+" prefix is a glyph, not copy - composed in script (i18n lint).
const addCategoryLabel = computed(() => `+ ${t('addCategory.newCategory')}`)

const newCategoryOpen = ref(false)

// Drill-down (web-screens spec): one dialog instance + the active category.
// Clearing the category on close remounts the overlay per peek, so each
// activation snapshots the dashboard's current month cursor.
const drilldownOpen = ref(false)
const drilldownCategory = ref<Category | null>(null)

const openDrilldown = (category: Category) => {
  drilldownCategory.value = category
  drilldownOpen.value = true
}

const setDrilldownOpen = (open: boolean) => {
  drilldownOpen.value = open
  if (!open) drilldownCategory.value = null
}
</script>

<template>
  <DashboardCard
    :title="t('dashboard.categoriesTitle')"
    content-class="px-0!"
    data-testid="dashboard-category-breakdown"
  >
    <ErrorState v-if="error" @retry="refetch" />
    <template v-else-if="isPending">
      <div v-for="n in 3" :key="n" class="flex items-center gap-3 py-3">
        <Skeleton class="size-9 rounded-full" />
        <Skeleton class="h-4 flex-1" />
        <Skeleton class="h-4 w-20" />
      </div>
    </template>
    <p v-else-if="totalMinor <= 0" class="py-6 px-4 md:px-6 text-sm text-muted-foreground">
      {{ t('analytics.emptyMonthExpense') }}
    </p>
    <div v-else>
      <button
        v-for="row in rows"
        :key="row.category.id"
        type="button"
        class="flex w-full items-center gap-3 border-b border-border px-4 md:px-6 py-3 text-left transition-colors last:border-0 hover:bg-muted/40"
        :data-testid="`dashboard-category-row-${row.category.id}`"
        @click="openDrilldown(row.category)"
      >
        <CategoryAvatar :icon="row.category.icon" :color="row.category.color" class="size-9" />
        <p class="min-w-0 flex-1 truncate text-sm font-semibold">{{ row.category.name }}</p>
        <div class="text-right">
          <p class="text-sm font-bold tabular-nums">{{ format(row.totalMinor) }}</p>
          <p class="text-xs font-medium uppercase text-muted-foreground tabular-nums">
            {{ percentLabel(row.totalMinor, totalMinor, locale) }}
          </p>
        </div>
      </button>
    </div>
    <button
      v-if="!error"
      type="button"
      class="w-full border-t border-dashed border-border py-3 md:py-4 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
      data-testid="dashboard-add-category"
      @click="newCategoryOpen = true"
    >
      {{ addCategoryLabel }}
    </button>
  </DashboardCard>
  <NewCategoryDialog v-model:open="newCategoryOpen" type="expense" />
  <CategoryCashflowDialog
    v-if="drilldownCategory"
    :key="drilldownCategory.id"
    :open="drilldownOpen"
    :category="drilldownCategory"
    direction="expense"
    :cursor="cursor"
    @update:open="setDrilldownOpen"
  />
</template>
