<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useForm, Field as VeeField } from 'vee-validate'
import { toTypedSchema } from '@vee-validate/zod'
import { calendarDayKey } from '@expense-tracker/dates'
import type { PlannedPayment } from '@/entities/planned-payment'
import {
  useCreatePlannedPayment,
  useDeletePlannedPayment,
  useUpdatePlannedPayment,
} from '@/entities/planned-payment'
import { AccountSelect } from '@/entities/account'
import { CategorySelect } from '@/entities/category'
import { usePushReminders } from '@/features/push-reminders'
import { createPlanSchema, type PlanFormValues } from '../model/plan-schema'
import { ResponsiveDialog } from '@/shared/ui/responsive-dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/shared/ui/alert-dialog'
import { Button } from '@/shared/ui/button'
import { Field, FieldError, FieldLabel } from '@/shared/ui/field'
import { Input } from '@/shared/ui/input'
import { AmountField } from '@/shared/ui/amount-field'
import { NativeSelect, NativeSelectOption } from '@/shared/ui/native-select'
import { Trash2 } from '@lucide/vue'
import { notification } from '@/shared/services/notification'
import { DEFAULT_CURRENCY, toMajorUnits, toMinorUnits } from '@/shared/lib/money'

// Create/edit a planned payment. The type is a prop (immutable per the
// planned-payments capability). Updating nextDue resets the anchor - that is
// repository semantics, the form just sends the date.

const props = defineProps<{
  type: 'expense' | 'income'
  /** null = create. */
  plan: PlannedPayment | null
}>()

const open = defineModel<boolean>('open', { default: false })

const { t } = useI18n()
// Plans carry no currency of their own; the app display currency is fixed
// (currency-rub-only).
const displayCurrency = computed(() => DEFAULT_CURRENCY)

const { mutateAsync: createPlan } = useCreatePlannedPayment()
const { mutateAsync: updatePlan } = useUpdatePlannedPayment()
const { mutateAsync: deletePlan } = useDeletePlannedPayment()

const {
  handleSubmit: handleFormSubmit,
  isSubmitting,
  setFieldValue,
} = useForm<PlanFormValues>({
  validationSchema: toTypedSchema(createPlanSchema()),
  initialValues: {
    amount: props.plan ? toMajorUnits(props.plan.amount) : undefined,
    name: props.plan?.name ?? '',
    accountId: props.plan?.accountId ?? '',
    categoryId: props.plan?.categoryId ?? '',
    nextDue: props.plan?.nextDue ?? calendarDayKey(new Date()),
    regularity: props.plan?.regularity ?? 'monthly',
    confirmMode: props.plan?.confirmMode ?? 'manual',
    reminder: props.plan?.reminder ?? 'off',
    note: props.plan?.note ?? '',
  },
})

const isEdit = computed(() => props.plan !== null)

const dialogTitle = computed(() => {
  if (isEdit.value) {
    return props.type === 'expense' ? t('plans.editExpense') : t('plans.editIncome')
  }
  return props.type === 'expense' ? t('plans.newExpense') : t('plans.newIncome')
})

const accountLabel = computed(() =>
  props.type === 'expense' ? t('plans.withdrawalAccount') : t('plans.depositAccount'),
)

const regularityOptions = [
  { value: 'daily', label: t('plans.regularityLabel.daily') },
  { value: 'weekly', label: t('plans.regularityLabel.weekly') },
  { value: 'monthly', label: t('plans.regularityLabel.monthly') },
  { value: 'yearly', label: t('plans.regularityLabel.yearly') },
] as const

const confirmModeOptions = [
  {
    value: 'manual',
    label: t('plans.confirmModeLabel.manual'),
    caption: t('plans.confirmModeCaption.manual'),
  },
  {
    value: 'auto',
    label: t('plans.confirmModeLabel.auto'),
    caption: t('plans.confirmModeCaption.auto'),
  },
] as const

const reminderOptions = [
  { value: 'off', label: t('plans.reminderLabel.off') },
  { value: 'day_before', label: t('plans.reminderLabel.day_before') },
  { value: 'on_day', label: t('plans.reminderLabel.on_day') },
] as const

// Enabling a reminder asks for notification permission on this device
// (parity with the mobile form): the setting itself is household state on
// the plan, delivery is per-device - usePushReminders' enable() guards the
// standalone context and registers the subscription.
const { enable: enableDeviceReminders } = usePushReminders()
const setReminder = (value: PlanFormValues['reminder']) => {
  if (value !== 'off') void enableDeviceReminders()
  setFieldValue('reminder', value)
}

const handleSubmit = handleFormSubmit(async (data) => {
  try {
    if (props.plan) {
      await updatePlan({
        id: props.plan.id,
        payload: {
          version: props.plan.version,
          amount: toMinorUnits(data.amount),
          name: data.name,
          accountId: data.accountId,
          categoryId: data.categoryId,
          nextDue: data.nextDue,
          regularity: data.regularity,
          confirmMode: data.confirmMode,
          reminder: data.reminder,
          note: data.note,
        },
      })
      notification.success(t('plans.planUpdated'))
    } else {
      await createPlan({
        type: props.type,
        amount: toMinorUnits(data.amount),
        name: data.name,
        accountId: data.accountId,
        categoryId: data.categoryId,
        nextDue: data.nextDue,
        regularity: data.regularity,
        confirmMode: data.confirmMode,
        reminder: data.reminder,
        note: data.note,
      })
      notification.success(t('plans.planCreated'))
    }
    open.value = false
  } catch (error) {
    notification.mutationError(error, {
      title: t('debts.error'),
      feature: 'planned-payment',
      action: isEdit.value ? 'update' : 'create',
    })
  }
})

const deleteOpen = ref(false)
const isDeleting = ref(false)

const handleDelete = async () => {
  if (!props.plan) return
  isDeleting.value = true
  try {
    await deletePlan(props.plan.id)
    notification.success(t('plans.planDeleted'))
    open.value = false
  } catch (error) {
    notification.mutationError(error, {
      title: t('debts.error'),
      feature: 'planned-payment',
      action: 'delete',
    })
  } finally {
    isDeleting.value = false
    deleteOpen.value = false
  }
}
</script>

<template>
  <ResponsiveDialog
    v-model:open="open"
    class="max-h-[85vh] sm:max-w-md"
    data-testid="plans-form-dialog"
  >
    <template #title>{{ dialogTitle }}</template>
    <template #header-actions>
      <Button
        v-if="isEdit"
        variant="ghost"
        size="icon"
        :aria-label="t('plans.deletePlan')"
        data-testid="plans-form-delete"
        @click="deleteOpen = true"
      >
        <Trash2 class="size-4" />
      </Button>
    </template>

    <form id="plans-form" class="flex flex-col gap-3" @submit="handleSubmit">
      <VeeField v-slot="{ value, setValue, errors }" name="amount">
        <Field :data-invalid="!!errors.length">
          <FieldLabel for="plans-form-amount">{{ t('fields.amount') }}</FieldLabel>
          <AmountField
            id="plans-form-amount"
            class="w-full"
            :currency="displayCurrency"
            :model-value="value"
            :errors="errors"
            @update:model-value="(v) => setValue(v as number)"
          />
        </Field>
      </VeeField>

      <VeeField v-slot="{ value, setValue }" name="name">
        <Field>
          <FieldLabel for="plans-form-name">{{ t('fields.name') }}</FieldLabel>
          <Input
            id="plans-form-name"
            type="text"
            :placeholder="t('plans.namePlaceholder')"
            :model-value="value"
            @update:model-value="setValue"
          />
        </Field>
      </VeeField>

      <VeeField v-slot="{ value, setValue, errors }" name="accountId">
        <AccountSelect
          input-id="plans-form-account"
          :label="accountLabel"
          :placeholder="t('addTransaction.accountPlaceholder')"
          class="w-full"
          :model-value="value"
          :errors="errors"
          @update:model-value="setValue"
        />
      </VeeField>

      <VeeField v-slot="{ value, setValue, errors }" name="categoryId">
        <CategorySelect
          input-id="plans-form-category"
          :label="t('fields.category')"
          :placeholder="t('addTransaction.categoryPlaceholder')"
          :type="type"
          class="w-full"
          :model-value="value"
          :errors="errors"
          @update:model-value="setValue"
        />
      </VeeField>

      <VeeField v-slot="{ value, setValue, errors }" name="nextDue">
        <Field :data-invalid="!!errors.length">
          <FieldLabel for="plans-form-date">{{ t('fields.date') }}</FieldLabel>
          <Input
            id="plans-form-date"
            type="date"
            :model-value="value"
            :aria-invalid="!!errors.length"
            @update:model-value="setValue"
          />
          <FieldError v-if="errors.length" :errors="errors" />
        </Field>
      </VeeField>

      <VeeField v-slot="{ value, setValue, errors }" name="regularity">
        <Field :data-invalid="!!errors.length">
          <FieldLabel for="plans-form-regularity">{{ t('plans.regularity') }}</FieldLabel>
          <NativeSelect
            id="plans-form-regularity"
            :model-value="value"
            class="w-full"
            @update:model-value="(option) => setValue(option as PlanFormValues['regularity'])"
          >
            <NativeSelectOption
              v-for="option in regularityOptions"
              :key="option.value"
              :value="option.value"
            >
              {{ option.label }}
            </NativeSelectOption>
          </NativeSelect>
          <FieldError v-if="errors.length" :errors="errors" />
        </Field>
      </VeeField>

      <VeeField v-slot="{ value, setValue }" name="confirmMode">
        <Field>
          <FieldLabel for="plans-form-confirm-mode">{{ t('plans.confirmMode') }}</FieldLabel>
          <NativeSelect
            id="plans-form-confirm-mode"
            :model-value="value"
            class="w-full"
            @update:model-value="(option) => setValue(option as PlanFormValues['confirmMode'])"
          >
            <NativeSelectOption
              v-for="option in confirmModeOptions"
              :key="option.value"
              :value="option.value"
            >
              {{ t('plans.confirmModeOption', { label: option.label, caption: option.caption }) }}
            </NativeSelectOption>
          </NativeSelect>
        </Field>
      </VeeField>

      <VeeField v-slot="{ value }" name="reminder">
        <Field>
          <FieldLabel for="plans-form-reminder">{{ t('plans.reminder') }}</FieldLabel>
          <NativeSelect
            id="plans-form-reminder"
            :model-value="value"
            class="w-full"
            @update:model-value="(option) => setReminder(option as PlanFormValues['reminder'])"
          >
            <NativeSelectOption
              v-for="option in reminderOptions"
              :key="option.value"
              :value="option.value"
            >
              {{ option.label }}
            </NativeSelectOption>
          </NativeSelect>
        </Field>
      </VeeField>

      <VeeField v-slot="{ value, setValue }" name="note">
        <Field>
          <FieldLabel for="plans-form-note">{{ t('fields.description') }}</FieldLabel>
          <Input
            id="plans-form-note"
            type="text"
            :placeholder="t('plans.notePlaceholder')"
            :model-value="value"
            @update:model-value="setValue"
          />
        </Field>
      </VeeField>
    </form>

    <template #footer>
      <Button
        type="submit"
        form="plans-form"
        :loading="isSubmitting"
        data-testid="plans-form-submit"
      >
        {{ t('plans.save') }}
      </Button>
    </template>

    <AlertDialog v-model:open="deleteOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{{ t('plans.deleteTitle') }}</AlertDialogTitle>
          <AlertDialogDescription>
            {{ t('deleteTransaction.confirmDeleteDescription') }}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{{ t('plans.cancel') }}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" :loading="isDeleting" @click="handleDelete">
            {{ t('plans.delete') }}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </ResponsiveDialog>
</template>
