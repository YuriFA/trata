<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronRight } from '@lucide/vue'
import { shortDayLabel } from '@trata/dates'
import type { Debtor } from '@trata/api'
import type { DebtDirection, DebtOperation } from '@/entities/debt-operation'
import { initialsOf, lastOperationAt } from '../model/selectors'
import { DEFAULT_CURRENCY, formatMoney } from '@/shared/lib/money'

// One debtor row (warm-minimal list row): direction-tinted letter avatar,
// name with the dotted last-operation meta, bold colored balance and a
// chevron that nudges on row hover.

const props = defineProps<{
  debtor: Debtor
  balance: number
  /** The section's direction: it colors the avatar and the balance. */
  direction: DebtDirection
  /** All operations: the meta line derives the latest one in memory. */
  operations: readonly DebtOperation[]
}>()

const { locale, t } = useI18n()
// Debts carry no currency of their own; the app display currency is fixed
// (currency-rub-only).
const displayCurrency = computed(() => DEFAULT_CURRENCY)

const balanceText = computed(() => formatMoney(props.balance, displayCurrency.value, locale.value))

const balanceClass = computed(() => {
  if (props.balance < 0) return 'text-destructive'
  return props.direction === 'receivable' ? 'text-success' : 'text-warning'
})

// Zero (settled) debtors get the neutral avatar; active ones the direction
// tint (teal receivable / terracotta payable).
const avatarClass = computed(() => {
  if (props.balance === 0) return 'bg-muted text-muted-foreground'
  return props.direction === 'receivable' ? 'bg-accent text-primary' : 'bg-warning/10 text-warning'
})

const metaText = computed(() => {
  const latest = lastOperationAt(props.operations, props.debtor.id, props.direction)
  if (!latest) return ''
  return t('debts.lastOperation', { date: shortDayLabel(new Date(latest), locale.value) })
})
</script>

<template>
  <button
    type="button"
    class="group flex w-full items-center gap-4 px-4 py-3.5 text-left transition-colors hover:bg-muted/40 md:px-6"
    :data-testid="`debts-debtor-${debtor.id}`"
    :aria-label="`${debtor.name}, ${balanceText}`"
  >
    <span
      class="flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-bold"
      :class="avatarClass"
      aria-hidden="true"
    >
      {{ initialsOf(debtor.name) }}
    </span>
    <span class="min-w-0 flex-1">
      <span class="block truncate text-sm font-semibold">{{ debtor.name }}</span>
      <span
        class="mt-0.5 inline-block border-b border-dotted border-border text-[11px] font-medium text-muted-foreground"
      >
        {{ metaText }}
      </span>
    </span>
    <span class="shrink-0 text-sm font-bold tabular-nums" :class="balanceClass">
      {{ balanceText }}
    </span>
    <ChevronRight
      class="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-hover:translate-x-1"
      aria-hidden="true"
    />
  </button>
</template>
