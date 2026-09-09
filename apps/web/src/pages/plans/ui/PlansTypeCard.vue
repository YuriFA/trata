<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronRight } from '@lucide/vue'
import type { PlannedPayment } from '@trata/api'
import { monthlyTotal } from '@/entities/planned-payment'
import { DEFAULT_CURRENCY, formatMoney } from '@/shared/lib/money'

// One plan type's summary card: an uppercase type label with the plan-count
// pill on top and the normalized monthly figure (monthlyAmount from the
// package - the only recurrence math) as the visual anchor below. The whole
// button is the card surface (link-card pattern), opening the type's list.

const props = defineProps<{
  type: 'expense' | 'income'
  plans: readonly PlannedPayment[]
}>()

const emit = defineEmits<{
  openList: [type: 'expense' | 'income']
}>()

const { t, locale } = useI18n()
// Plans carry no currency of their own; the app display currency is fixed
// (currency-rub-only).
const displayCurrency = computed(() => DEFAULT_CURRENCY)

const cardTitle = computed(() =>
  props.type === 'expense' ? t('plans.expensesTitle') : t('plans.incomeTitle'),
)
const description = computed(() =>
  props.type === 'expense' ? t('plans.expensesDescription') : t('plans.incomeDescription'),
)
const monthlyText = computed(
  () =>
    `${formatMoney(monthlyTotal(props.plans), displayCurrency.value, locale.value)}${t('plans.perMonth')}`,
)
</script>

<template>
  <button
    type="button"
    class="group bg-card text-card-foreground flex min-h-36 flex-col justify-between gap-4 rounded-lg border p-4 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-muted-foreground/30 md:p-6"
    :data-testid="`plans-card-${type}`"
    @click="emit('openList', type)"
  >
    <div class="flex w-full items-start justify-between gap-2">
      <div class="flex items-center gap-2">
        <span class="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          {{ cardTitle }}
        </span>
        <span class="rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold text-muted-foreground">
          {{ t('plans.planCount', props.plans.length) }}
        </span>
      </div>
      <ChevronRight
        class="size-5 shrink-0 text-muted-foreground transition-transform duration-200 group-hover:translate-x-0.5"
        aria-hidden="true"
      />
    </div>
    <div>
      <p class="flex items-baseline text-2xl font-bold tabular-nums">
        <span class="mr-0.5" aria-hidden="true">{{ t('plans.approx') }}</span>
        <span :data-testid="`plans-total-${type}`" :class="type === 'income' ? 'text-success' : ''">
          {{ monthlyText }}
        </span>
      </p>
      <p class="mt-1 text-xs text-muted-foreground">{{ description }}</p>
    </div>
  </button>
</template>
