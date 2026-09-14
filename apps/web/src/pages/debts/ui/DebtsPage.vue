<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Debtor } from '@/entities/debtor'
import { useDebtors } from '@/entities/debtor'
import {
  directionBucketsByCurrency,
  useDebtOperations,
  type DebtDirection,
} from '@/entities/debt-operation'
import DebtsSummaryCard from './DebtsSummaryCard.vue'
import DebtorSection from './DebtorSection.vue'
import DebtorHistoryDialog from './DebtorHistoryDialog.vue'
import NewDebtorDebtDialog from './NewDebtorDebtDialog.vue'
import { PageHeader } from '@/shared/ui/page-header'
import { ErrorState } from '@/shared/ui/error-state'
import { Skeleton } from '@/shared/ui/skeleton'

// Debts screen (debts capability): two independent direction sections with
// summary cards, debtor rows with derived balances. One `useDebtors` + one
// full `useDebtOperations` read - every figure derives in memory.

const { t } = useI18n()

const {
  data: debtors,
  isPending: debtorsPending,
  error: debtorsError,
  refetch: refetchDebtors,
} = useDebtors()
const {
  data: operations,
  isPending: operationsPending,
  error: operationsError,
  refetch: refetchOperations,
} = useDebtOperations()

// Skeletons only while NO data exists yet: a background refetch
// (invalidation, sync cycle) keeps the rendered rows in place.
const isPending = computed(() => debtorsPending.value || operationsPending.value)
const error = computed(() => debtorsError.value || operationsError.value)
const refetch = () => Promise.all([refetchDebtors(), refetchOperations()])

// Direction totals derive from native-currency per-debtor buckets; the
// summary card aggregates them into the display currency (multi-currency).
const receivableBuckets = computed(() =>
  directionBucketsByCurrency(debtors.value ?? [], operations.value ?? [], 'receivable'),
)
const payableBuckets = computed(() =>
  directionBucketsByCurrency(debtors.value ?? [], operations.value ?? [], 'payable'),
)

// One dialog instance + active item refs (convention 4).
const historyOpen = ref(false)
const activeDebtor = ref<Debtor | null>(null)
const activeDirection = ref<DebtDirection>('receivable')

const openHistory = (debtor: Debtor, direction: DebtDirection) => {
  activeDebtor.value = debtor
  activeDirection.value = direction
  historyOpen.value = true
}

const newDebtorOpen = ref(false)
const newDebtorDirection = ref<DebtDirection>('receivable')

const openNewDebtor = (direction: DebtDirection) => {
  newDebtorDirection.value = direction
  newDebtorOpen.value = true
}
</script>

<template>
  <section>
    <PageHeader :title="t('pages.debts')" />

    <div v-if="isPending" class="mt-6 space-y-4">
      <Skeleton class="h-28 rounded-xl" />
      <Skeleton class="h-40 rounded-xl" />
    </div>
    <div v-else-if="error" class="mt-6">
      <ErrorState @retry="refetch" />
    </div>
    <template v-else>
      <div class="mt-6">
        <DebtsSummaryCard :receivable="receivableBuckets" :payable="payableBuckets" />
      </div>

      <!-- Composite list card: full-bleed sections, paper band between them
           (warm-minimal design D1). -->
      <div class="mt-4 overflow-hidden rounded-lg border bg-card text-card-foreground">
        <template v-for="direction in ['receivable', 'payable'] as const" :key="direction">
          <div
            v-if="direction === 'payable'"
            class="h-4 border-y border-border bg-background"
            aria-hidden="true"
          />
          <DebtorSection
            :direction="direction"
            :debtors="debtors ?? []"
            :operations="operations ?? []"
            @add="openNewDebtor"
            @select="openHistory"
          />
        </template>
      </div>
    </template>

    <DebtorHistoryDialog
      v-if="activeDebtor && historyOpen"
      :key="`${activeDebtor.id}-${activeDirection}`"
      v-model:open="historyOpen"
      :debtor="activeDebtor"
      :direction="activeDirection"
      :operations="operations ?? []"
    />

    <NewDebtorDebtDialog
      v-if="newDebtorOpen"
      :key="newDebtorDirection"
      v-model:open="newDebtorOpen"
      :direction="newDebtorDirection"
    />
  </section>
</template>
