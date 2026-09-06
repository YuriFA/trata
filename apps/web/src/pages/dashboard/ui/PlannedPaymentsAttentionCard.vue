<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { PlannedPayment } from '@/entities/planned-payment'
import {
  usePlannedPayments,
  isPlanOverdue,
  planRowTitle,
  plansSortedByNextDue,
} from '@/entities/planned-payment'
import { ConfirmPlanDialog } from '@/features/plan-confirm'
import { useCategoriesIncludingArchived } from '@/entities/category'
import { ReminderOptInRow } from '@/features/push-reminders'
import DashboardCard from './DashboardCard.vue'
import { addCalendarDays, currentDay } from '@/shared/lib/date'
import { CategoryAvatar } from '@/shared/ui/category-avatar'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { formatMoney, DEFAULT_CURRENCY } from '@/shared/lib/money'

// The attention card (web-push change, ADR-0007): an ACTION surface, not a
// forecast - overdue plans plus plans due today or tomorrow, each with the
// one-tap confirm flow. Period-independent (not month-scoped): it answers
// "what needs me now", which does not follow the dashboard's period cursor.
// The whole card is hidden when nothing is due or overdue (an empty action
// card is noise, not information); the footer carries the device reminder
// opt-in whenever it applies.

const { t, locale } = useI18n()
const { data: plans, isPending, error } = usePlannedPayments()
const { data: categories } = useCategoriesIncludingArchived()

// The visible "today" is the user's local calendar day; ISO day strings
// compare lexicographically, so one string comparison covers overdue
// (before today), due today, and due tomorrow (up to tomorrow's key).
const today = computed(() => currentDay())
const dueHorizon = computed(() => addCalendarDays(today.value, 2))

const candidates = computed(() =>
  plansSortedByNextDue((plans.value ?? []).filter((plan) => plan.nextDue < dueHorizon.value)),
)

const isOverdue = (plan: PlannedPayment) => isPlanOverdue(plan, today.value)

const categoryOf = (plan: PlannedPayment) =>
  (categories.value ?? []).find((category) => category.id === plan.categoryId)

// Anonymous local mode may have no category for a plan yet.
const FALLBACK_CATEGORY_ICON = '🏷️'

const dueLabel = (plan: PlannedPayment) =>
  isOverdue(plan) ? t('plans.overdue') : t('dashboard.dueToday')

// One dialog instance + active plan ref (convention 4).
const confirmOpen = ref(false)
const confirmPlan = ref<PlannedPayment | null>(null)

const openConfirm = (plan: PlannedPayment) => {
  confirmPlan.value = plan
  confirmOpen.value = true
}
</script>

<template>
  <DashboardCard
    v-if="!error && !isPending && candidates.length > 0"
    :title="t('dashboard.attentionTitle')"
    content-class="py-4"
    data-testid="dashboard-attention-card"
  >
    <ul class="divide-y divide-border/60">
      <li
        v-for="plan in candidates"
        :key="plan.id"
        class="flex items-center justify-between gap-2 py-2"
        :data-testid="`attention-plan-${plan.id}`"
      >
        <span class="flex min-w-0 items-center gap-2.5">
          <CategoryAvatar
            :icon="categoryOf(plan)?.icon || FALLBACK_CATEGORY_ICON"
            :color="categoryOf(plan)?.color"
            class="size-8 text-base"
          />
          <span class="min-w-0">
            <span class="block truncate text-sm font-semibold">
              {{ planRowTitle(plan, categories ?? []) }}
            </span>
            <span class="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
              {{ formatMoney(plan.amount, DEFAULT_CURRENCY, locale) }}
              <Badge
                v-if="isOverdue(plan)"
                variant="secondary"
                class="rounded-sm bg-warning/10 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-warning uppercase"
                :data-testid="`attention-plan-${plan.id}-overdue`"
              >
                {{ dueLabel(plan) }}
              </Badge>
              <span v-else>{{ dueLabel(plan) }}</span>
            </span>
          </span>
        </span>
        <Button
          size="sm"
          :variant="isOverdue(plan) ? 'default' : 'outline'"
          class="rounded-full px-4 text-xs font-semibold"
          :data-testid="`attention-plan-${plan.id}-confirm`"
          @click="openConfirm(plan)"
        >
          {{ t('plans.confirmSubmit') }}
        </Button>
      </li>
    </ul>
    <div class="mt-3">
      <ReminderOptInRow />
    </div>

    <ConfirmPlanDialog
      v-if="confirmOpen && confirmPlan"
      :key="confirmPlan.id"
      v-model:open="confirmOpen"
      :plan="confirmPlan"
      :categories="categories ?? []"
    />
  </DashboardCard>
</template>
