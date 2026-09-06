<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  calendarDayKey,
  fullDayLabel,
  periodRangeLabel,
  periodToUtcDayRange,
  shiftPeriod,
  transactionsInPeriod,
  type PeriodCursor,
} from '@expense-tracker/dates'
import type { Category, Transaction } from '@expense-tracker/api'
import type { AnalyticsDirection } from '@/entities/analytics'
import { useAccounts } from '@/entities/account'
import { useTransactions } from '@/entities/transaction'
import { EditTransactionDialog } from '@/features/transaction/edit'
import { DeleteTransactionDialog } from '@/features/transaction/delete'
import { ResponsiveDialog } from '@/shared/ui/responsive-dialog'
import { Button } from '@/shared/ui/button'
import { EmptyState } from '@/shared/ui/empty-state'
import { ArrowDownUp, ChevronLeft, ChevronRight, Trash2 } from '@lucide/vue'
import { DEFAULT_CURRENCY, formatMoney } from '@/shared/lib/money'
import { CategoryAvatar } from '@/shared/ui/category-avatar'
import { useDateFormat } from '@vueuse/core'

// Category drill-down (analytics capability): the selected category's
// transactions for the detail screen's period, with the period navigable
// inside the overlay. The shared responsive-dialog keeps the centered desktop
// dialog and switches to the mobile drawer presentation below 768px.

const props = defineProps<{
  category: Category
  direction: AnalyticsDirection
  /** Initial period; navigation afterwards is dialog-local. */
  cursor: PeriodCursor
}>()

const open = defineModel<boolean>('open', { default: false })
const { t, locale } = useI18n()
// Analytics totals carry no currency of their own; the app display currency
// is fixed (currency-rub-only).
const displayCurrency = computed(() => DEFAULT_CURRENCY)

const localCursor = ref<PeriodCursor>(props.cursor)
const newestFirst = ref(true)

const queryOptions = computed(() => ({
  type: props.direction,
  categoryId: props.category.id,
  ...periodToUtcDayRange(localCursor.value),
}))
const { data } = useTransactions(queryOptions, { enabled: computed(() => open.value) })
const { data: accounts } = useAccounts()

// Repository day filters are a UTC superset; exact membership stays local.
const transactions = computed(() => transactionsInPeriod(data.value ?? [], localCursor.value))
const total = computed(() => transactions.value.reduce((sum, tx) => sum + tx.amount, 0))
const totalText = computed(() => formatMoney(total.value, displayCurrency.value, locale.value))
const rangeLabel = computed(() => periodRangeLabel(localCursor.value, locale.value))

interface DayGroup {
  key: string
  title: string
  transactions: Array<Transaction & { time: string }>
}

const groups = computed<DayGroup[]>(() => {
  const sorted = [...transactions.value].sort((a, b) =>
    newestFirst.value
      ? b.occurredAt.localeCompare(a.occurredAt) || b.id.localeCompare(a.id)
      : a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id),
  )
  const byDay = new Map<string, Array<Transaction & { time: string }>>()
  for (const tx of sorted) {
    const key = calendarDayKey(new Date(tx.occurredAt))
    const time = useDateFormat(tx.occurredAt, 'HH:mm', { locales: locale.value }).value
    byDay.set(key, [...(byDay.get(key) ?? []), { ...tx, time }])
  }
  return [...byDay.entries()].map(([key, dayTransactions]) => ({
    key,
    title: fullDayLabel(new Date(dayTransactions[0]!.occurredAt), locale.value),
    transactions: dayTransactions,
  }))
})

const emptyText = computed(() => {
  if (props.direction === 'expense') {
    return localCursor.value.kind === 'month'
      ? t('analytics.emptyMonthExpense')
      : t('analytics.emptyPeriodExpense')
  }
  return localCursor.value.kind === 'month'
    ? t('analytics.emptyMonthIncome')
    : t('analytics.emptyPeriodIncome')
})

const totalWord = computed(() =>
  props.direction === 'expense' ? t('analytics.spentWord') : t('analytics.receivedWord'),
)

// Meta line: account display name; account-less cashflow stays named.
const accountName = (transaction: Transaction) =>
  'accountId' in transaction
    ? (accounts.value?.find((account) => account.id === transaction.accountId)?.name ??
      t('accounts.noAccount'))
    : t('transactions.types.transfer')

// Bullet separator kept as a script constant (i18n lint bans raw glyphs).
const SEPARATOR = '•'

function stepPeriod(steps: number) {
  localCursor.value = shiftPeriod(localCursor.value, steps)
}

// One dialog instance outside the list + an "active item" ref (convention 4).
const editOpen = ref(false)
const deleteOpen = ref(false)
const activeTransaction = ref<Transaction | null>(null)
const pendingDeleteId = ref<string | null>(null)

const openEdit = (transaction: Transaction) => {
  activeTransaction.value = transaction
  editOpen.value = true
}

const openDelete = (transaction: Transaction) => {
  activeTransaction.value = null
  pendingDeleteId.value = transaction.id
  deleteOpen.value = true
}
</script>

<template>
  <ResponsiveDialog
    v-model:open="open"
    class="sm:max-w-md"
    body-variant="flush"
    data-testid="category-cashflow-dialog"
  >
    <template #title>
      <span class="flex min-w-0 items-center gap-2.5">
        <CategoryAvatar
          :icon="category.icon"
          :color="category.color"
          class="size-7 shrink-0 text-sm"
        />
        <span class="truncate">{{ category.name || t('analytics.category') }}</span>
      </span>
    </template>

    <div class="flex flex-col items-center gap-2 pt-6">
      <div
        class="inline-flex items-center gap-0.5 rounded-full border border-border py-0.5 pl-1 pr-2.5"
      >
        <Button
          variant="ghost"
          size="icon-sm"
          class="size-7 rounded-full"
          :aria-label="t('analytics.prevPeriod')"
          data-testid="category-cashflow-prev"
          @click="stepPeriod(-1)"
        >
          <ChevronLeft class="size-4" />
        </Button>
        <span class="text-sm font-medium" data-testid="category-cashflow-range">
          {{ rangeLabel }}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          class="size-7 rounded-full"
          :aria-label="t('analytics.nextPeriod')"
          data-testid="category-cashflow-next"
          @click="stepPeriod(1)"
        >
          <ChevronRight class="size-4" />
        </Button>
      </div>
      <p class="text-sm text-muted-foreground">
        <span class="font-semibold text-foreground">{{ totalText }}</span>
        {{ totalWord }}
      </p>
    </div>

    <div class="mt-5 px-6">
      <Button
        variant="link"
        size="sm"
        class="text-muted-foreground"
        data-testid="category-cashflow-sort"
        @click="newestFirst = !newestFirst"
      >
        <ArrowDownUp class="size-3.5" />
        {{ newestFirst ? t('analytics.sortNewestFirst') : t('analytics.sortOldestFirst') }}
      </Button>
    </div>

    <div class="mt-5">
      <EmptyState v-if="groups.length === 0" :title="emptyText" />
      <template v-for="(group, gi) in groups" :key="group.key">
        <div
          class="sticky top-[-1px] z-10 border-y border-border bg-muted px-6 py-2.5"
          :class="gi === 0 && 'border-t-0'"
          :data-testid="`category-cashflow-day-${group.key}`"
        >
          <span class="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
            {{ group.title }}
          </span>
        </div>
        <div class="divide-y divide-border/60">
          <div
            v-for="transaction in group.transactions"
            :key="transaction.id"
            class="group flex items-center gap-2 px-6 py-3.5"
            :data-testid="`category-cashflow-tx-${transaction.id}`"
          >
            <button
              type="button"
              class="min-w-0 flex-1 text-left"
              :aria-label="`${t('editTransaction.trigger')}: ${transaction.description || category.name}`"
              @click="openEdit(transaction)"
            >
              <p
                class="truncate text-sm font-medium"
                :class="{ 'text-muted-foreground': !transaction.description }"
              >
                {{ transaction.description || t('transactions.noDescription') }}
              </p>
              <p class="truncate text-xs text-muted-foreground">
                {{ accountName(transaction) }} {{ SEPARATOR }} {{ transaction.time }}
              </p>
            </button>
            <span
              class="text-sm font-semibold tabular-nums"
              :class="direction === 'expense' ? 'text-destructive' : 'text-success'"
            >
              <span v-if="direction === 'expense'">-</span>
              <span v-else>+</span>{{ formatMoney(transaction.amount, displayCurrency, locale) }}
            </span>
            <Button
              variant="ghost"
              size="icon"
              class="size-7 text-muted-foreground/60 hover:bg-destructive/10 hover:text-destructive"
              :aria-label="t('deleteTransaction.trigger')"
              @click="openDelete(transaction)"
            >
              <Trash2 class="size-4" />
            </Button>
          </div>
        </div>
      </template>
    </div>

    <EditTransactionDialog
      v-if="activeTransaction"
      v-model:open="editOpen"
      :transaction="activeTransaction"
    />
    <DeleteTransactionDialog
      v-if="pendingDeleteId"
      v-model:open="deleteOpen"
      :transaction-id="pendingDeleteId"
    />
  </ResponsiveDialog>
</template>
