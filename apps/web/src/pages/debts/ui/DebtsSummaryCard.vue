<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Clock3 } from '@lucide/vue'
import { Card, CardContent } from '@/shared/ui/card'
import { aggregateByCurrency, formatMoney, type CurrencyBucket } from '@/shared/lib/money'
import { ratesAsOf, useRates } from '@/shared/lib/money'
import { useDisplayCurrency } from '@/shared/store/use-display-currency'

// Direction totals (debts capability): each is the sum of that direction's
// per-debtor balances, no netting across directions. Amounts arrive as
// native-currency buckets (each debtor's own currency) and present as exact
// per-currency figures plus, for a mixed aggregate, one «≈» conversion into
// the display currency with the rate's as-of date (multi-currency design D9;
// missing rates degrade to the per-currency figures). Receivable is signed
// «+», payable «−».

const props = defineProps<{
  receivable: readonly CurrencyBucket[]
  payable: readonly CurrencyBucket[]
}>()

const { t, locale } = useI18n()
const displayCurrency = useDisplayCurrency()
const rates = useRates()

const format = (value: number, currency: Parameters<typeof formatMoney>[1]) =>
  formatMoney(value, currency, locale.value)

interface SideAggregate {
  /** The exact per-currency figures, joined for the primary line. */
  amounts: string
  /** The «≈» converted total, or null when exact/omitted. */
  converted: string | null
}

const side = (buckets: readonly CurrencyBucket[]): SideAggregate => {
  const aggregate = aggregateByCurrency(buckets, displayCurrency.value, rates.value)
  return {
    amounts: aggregate.totals.map((total) => format(total.amount, total.currency)).join(' · '),
    converted: aggregate.converted
      ? `≈ ${format(aggregate.converted.amount, aggregate.converted.currency)}`
      : null,
  }
}

const receivableSide = computed(() => side(props.receivable))
const payableSide = computed(() => side(props.payable))

const rateDate = computed(() =>
  ratesAsOf.value
    ? new Intl.DateTimeFormat(locale.value, { dateStyle: 'long' }).format(new Date(ratesAsOf.value))
    : null,
)

// Literal sign strings per branch (the i18n lint bans raw text in templates).
const receivableSign = '+'
const payableSign = '−'
</script>

<template>
  <Card>
    <CardContent class="flex flex-col gap-4 sm:flex-row sm:gap-12">
      <div class="flex-1">
        <p class="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          {{ t('debts.receivable') }}
        </p>
        <p class="mt-1 text-2xl font-bold tabular-nums text-success">
          <span aria-hidden="true">{{ receivableSign }}</span
          ><span data-testid="debts-total-receivable">{{ receivableSide.amounts }}</span>
        </p>
        <template v-if="receivableSide.converted">
          <p
            class="mt-0.5 text-sm font-medium tabular-nums text-success"
            data-testid="debts-approx-receivable"
          >
            {{ receivableSide.converted }}
          </p>
          <p
            class="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground"
            data-testid="debts-rate-as-of"
          >
            <Clock3 class="size-3" aria-hidden="true" />
            {{ t('accounts.rateAsOf', { date: rateDate }) }}
          </p>
        </template>
      </div>
      <div class="hidden w-px bg-border sm:block" aria-hidden="true" />
      <div class="flex-1">
        <p class="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          {{ t('debts.payable') }}
        </p>
        <p class="mt-1 text-2xl font-bold tabular-nums text-warning">
          <span aria-hidden="true">{{ payableSign }}</span
          ><span data-testid="debts-total-payable">{{ payableSide.amounts }}</span>
        </p>
        <template v-if="payableSide.converted">
          <p
            class="mt-0.5 text-sm font-medium tabular-nums text-warning"
            data-testid="debts-approx-payable"
          >
            {{ payableSide.converted }}
          </p>
          <p
            class="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground"
            data-testid="debts-rate-as-of"
          >
            <Clock3 class="size-3" aria-hidden="true" />
            {{ t('accounts.rateAsOf', { date: rateDate }) }}
          </p>
        </template>
      </div>
    </CardContent>
  </Card>
</template>
