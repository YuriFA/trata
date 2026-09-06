<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'
import { HandCoins, TrendingDown, TrendingUp, Wallet } from '@lucide/vue'
import {
  calendarDayKey,
  currentPeriod,
  isSamePeriod,
  monthLabel,
  periodToUtcDayRange,
  shiftPeriod,
  type PeriodCursor,
} from '@expense-tracker/dates'
import { periodTotal, type AnalyticsDirection } from '@/entities/analytics'
import { useAccounts } from '@/entities/account'
import { useTransactions } from '@/entities/transaction'
import { useDebtOperations, totalsByDirection } from '@/entities/debt-operation'
import { formatMoneyCompact, DEFAULT_CURRENCY } from '@/shared/lib/money'
import { PageHeader } from '@/shared/ui/page-header'
import { Skeleton } from '@/shared/ui/skeleton'
import { ErrorState } from '@/shared/ui/error-state'
import StatCard from './StatCard.vue'
import CategoryBreakdownCard from './CategoryBreakdownCard.vue'
import RecentTransactionsCard from './RecentTransactionsCard.vue'
import AccountsCard from './AccountsCard.vue'
import DebtsCard from './DebtsCard.vue'
import PlannedPaymentsAttentionCard from './PlannedPaymentsAttentionCard.vue'
import PeriodNav from './PeriodNav.vue'

// The overview starts on the current device-local month; the header
// navigator steps the cursor and the month-scoped queries rekey on the
// UTC-day superset range (figures derive in memory from the selectors).
// Snapshot cards (accounts, debts) are period-independent by nature.
const { t, locale } = useI18n()
const cursor = ref<PeriodCursor>(currentPeriod('month'))
const range = computed(() => periodToUtcDayRange(cursor.value))
const isCurrentPeriod = computed(() => isSamePeriod(cursor.value, currentPeriod('month')))
const monthCaption = computed(
  () =>
    `${monthLabel(cursor.value.start.getFullYear(), cursor.value.start.getMonth(), locale.value)} ${cursor.value.start.getFullYear()}`,
)
const goPrevPeriod = () => {
  cursor.value = shiftPeriod(cursor.value, -1)
}
const goNextPeriod = () => {
  cursor.value = shiftPeriod(cursor.value, 1)
}

const {
  data: accounts,
  isPending: accountsPending,
  error: accountsError,
  refetch: refetchAccounts,
} = useAccounts()
const {
  data: expenses,
  isPending: expensesPending,
  error: expensesError,
  refetch: refetchExpenses,
} = useTransactions(() => ({ type: 'expense', ...range.value }))
const {
  data: incomes,
  isPending: incomesPending,
  error: incomesError,
  refetch: refetchIncomes,
} = useTransactions(() => ({ type: 'income', ...range.value }))
const {
  data: debtOperations,
  isPending: debtsPending,
  error: debtsError,
  refetch: refetchDebts,
} = useDebtOperations()

// Skeletons only while NO data exists yet: background refetches
// (invalidation, sync cycle) keep the rendered stat cards in place.
const isPending = computed(
  () =>
    accountsPending.value || expensesPending.value || incomesPending.value || debtsPending.value,
)
const error = computed(
  () => accountsError.value || expensesError.value || incomesError.value || debtsError.value,
)
const refetch = () =>
  Promise.all([refetchAccounts(), refetchExpenses(), refetchIncomes(), refetchDebts()])

// Dashboard tiles show compact figures (whole units below one million, an
// abbreviated magnitude above) so long amounts fit the half-width mobile
// cards; exact values live one tap away on the linked screens.
const formatStat = (value: number) => formatMoneyCompact(value, DEFAULT_CURRENCY, locale.value)

const balanceMinor = computed(() =>
  (accounts.value ?? []).reduce((sum, account) => sum + (account.balance ?? 0), 0),
)
const periodTotalFor = (direction: AnalyticsDirection) =>
  periodTotal(
    direction === 'expense' ? (expenses.value ?? []) : (incomes.value ?? []),
    cursor.value,
    direction,
  )
const debtTotals = computed(() => totalsByDirection(debtOperations.value ?? []))

// The income/expense stat cards deep-link the transactions screen's URL
// filter: local calendar-day bounds of the selected month (the format
// transactions-query.ts parses), not the dashboard's UTC query superset.
const monthRange = computed(() => {
  const start = cursor.value.start
  const end = new Date(start.getFullYear(), start.getMonth() + 1, 0)
  return { from: calendarDayKey(start), to: calendarDayKey(end) }
})

const stats = computed(() => [
  {
    label: t('pages.accounts'),
    amount: formatStat(balanceMinor.value),
    icon: Wallet,
    tone: 'primary' as const,
    to: { path: '/accounts' },
  },
  {
    label: t('analytics.income'),
    amount: formatStat(periodTotalFor('income')),
    icon: TrendingUp,
    tone: 'success' as const,
    to: {
      path: '/transactions',
      query: { type: 'income', from: monthRange.value.from, to: monthRange.value.to },
    },
  },
  {
    label: t('analytics.expenses'),
    amount: formatStat(periodTotalFor('expense')),
    icon: TrendingDown,
    tone: 'warning' as const,
    to: {
      path: '/transactions',
      query: { type: 'expense', from: monthRange.value.from, to: monthRange.value.to },
    },
  },
  {
    label: t('pages.debts'),
    amount: formatStat(debtTotals.value.receivable - debtTotals.value.payable),
    icon: HandCoins,
    tone: 'neutral' as const,
    to: { path: '/debts' },
  },
])
</script>

<template>
  <section class="space-y-6">
    <!-- Title and the period navigator share one row (approved canvas
         «Обзор с переключателем периода» v3); below md the row wraps only
         if a viewport is too narrow for both. -->
    <PageHeader :title="t('dashboard.overview')">
      <template #actions>
        <PeriodNav
          :label="monthCaption"
          :prev-label="t('dashboard.prevMonth')"
          :next-label="t('dashboard.nextMonth')"
          :can-next="!isCurrentPeriod"
          @prev="goPrevPeriod"
          @next="goNextPeriod"
        />
      </template>
    </PageHeader>

    <ErrorState v-if="error" @retry="refetch" />
    <div v-else-if="isPending" class="grid grid-cols-2 gap-3 md:gap-4 xl:grid-cols-4">
      <Skeleton v-for="n in 4" :key="n" class="h-23 rounded-lg md:h-31" />
    </div>
    <div
      v-else
      class="grid grid-cols-2 gap-3 md:gap-4 xl:grid-cols-4"
      data-testid="dashboard-stats"
    >
      <!-- The link wraps the card surface: hover ring + focus ring give the
           clickability affordance; StatCard stays presentational. -->
      <RouterLink
        v-for="stat in stats"
        :key="stat.label"
        :to="stat.to"
        class="block min-w-0 rounded-lg cursor-pointer transition-shadow duration-200 hover:ring-1 hover:ring-muted-foreground/30 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <StatCard :label="stat.label" :amount="stat.amount" :icon="stat.icon" :tone="stat.tone" />
      </RouterLink>
    </div>

    <!-- No inline creation entry points (web-unified-transaction-entry):
         adding happens through the shell triggers (sidebar CTA / «N» /
         command palette) and the FAB speed-dial below 768px. -->

    <div class="grid gap-6 xl:grid-cols-3">
      <div class="space-y-6 xl:col-span-2">
        <PlannedPaymentsAttentionCard />
        <CategoryBreakdownCard :cursor="cursor" />
        <RecentTransactionsCard :range="range" />
      </div>
      <div class="space-y-6">
        <AccountsCard />
        <DebtsCard />
      </div>
    </div>
  </section>
</template>
