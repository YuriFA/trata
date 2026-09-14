<script setup lang="ts">
import { useAccounts, AccountCardSkeleton, type AccountWithBalance } from '@/entities/account'
import { useI18n } from 'vue-i18n'
import { PageHeader } from '@/shared/ui/page-header'
import AccountCard from './AccountCard.vue'
import { Card, CardContent } from '@/shared/ui/card'
import { aggregateByCurrency, formatMoney, type CurrencyCode } from '@/shared/lib/money'
import { useRates } from '@/shared/lib/money'
import { useDisplayCurrency } from '@/shared/store/use-display-currency'
import { Clock3 } from '@lucide/vue'
import { ErrorState } from '@/shared/ui/error-state'
import { EmptyState } from '@/shared/ui/empty-state'
import { computed, ref } from 'vue'
import { Button } from '@/shared/ui/button'
import { AddAccountForm } from '../features/add-account'
import EditAccountForm from '../features/edit-account/ui/EditAccountForm.vue'
import ReconcileAccountForm from '../features/reconcile-account/ui/ReconcileAccountForm.vue'
import { DeleteAccountDialog } from '../features/delete-account'

const { t, locale } = useI18n()
// Skeletons only while NO data exists yet (background refetches keep cards).
const { data, error, isPending, refetch } = useAccounts()

// The hero presents per-currency exact totals plus, for a mixed aggregate,
// one «≈» conversion into the display currency with the rate date
// (multi-currency design D9); single-currency totals stay exact.
const displayCurrency = useDisplayCurrency()
const rates = useRates()
const aggregate = computed(() =>
  aggregateByCurrency(
    (data.value ?? []).map((account) => ({
      currency: account.currency,
      amount: account.balance ?? 0,
    })),
    displayCurrency.value,
    rates.value,
  ),
)

const format = (value: number, currency: CurrencyCode) => formatMoney(value, currency, locale.value)

// The «≈» prefix and the joined per-currency line are composed in script
// (the i18n lint bans raw text in templates).
const approxTotal = computed(() => {
  const converted = aggregate.value.converted
  return converted ? `≈ ${format(converted.amount, converted.currency)}` : null
})
const perCurrencyLine = computed(() =>
  aggregate.value.totals.map((total) => format(total.amount, total.currency)).join(' · '),
)
const rateDate = computed(() =>
  rates.value
    ? new Intl.DateTimeFormat(locale.value, { dateStyle: 'long' }).format(
        new Date(rates.value.asOf),
      )
    : null,
)

// One dialog instance per flow, hoisted out of the card grid: the card kebab
// sets the active account, the dialog pair reads it (the list/dialog
// convention - the RecentTransactions shape).
const editOpen = ref(false)
const reconcileOpen = ref(false)
const addOpen = ref(false)
const deleteOpen = ref(false)
const activeAccount = ref<AccountWithBalance | null>(null)
const pendingDeleteId = ref<string | null>(null)

const openEdit = (account: AccountWithBalance) => {
  activeAccount.value = account
  editOpen.value = true
}

const openReconcile = (account: AccountWithBalance) => {
  activeAccount.value = account
  reconcileOpen.value = true
}

const openDelete = (account: AccountWithBalance) => {
  activeAccount.value = null
  pendingDeleteId.value = account.id
  deleteOpen.value = true
}
</script>

<template>
  <section>
    <PageHeader :title="t('pages.accounts')" :subtitle="t('accounts.description')">
      <template #actions>
        <Button class="max-sm:w-full" data-testid="open-add-account" @click="addOpen = true">
          {{ t('actions.create') }}
        </Button>
      </template>
    </PageHeader>

    <!-- Warm-minimal tinted info card: the teal wash carries the hero total
         (the paper redesign replaces the old indigo gradient). -->
    <Card class="mt-4 gap-1 border-primary/15 bg-accent py-5 md:py-5">
      <CardContent>
        <p class="text-[13px] font-medium tracking-wide text-primary uppercase">
          {{ t('accounts.totalBalance') }}
        </p>

        <!-- Single-currency aggregate: exact, unmarked (multi-currency D9). -->
        <div v-if="aggregate.totals.length <= 1" class="text-[32px] font-bold tabular-nums">
          {{
            format(
              aggregate.totals[0]?.amount ?? 0,
              aggregate.totals[0]?.currency ?? displayCurrency,
            )
          }}
        </div>

        <!-- Mixed aggregate with cached rates: approximate converted total
             over the exact per-currency line, with the rate's date. -->
        <template v-else-if="approxTotal">
          <div class="text-[32px] font-bold tabular-nums" data-testid="accounts-approx-total">
            {{ approxTotal }}
          </div>
          <p class="mt-1.5 text-[14px] font-medium tabular-nums text-primary opacity-90">
            {{ perCurrencyLine }}
          </p>
          <p
            class="mt-2 flex items-center gap-1.5 text-[12px] text-muted-foreground"
            data-testid="accounts-rate-as-of"
          >
            <Clock3 class="size-3.5" aria-hidden="true" />
            {{ t('accounts.rateAsOf', { date: rateDate }) }}
          </p>
        </template>

        <!-- Missing-rate degradation: the converted total is omitted, the
             per-currency totals stay. -->
        <div v-else class="flex flex-col">
          <p
            v-for="total in aggregate.totals"
            :key="total.currency"
            class="text-[32px] font-bold tabular-nums"
          >
            {{ format(total.amount, total.currency) }}
          </p>
        </div>
      </CardContent>
    </Card>

    <ul class="mt-6 grid grid-cols-[repeat(auto-fit,minmax(250px,1fr))] gap-4 flex-wrap">
      <template v-if="isPending">
        <li v-for="n in 3" :key="n">
          <AccountCardSkeleton />
        </li>
      </template>
      <li v-else-if="error" class="col-span-full">
        <ErrorState @retry="refetch" />
      </li>
      <li v-else-if="data && data.length === 0" class="col-span-full">
        <EmptyState
          :title="t('accounts.noAccounts')"
          :description="t('accounts.noAccountsDescription')"
        />
      </li>
      <template v-else>
        <li v-for="account in data" :key="account.id">
          <AccountCard
            :account
            @edit="openEdit(account)"
            @reconcile="openReconcile(account)"
            @delete="openDelete(account)"
          />
        </li>
      </template>
    </ul>

    <EditAccountForm v-if="activeAccount" v-model:open="editOpen" :account="activeAccount" />
    <ReconcileAccountForm
      v-if="activeAccount"
      v-model:open="reconcileOpen"
      :account="activeAccount"
    />
    <AddAccountForm v-model:open="addOpen" />
    <DeleteAccountDialog
      v-if="pendingDeleteId"
      v-model:open="deleteOpen"
      :account-id="pendingDeleteId"
    />
  </section>
</template>
