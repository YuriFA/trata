<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'
import DashboardCard from './DashboardCard.vue'
import {
  debtorBalanceRows,
  initialsOf,
  useDebtOperations,
  type DebtDirection,
} from '@/entities/debt-operation'
import { useDebtors } from '@/entities/debtor'
import { Skeleton } from '@/shared/ui/skeleton'
import { ErrorState } from '@/shared/ui/error-state'
import { formatMoney } from '@/shared/lib/money'

// Per-debtor balances (canvas): one row per debtor+direction with a nonzero
// balance - directions are never netted (debts capability). The «Все» link
// leads to the full debts page.
const { t, locale } = useI18n()
const {
  data: debtors,
  error: debtorsError,
  isPending: debtorsPending,
  refetch: refetchDebtors,
} = useDebtors()
const {
  data: operations,
  error: operationsError,
  isPending: operationsPending,
  refetch: refetchOperations,
} = useDebtOperations()

// Skeletons only while NO data exists yet: background refetches
// (invalidation, sync cycle) keep the rendered rows in place.
const isPending = computed(() => debtorsPending.value || operationsPending.value)
const error = computed(() => debtorsError.value || operationsError.value)
const refetch = () => Promise.all([refetchDebtors(), refetchOperations()])

const rows = computed(() => debtorBalanceRows(debtors.value ?? [], operations.value ?? []))

// Native-currency visibility (app-currency spec): every row presents in the
// debtor's own (immutable) currency.
const format = (value: number, currency: Parameters<typeof formatMoney>[1]) =>
  formatMoney(value, currency, locale.value)

// Signs are formatting, not copy - composed in script (i18n lint).
const amountText = (
  direction: DebtDirection,
  balance: number,
  currency: Parameters<typeof formatMoney>[1],
) => `${direction === 'receivable' ? '+' : '−'}${format(Math.abs(balance), currency)}`

const directionLabel = (direction: DebtDirection) =>
  direction === 'receivable' ? t('dashboard.owedToMe') : t('dashboard.owedByMe')
</script>

<template>
  <DashboardCard :title="t('pages.debts')" content-class="px-0!">
    <template #action>
      <RouterLink
        class="text-xs font-semibold text-primary hover:underline"
        :to="{ path: '/debts' }"
        data-testid="debts-card-view-all"
      >
        {{ t('actions.viewAll') }}
      </RouterLink>
    </template>
    <ErrorState v-if="error" @retry="refetch" />
    <template v-else-if="isPending">
      <div v-for="n in 2" :key="n" class="flex items-center justify-between gap-2 py-3">
        <Skeleton class="h-9 w-32" />
        <Skeleton class="h-4 w-20" />
      </div>
    </template>
    <p v-else-if="rows.length === 0" class="py-6 px-4 md:px-6 text-sm text-muted-foreground">
      {{ t('dashboard.noDebts') }}
    </p>
    <div v-else>
      <div
        v-for="row in rows"
        :key="`${row.debtor.id}:${row.direction}`"
        class="flex items-center justify-between gap-2 border-b border-border py-3 last:border-0 px-4 md:px-6"
        :data-testid="`debts-card-debtor-${row.debtor.id}-${row.direction}`"
      >
        <div class="flex min-w-0 items-center gap-3">
          <span
            class="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-bold text-muted-foreground"
            aria-hidden="true"
          >
            {{ initialsOf(row.debtor.name) }}
          </span>
          <div class="min-w-0">
            <p class="truncate text-sm font-medium">{{ row.debtor.name }}</p>
            <p class="text-xs text-muted-foreground">{{ directionLabel(row.direction) }}</p>
          </div>
        </div>
        <p
          class="text-sm font-semibold tabular-nums"
          :class="row.direction === 'receivable' ? 'text-success' : 'text-warning'"
        >
          {{ amountText(row.direction, row.balance, row.debtor.currency) }}
        </p>
      </div>
    </div>
  </DashboardCard>
</template>
