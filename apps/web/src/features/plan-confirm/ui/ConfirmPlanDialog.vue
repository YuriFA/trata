<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Category } from '@expense-tracker/api'
import type { PlannedPayment } from '@/entities/planned-payment'
import { useConfirmPlannedPayment } from '@/entities/planned-payment'
import { useAccounts } from '@/entities/account'
import { planRowTitle } from '@/entities/planned-payment'
import { ResponsiveDialog } from '@/shared/ui/responsive-dialog'
import { Button } from '@/shared/ui/button'
import { Field, FieldLabel } from '@/shared/ui/field'
import { Input } from '@/shared/ui/input'
import { AmountField } from '@/shared/ui/amount-field'
import { notification } from '@/shared/services/notification'
import { DEFAULT_CURRENCY, toMajorUnits, toMinorUnits } from '@/shared/lib/money'

// Confirm flow (planned-payments capability): review the upcoming occurrence
// - amount and date may be adjusted - then confirm. The repository's
// confirmPlannedPayment composes create-transaction + advance-plan in one
// local transaction; the note defaults to the plan's name (empty for
// unnamed plans).

const props = defineProps<{
  plan: PlannedPayment
  categories: readonly Category[]
}>()

const open = defineModel<boolean>('open', { default: false })

const { t } = useI18n()
// Plans carry no currency of their own; the app display currency is fixed
// (currency-rub-only).
const displayCurrency = computed(() => DEFAULT_CURRENCY)

const { mutateAsync: confirmPlannedPayment, asyncStatus } = useConfirmPlannedPayment()
const { data: accounts } = useAccounts()

// Local editable draft: initialized from the plan, committed on confirm.
// Plain refs (not vee-validate): the confirm sheet has no cross-field
// validation, mirroring the mobile sheet's local state.
const amount = ref(toMajorUnits(props.plan.amount))
const occurredOn = ref(props.plan.nextDue)
const note = ref(props.plan.name)

const accountName = computed(
  () => accounts.value?.find((account) => account.id === props.plan.accountId)?.name ?? '',
)
const categoryName = computed(
  () => props.categories.find((category) => category.id === props.plan.categoryId)?.name ?? '',
)
const accountLabel = computed(() =>
  props.plan.type === 'expense' ? t('plans.withdrawalAccount') : t('plans.depositAccount'),
)

const handleSubmit = async () => {
  if (amount.value === undefined || amount.value <= 0) return
  try {
    await confirmPlannedPayment({
      planId: props.plan.id,
      amount: toMinorUnits(amount.value),
      occurredAt: new Date(`${occurredOn.value}T12:00:00.000Z`).toISOString(),
      note: note.value,
    })
    notification.success(t('plans.confirmSuccess'))
    open.value = false
  } catch (error) {
    notification.mutationError(error, {
      title: t('debts.error'),
      feature: 'planned-payment',
      action: 'confirm',
    })
  }
}
</script>

<template>
  <ResponsiveDialog v-model:open="open" class="sm:max-w-sm" data-testid="plans-confirm-dialog">
    <template #title>{{ t('plans.confirmTitle') }}</template>
    <template #description>{{ planRowTitle(plan, categories) }}</template>

    <form id="plans-confirm-form" class="flex flex-col gap-3" @submit.prevent="handleSubmit">
      <Field>
        <FieldLabel for="plans-confirm-amount">{{ t('fields.amount') }}</FieldLabel>
        <AmountField
          id="plans-confirm-amount"
          v-model="amount"
          class="w-full"
          :currency="displayCurrency"
        />
      </Field>

      <div class="grid grid-cols-2 gap-2 text-sm">
        <div>
          <p class="text-muted-foreground">{{ accountLabel }}</p>
          <p class="font-medium">{{ accountName }}</p>
        </div>
        <div>
          <p class="text-muted-foreground">{{ t('fields.category') }}</p>
          <p class="font-medium">{{ categoryName }}</p>
        </div>
      </div>

      <Field>
        <FieldLabel for="plans-confirm-date">{{ t('fields.date') }}</FieldLabel>
        <Input id="plans-confirm-date" v-model="occurredOn" type="date" />
      </Field>

      <Field>
        <FieldLabel for="plans-confirm-note">{{ t('fields.description') }}</FieldLabel>
        <Input id="plans-confirm-note" v-model="note" type="text" />
      </Field>
    </form>

    <template #footer>
      <Button
        type="submit"
        form="plans-confirm-form"
        :loading="asyncStatus === 'loading'"
        data-testid="plans-confirm-submit"
      >
        {{ t('plans.confirmSubmit') }}
      </Button>
    </template>
  </ResponsiveDialog>
</template>
