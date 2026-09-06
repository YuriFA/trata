<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Category } from '@expense-tracker/api'
import type { PlannedPayment } from '@/entities/planned-payment'
import { monthlyTotal } from '@/entities/planned-payment'
import { CategoryAvatar } from '@/shared/ui/category-avatar'
import { isPlanOverdue, nextDueLabel, planRowTitle, plansSortedByNextDue } from '../model/selectors'
import PlanFormDialog from './PlanFormDialog.vue'
import ConfirmPlanDialog from './ConfirmPlanDialog.vue'
import { currentDay } from '@/shared/lib/date'
import { ResponsiveDialog } from '@/shared/ui/responsive-dialog'
import { Button } from '@/shared/ui/button'
import { Badge } from '@/shared/ui/badge'
import { EmptyState } from '@/shared/ui/empty-state'
import { DEFAULT_CURRENCY, formatMoney } from '@/shared/lib/money'
import { useAuthorLabel } from '@/features/household-author'

// One type's plan list: flat next-due ascending (overdue first by
// construction), rows with the category icon circle, an inline overdue
// badge and a confirm pill for manual plans (solid when overdue, outline
// otherwise); row press to edit. The muted footer band carries the
// normalized monthly total above the create action.

const props = defineProps<{
  type: 'expense' | 'income'
  plans: readonly PlannedPayment[]
  categories: readonly Category[]
}>()

const open = defineModel<boolean>('open', { default: false })

const { t, locale } = useI18n()
const authorLabel = useAuthorLabel()
// Plans carry no currency of their own; the app display currency is fixed
// (currency-rub-only).
const displayCurrency = computed(() => DEFAULT_CURRENCY)

const title = computed(() =>
  props.type === 'expense' ? t('plans.expensesTitle') : t('plans.incomeTitle'),
)
const addLabel = computed(() =>
  props.type === 'expense' ? t('plans.addExpense') : t('plans.addIncome'),
)
const totalText = computed(
  () =>
    `${t('plans.approx')}${formatMoney(monthlyTotal(props.plans), displayCurrency.value, locale.value)}`,
)

// The visible "today" is the user's local calendar day (facade `currentDay`).
const today = computed(() => currentDay())
const sorted = computed(() => plansSortedByNextDue(props.plans))

// Literal keys per branch (the i18n lint bans dynamic keys).
const regularityPhrases = computed<Record<PlannedPayment['regularity'], string>>(() => ({
  daily: t('plans.regularityPhrase.daily'),
  weekly: t('plans.regularityPhrase.weekly'),
  monthly: t('plans.regularityPhrase.monthly'),
  yearly: t('plans.regularityPhrase.yearly'),
}))

const subtitleOf = (plan: PlannedPayment) =>
  `${regularityPhrases.value[plan.regularity]} · ${t('plans.nextDuePrefix')} ${nextDueLabel(plan.nextDue, locale.value)}`

const categoryOf = (plan: PlannedPayment) =>
  props.categories.find((category) => category.id === plan.categoryId)

// Anonymous local mode may have no category for a plan yet.
const FALLBACK_CATEGORY_ICON = '🏷️'

// One dialog instance + active item refs (convention 4).
const formOpen = ref(false)
const activePlan = ref<PlannedPayment | null>(null)

const openCreate = () => {
  activePlan.value = null
  formOpen.value = true
}

const openEdit = (plan: PlannedPayment) => {
  activePlan.value = plan
  formOpen.value = true
}

const confirmOpen = ref(false)
const confirmPlan = ref<PlannedPayment | null>(null)

const openConfirm = (plan: PlannedPayment) => {
  confirmPlan.value = plan
  confirmOpen.value = true
}
</script>

<template>
  <ResponsiveDialog
    v-model:open="open"
    class="sm:max-w-md"
    body-variant="flush"
    data-testid="plans-list-dialog"
    footer-class="flex-col items-center gap-3 rounded-b-lg bg-muted/50 sm:flex-col sm:justify-center"
  >
    <template #title>{{ title }}</template>

    <div class="max-h-96 overflow-y-auto px-4 pt-4">
      <EmptyState v-if="sorted.length === 0" :title="t('plans.empty')" />
      <ul v-else class="divide-y divide-border/60">
        <li v-for="plan in sorted" :key="plan.id" class="py-1.5 first:pt-0">
          <div
            class="flex flex-col gap-2.5 rounded-lg px-1 py-1.5 transition-colors hover:bg-muted/70"
            :data-testid="`plans-row-${plan.id}`"
          >
            <div class="flex items-start justify-between gap-3">
              <button
                type="button"
                class="flex min-w-0 flex-1 items-start gap-3 text-left"
                @click="openEdit(plan)"
              >
                <CategoryAvatar
                  :icon="categoryOf(plan)?.icon || FALLBACK_CATEGORY_ICON"
                  :color="categoryOf(plan)?.color"
                  class="size-10 text-lg"
                />
                <span class="min-w-0">
                  <span class="block truncate text-[15px] font-semibold">
                    {{ planRowTitle(plan, categories) }}
                  </span>
                  <span
                    class="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground"
                  >
                    <span class="truncate">
                      {{ subtitleOf(plan) }}
                      <span
                        v-if="authorLabel(plan.authorId)"
                        :data-testid="`plans-row-${plan.id}-author`"
                      >
                        · {{ authorLabel(plan.authorId) }}
                      </span>
                    </span>
                    <Badge
                      v-if="isPlanOverdue(plan, today)"
                      variant="secondary"
                      class="rounded-sm bg-warning/10 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-warning uppercase"
                      :data-testid="`plans-row-${plan.id}-overdue`"
                    >
                      {{ t('plans.overdue') }}
                    </Badge>
                  </span>
                </span>
              </button>
              <span class="text-[15px] font-bold tabular-nums">
                {{ formatMoney(plan.amount, displayCurrency, locale) }}
              </span>
            </div>
            <div v-if="plan.confirmMode === 'manual'" class="flex justify-end">
              <Button
                :variant="isPlanOverdue(plan, today) ? 'default' : 'outline'"
                size="sm"
                class="rounded-full px-4 text-xs font-semibold"
                :class="
                  isPlanOverdue(plan, today)
                    ? ''
                    : 'border-primary text-primary hover:bg-accent hover:text-primary'
                "
                :aria-label="`${t('plans.confirmTitle')}: ${planRowTitle(plan, categories)}`"
                :data-testid="`plans-row-${plan.id}-confirm`"
                @click="openConfirm(plan)"
              >
                {{ t('plans.confirmSubmit') }}
              </Button>
            </div>
          </div>
        </li>
      </ul>
    </div>

    <template #footer>
      <p class="text-xs font-medium text-muted-foreground">
        {{ t('plans.listTotal', { total: totalText }) }}
      </p>
      <Button class="w-full" data-testid="plans-list-add" @click="openCreate">
        {{ addLabel }}
      </Button>
    </template>

    <PlanFormDialog
      v-if="formOpen"
      :key="activePlan?.id ?? 'create'"
      v-model:open="formOpen"
      :type="type"
      :plan="activePlan"
    />

    <ConfirmPlanDialog
      v-if="confirmOpen && confirmPlan"
      :key="confirmPlan.id"
      v-model:open="confirmOpen"
      :plan="confirmPlan"
      :categories="categories"
    />
  </ResponsiveDialog>
</template>
