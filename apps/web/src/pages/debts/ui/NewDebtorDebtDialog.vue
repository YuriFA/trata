<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useForm, Field as VeeField, useFieldValue } from 'vee-validate'
import { toTypedSchema } from '@vee-validate/zod'
import { calendarDayKey } from '@trata/dates'
import type { Debtor } from '@/entities/debtor'
import { useCreateDebtor } from '@/entities/debtor'
import { useCreateDebtOperation, type DebtDirection } from '@/entities/debt-operation'
import { createDebtorDebtSchema, type DebtorDebtFormValues } from '../model/schemas'
import { ResponsiveDialog } from '@/shared/ui/responsive-dialog'
import { Button } from '@/shared/ui/button'
import { Field, FieldError, FieldLabel } from '@/shared/ui/field'
import { DateField } from '@/shared/ui/date-field'
import { Input } from '@/shared/ui/input'
import { AmountField } from '@/shared/ui/amount-field'
import { CurrencySelect } from '@/shared/ui/currency-select'
import { notification } from '@/shared/services/notification'
import { toMinorUnits } from '@/shared/lib/money'
import { useDefaultCreationCurrency } from '@/shared/store/use-display-currency'

// New debtor with the first debt (mobile design D9): the direction is a prop
// from the tapped section (never a form value); submitting creates the
// contact and then a `debt` operation for it. If the contact was created but
// the operation failed, a retry reuses the created contact id instead of
// creating a duplicate.

const props = defineProps<{
  direction: DebtDirection
}>()

const open = defineModel<boolean>('open', { default: false })

const { t } = useI18n()
// The debtor's immutable ledger currency (debts capability): preselected to
// the household base currency (or the catalog default), sent on create and
// never changeable afterwards.
const defaultCurrency = useDefaultCreationCurrency()

const { mutateAsync: createDebtor } = useCreateDebtor()
const { mutateAsync: createOperation } = useCreateDebtOperation()

const {
  handleSubmit: handleFormSubmit,
  isSubmitting,
  resetForm,
} = useForm<DebtorDebtFormValues>({
  validationSchema: toTypedSchema(createDebtorDebtSchema()),
  initialValues: {
    name: '',
    currency: defaultCurrency.value,
    amount: undefined,
    occurredAt: calendarDayKey(new Date()),
  },
})

const selectedCurrency = useFieldValue<DebtorDebtFormValues['currency']>('currency')

// Set when the contact exists but the operation failed: a retry reuses it.
const createdDebtorId = ref<string | null>(null)

const title = computed(() =>
  props.direction === 'receivable' ? t('debts.receivableAddTitle') : t('debts.payableAddTitle'),
)
const subtitle = computed(() =>
  props.direction === 'receivable' ? t('debts.receivable') : t('debts.payable'),
)

const handleSubmit = handleFormSubmit(async (data) => {
  const occurredAt = new Date(`${data.occurredAt}T12:00:00.000Z`).toISOString()
  try {
    const debtor: Debtor = createdDebtorId.value
      ? ({ id: createdDebtorId.value } as Debtor)
      : await createDebtor({ name: data.name.trim(), currency: data.currency })
    createdDebtorId.value = debtor.id
    await createOperation({
      debtorId: debtor.id,
      direction: props.direction,
      kind: 'debt',
      amount: toMinorUnits(data.amount),
      occurredAt,
    })
    notification.success(t('debts.debtAdded'))
    createdDebtorId.value = null
    resetForm()
    open.value = false
  } catch (error) {
    notification.mutationError(error, {
      title: t('debts.error'),
      feature: 'debt',
      action: 'create',
    })
  }
})
</script>

<template>
  <ResponsiveDialog v-model:open="open" class="sm:max-w-sm" data-testid="debts-new-debtor-dialog">
    <template #title>{{ title }}</template>
    <template #description>{{ subtitle }}</template>

    <form id="debts-new-debt-form" class="flex flex-col gap-3" @submit="handleSubmit">
      <VeeField v-slot="{ value, setValue, errors }" name="name">
        <Field :data-invalid="!!errors.length">
          <FieldLabel for="debts-new-debt-name">{{ t('fields.name') }}</FieldLabel>
          <Input
            id="debts-new-debt-name"
            type="text"
            :placeholder="t('debts.namePlaceholder')"
            :model-value="value"
            :aria-invalid="!!errors.length"
            @update:model-value="setValue"
          />
          <FieldError v-if="errors.length" :errors="errors" />
        </Field>
      </VeeField>

      <VeeField v-slot="{ value, setValue, errors }" name="currency">
        <Field :data-invalid="!!errors.length">
          <FieldLabel for="debts-new-debt-currency">{{ t('debts.currencyLabel') }}</FieldLabel>
          <CurrencySelect
            id="debts-new-debt-currency"
            :model-value="value"
            @update:model-value="(v) => setValue(v as DebtorDebtFormValues['currency'])"
          />
          <p class="text-xs text-muted-foreground">{{ t('debts.currencyImmutableHint') }}</p>
          <FieldError v-if="errors.length" :errors="errors" />
        </Field>
      </VeeField>

      <VeeField v-slot="{ value, setValue, errors }" name="amount">
        <Field :data-invalid="!!errors.length">
          <FieldLabel for="debts-new-debt-amount">{{ t('fields.amount') }}</FieldLabel>
          <AmountField
            id="debts-new-debt-amount"
            class="w-full"
            :currency="selectedCurrency"
            :model-value="value"
            :errors="errors"
            @update:model-value="(v) => setValue(v as number)"
          />
        </Field>
      </VeeField>

      <VeeField v-slot="{ value, setValue, errors }" name="occurredAt">
        <Field :data-invalid="!!errors.length">
          <FieldLabel for="debts-new-debt-date">{{ t('fields.date') }}</FieldLabel>
          <DateField
            input-id="debts-new-debt-date"
            :model-value="value"
            :placeholder="t('fields.datePlaceholder')"
            :aria-invalid="!!errors.length"
            @update:model-value="setValue"
          />
          <FieldError v-if="errors.length" :errors="errors" />
        </Field>
      </VeeField>
    </form>

    <template #footer>
      <Button
        type="submit"
        form="debts-new-debt-form"
        :loading="isSubmitting"
        data-testid="debts-new-debt-submit"
      >
        {{ t('debts.addDebt') }}
      </Button>
    </template>
  </ResponsiveDialog>
</template>
