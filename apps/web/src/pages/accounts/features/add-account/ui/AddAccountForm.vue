<script setup lang="ts">
import { useForm, useFieldValue, Field as VeeField } from 'vee-validate'
import {
  createAddAccountSchema,
  useCreateAccount,
  type AddAccountFormValues,
} from '@/entities/account'
import { toTypedSchema } from '@vee-validate/zod'
import { Button } from '@/shared/ui/button'
import { ResponsiveDialog } from '@/shared/ui/responsive-dialog'
import { Field, FieldError, FieldLabel } from '@/shared/ui/field'
import { Input } from '@/shared/ui/input'
import { AmountField } from '@/shared/ui/amount-field'
import { CurrencySelect } from '@/shared/ui/currency-select'
import { toMinorUnits } from '@/shared/lib/money'
import { useI18n } from 'vue-i18n'
import { computed } from 'vue'
import { notification } from '@/shared/services/notification'
import { useDefaultCreationCurrency } from '@/shared/store/use-display-currency'

const emit = defineEmits<{
  success: []
}>()

// Single-context form: it owns its dialog shell (title + pinned #footer);
// multi-form containers embed forms instead (DIALOG_FORM_FOOTER_CLASS).
const open = defineModel<boolean>('open', { default: false })

const { t, locale } = useI18n()
const { mutateAsync: createAccount } = useCreateAccount()
// Fresh form: the household base currency is preselected (multi-currency,
// the accounts capability) and the amount field follows the choice.
const defaultCurrency = useDefaultCreationCurrency()
const selectedCurrency = useFieldValue<AddAccountFormValues['currency']>('currency')

const openingBalancePlaceholder = computed(() =>
  locale.value.startsWith('ru') ? '1000,00' : '1000.00',
)

const {
  handleSubmit: handleFormSubmit,
  setFieldValue,
  isSubmitting,
} = useForm<AddAccountFormValues>({
  validationSchema: toTypedSchema(createAddAccountSchema()),
  initialValues: {
    name: '',
    openingBalance: 0,
    currency: defaultCurrency.value,
  },
})

const handleSubmit = handleFormSubmit(async (data) => {
  try {
    await createAccount({
      name: data.name,
      currency: data.currency,
      openingBalance: toMinorUnits(data.openingBalance),
    })
    notification.success(t('addAccount.success'))
    open.value = false
    emit('success')
  } catch (error) {
    notification.mutationError(error, {
      title: t('addAccount.error'),
      feature: 'account',
      action: 'create',
    })
  }
})
</script>

<template>
  <ResponsiveDialog v-model:open="open">
    <template #title>{{ t('addAccount.newAccount') }}</template>

    <form id="add-account-form" class="flex flex-col gap-3" @submit="handleSubmit">
      <VeeField v-slot="{ field, errors }" name="name">
        <Field class="w-full md:min-w-56 md:flex-1" :data-invalid="!!errors.length">
          <FieldLabel for="name">{{ t('addAccount.nameLabel') }}</FieldLabel>
          <Input
            id="name"
            :placeholder="t('addAccount.namePlaceholder')"
            :model-value="field.value"
            :aria-invalid="!!errors.length"
            @update:model-value="field.onChange"
            @blur="field.onBlur"
          />
          <FieldError v-if="errors.length" :errors="errors" />
        </Field>
      </VeeField>

      <VeeField v-slot="{ field, errors }" name="currency">
        <Field :data-invalid="!!errors.length">
          <FieldLabel for="currency">{{ t('fields.currency') }}</FieldLabel>
          <CurrencySelect
            id="currency"
            :model-value="field.value"
            @update:model-value="field.onChange"
          />
          <FieldError v-if="errors.length" :errors="errors" />
        </Field>
      </VeeField>

      <VeeField v-slot="{ field, errors }" name="openingBalance">
        <Field :data-invalid="!!errors.length">
          <FieldLabel for="opening-balance">{{ t('addAccount.openingBalanceLabel') }}</FieldLabel>
          <AmountField
            id="opening-balance"
            :model-value="field.value"
            :currency="selectedCurrency"
            :errors="errors"
            :placeholder="openingBalancePlaceholder"
            @update:model-value="
              (value) => {
                if (value !== undefined) {
                  setFieldValue('openingBalance', value)
                } else {
                  setFieldValue('openingBalance', undefined as unknown as number)
                }
              }
            "
          />
        </Field>
      </VeeField>
    </form>

    <template #footer>
      <Button form="add-account-form" type="submit" :loading="isSubmitting">
        {{ t('addAccount.submit') }}
      </Button>
    </template>
  </ResponsiveDialog>
</template>
