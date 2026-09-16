<script setup lang="ts">
import { useForm, Field as VeeField } from 'vee-validate'
import { toTypedSchema } from '@vee-validate/zod'
import { useI18n } from 'vue-i18n'
import type { Debtor } from '@/entities/debtor'
import { useUpdateDebtor } from '@/entities/debtor'
import { createRenameDebtorSchema, type RenameDebtorFormValues } from '../model/schemas'
import { ResponsiveDialog } from '@/shared/ui/responsive-dialog'
import { Button } from '@/shared/ui/button'
import { Field, FieldError, FieldLabel } from '@/shared/ui/field'
import { Input } from '@/shared/ui/input'
import { notification } from '@/shared/services/notification'
import { AlreadyExistsError } from '@/shared/lib/data'

// Rename-only debtor dialog (debts capability): the name is the only
// updatable debtor field. A submit that doesn't change the name never
// reaches the API (the service rejects no-op updates); a duplicate live
// name surfaces inline by its typed RepositoryError code.

const props = defineProps<{
  debtor: Debtor
}>()

const open = defineModel<boolean>('open', { default: false })

const { t } = useI18n()
const { mutateAsync: updateDebtor } = useUpdateDebtor()

const {
  handleSubmit: handleFormSubmit,
  setFieldError,
  isSubmitting,
} = useForm<RenameDebtorFormValues>({
  validationSchema: toTypedSchema(createRenameDebtorSchema()),
  initialValues: {
    name: props.debtor.name,
  },
})

const handleSubmit = handleFormSubmit(async (data) => {
  const name = data.name.trim()
  // No-op update (the same name) is rejected by the service - don't call it.
  if (name === props.debtor.name) {
    open.value = false
    return
  }
  try {
    await updateDebtor({
      id: props.debtor.id,
      payload: { name, version: props.debtor.version },
    })
    open.value = false
  } catch (error) {
    if (error instanceof AlreadyExistsError) {
      // The machine code (DEBTOR_ALREADY_EXISTS) mapped to the name field.
      setFieldError('name', t('errors.alreadyExists'))
    } else {
      notification.mutationError(error, {
        title: t('debts.error'),
        feature: 'debtor',
        action: 'update',
      })
    }
  }
})
</script>

<template>
  <ResponsiveDialog v-model:open="open" class="sm:max-w-sm" data-testid="debts-rename-dialog">
    <template #title>{{ t('debts.renameDebtorTitle') }}</template>

    <form id="debts-rename-form" class="flex flex-col gap-3" @submit="handleSubmit">
      <VeeField v-slot="{ value, setValue, errors }" name="name">
        <Field :data-invalid="!!errors.length">
          <FieldLabel for="debts-rename-name">{{ t('fields.name') }}</FieldLabel>
          <Input
            id="debts-rename-name"
            type="text"
            :placeholder="t('debts.namePlaceholder')"
            :model-value="value"
            :aria-invalid="!!errors.length"
            @update:model-value="setValue"
          />
          <FieldError v-if="errors.length" :errors="errors" />
        </Field>
      </VeeField>
    </form>

    <template #footer>
      <Button variant="ghost" data-testid="debts-rename-cancel" @click="open = false">
        {{ t('debts.cancel') }}
      </Button>
      <Button
        type="submit"
        form="debts-rename-form"
        :loading="isSubmitting"
        data-testid="debts-rename-submit"
      >
        {{ t('debts.save') }}
      </Button>
    </template>
  </ResponsiveDialog>
</template>
