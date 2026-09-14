<script setup lang="ts">
import { useForm, Field as VeeField } from 'vee-validate'
import { createEditAccountSchema, type EditAccountFormValues } from '../model/edit-account-schema'
import { toTypedSchema } from '@vee-validate/zod'
import { Button } from '@/shared/ui/button'
import { ResponsiveDialog } from '@/shared/ui/responsive-dialog'
import { Field, FieldError, FieldLabel } from '@/shared/ui/field'
import { Input } from '@/shared/ui/input'
import type { Account } from '@/entities/account'
import { useI18n } from 'vue-i18n'
import { notification } from '@/shared/services/notification'
import { useUpdateAccount } from '@/entities/account'
import { currencySymbol } from '@/shared/lib/money'

const emit = defineEmits<{
  success: []
}>()

// Single-context form: it owns its dialog shell (title + pinned #footer);
// multi-form containers embed forms instead (DIALOG_FORM_FOOTER_CLASS).
const open = defineModel<boolean>('open', { default: false })

const { account } = defineProps<{
  account: Account
}>()

const { t } = useI18n()
const { mutateAsync: updateAccount } = useUpdateAccount()

const { handleSubmit: handleFormSubmit, isSubmitting } = useForm<EditAccountFormValues>({
  validationSchema: toTypedSchema(createEditAccountSchema()),
  initialValues: {
    name: account.name,
  },
})

const handleSubmit = handleFormSubmit(async (data) => {
  try {
    await updateAccount({
      id: account.id,
      payload: {
        name: data.name,
        version: account.version,
      },
    })
    notification.success(t('editAccount.success'))
    open.value = false
    emit('success')
  } catch (error) {
    notification.mutationError(error, {
      title: t('editAccount.error'),
      feature: 'account',
      action: 'update',
    })
  }
})
</script>

<template>
  <ResponsiveDialog v-model:open="open">
    <template #title>{{ t('editAccount.title') }}</template>

    <form id="edit-account-form" class="flex flex-col gap-3" @submit="handleSubmit">
      <!-- The account currency is immutable after creation (accounts
           capability): presented as a static row, never editable. -->
      <div class="flex items-center justify-between gap-3">
        <FieldLabel>{{ t('fields.currency') }}</FieldLabel>
        <span class="text-sm font-medium" data-testid="edit-account-currency">
          {{ account.currency }} · {{ currencySymbol(account.currency) }}
        </span>
      </div>

      <VeeField v-slot="{ field, errors }" name="name">
        <Field class="w-full md:min-w-56 md:flex-1" :data-invalid="!!errors.length">
          <FieldLabel for="name">{{ t('editAccount.nameLabel') }}</FieldLabel>
          <Input
            id="name"
            :placeholder="t('editAccount.namePlaceholder')"
            :model-value="field.value"
            :aria-invalid="!!errors.length"
            @update:model-value="field.onChange"
            @blur="field.onBlur"
          />
          <FieldError v-if="errors.length" :errors="errors" />
        </Field>
      </VeeField>
    </form>

    <template #footer>
      <Button form="edit-account-form" type="submit" :loading="isSubmitting">
        {{ t('editAccount.submit') }}
      </Button>
    </template>
  </ResponsiveDialog>
</template>
