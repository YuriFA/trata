<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { usePlannedPayments } from '@/entities/planned-payment'
import { useCategoriesIncludingArchived } from '@/entities/category'
import { ReminderOptInRow } from '@/features/push-reminders'
import PlansTypeCard from './PlansTypeCard.vue'
import PlansListDialog from './PlansListDialog.vue'
import { PageHeader } from '@/shared/ui/page-header'
import { ErrorState } from '@/shared/ui/error-state'
import { Skeleton } from '@/shared/ui/skeleton'

// Plans screen (planned-payments capability): two type cards (count +
// normalized monthly figure); opening a type shows its plan list with the
// confirm flow. One `usePlannedPayments` read - figures derive in memory.
// The `?confirm=<planId>` deep link (reminder notification activation,
// ADR-0007) opens that plan's confirm flow directly: the plan's list sheet
// opens with the confirm dialog pre-armed, then the query param is cleared
// so a reload does not re-trigger it.

const { t } = useI18n()
const route = useRoute()
const router = useRouter()

const { data: plans, isPending, error, refetch } = usePlannedPayments()
// Including archived: this is a join over existing records -
// archived categories stay visible in history/analytics/filters.
const { data: categories } = useCategoriesIncludingArchived()

const expensePlans = computed(() => (plans.value ?? []).filter((plan) => plan.type === 'expense'))
const incomePlans = computed(() => (plans.value ?? []).filter((plan) => plan.type === 'income'))

// One dialog instance + active type ref (convention 4).
const listOpen = ref(false)
const activeType = ref<'expense' | 'income'>('expense')
const initialConfirmPlanId = ref<string | null>(null)

const openList = (type: 'expense' | 'income') => {
  activeType.value = type
  initialConfirmPlanId.value = null
  listOpen.value = true
}

// The deep link may resolve before or after the plans query (the app can
// cold-start straight into /plans?confirm=...), so a watcher covers both
// orders; it disarms itself once handled.
watch(
  [() => plans.value, () => route.query.confirm],
  ([loadedPlans, confirmParam]) => {
    if (typeof confirmParam !== 'string' || !loadedPlans) return
    const plan = loadedPlans.find((candidate) => candidate.id === confirmParam)
    if (!plan) return
    activeType.value = plan.type
    initialConfirmPlanId.value = plan.id
    listOpen.value = true
    void router.replace({ query: { ...route.query, confirm: undefined } })
  },
  { immediate: true },
)
</script>

<template>
  <section>
    <PageHeader :title="t('pages.plans')" />

    <div v-if="isPending" class="mt-6 grid gap-6 md:grid-cols-2">
      <Skeleton class="min-h-36 rounded-lg" />
      <Skeleton class="min-h-36 rounded-lg" />
    </div>
    <div v-else-if="error" class="mt-6">
      <ErrorState @retry="refetch" />
    </div>
    <div v-else class="mt-6 grid gap-6 md:grid-cols-2">
      <PlansTypeCard type="expense" :plans="expensePlans" @open-list="openList" />
      <PlansTypeCard type="income" :plans="incomePlans" @open-list="openList" />
    </div>

    <div class="mt-6">
      <ReminderOptInRow />
    </div>

    <PlansListDialog
      v-if="listOpen"
      :key="activeType"
      v-model:open="listOpen"
      :type="activeType"
      :plans="activeType === 'expense' ? expensePlans : incomePlans"
      :categories="categories ?? []"
      :initial-confirm-plan-id="initialConfirmPlanId"
    />
  </section>
</template>
