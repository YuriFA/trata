<script setup lang="ts">
import { useForm, useFieldValue, useSetFieldValue, Field as VeeField } from 'vee-validate'
import type { TransferTransaction } from '@/entities/transaction'
import { toTypedSchema } from '@vee-validate/zod'
import { PlusIcon } from '@lucide/vue'
import { Button } from '@/shared/ui/button'
import { DialogClose, DialogFooter } from '@/shared/ui/dialog'
import { DIALOG_FORM_FOOTER_CLASS } from '@/shared/ui/responsive-dialog'
import { Field, FieldError, FieldLabel } from '@/shared/ui/field'
import { Input } from '@/shared/ui/input'
import { useI18n } from 'vue-i18n'
import { AmountField } from '@/shared/ui/amount-field'
import { AccountSelect, NewAccountDialog, useAccounts } from '@/entities/account'
import { useUpdateTransaction } from '@/entities/transaction'
import { notification } from '@/shared/services/notification'
import { createTransferEditSchema, type TransferEditValues } from '../model/transfer-schema'
import {
  convert,
  DEFAULT_CURRENCY,
  toMajorUnits,
  toMinorUnits,
  type CurrencyCode,
} from '@/shared/lib/money'
import { useRates } from '@/shared/lib/money'
import { computed, ref } from 'vue'

const emit = defineEmits<{
  success: []
}>()

const {
  id,
  version,
  amount,
  destinationAmount: initialDestinationAmount = undefined,
  description,
  fromAccountId: initialFrom,
  toAccountId: initialTo,
} = defineProps<{
  id: string
  version: number
  amount: number
  /** The stored credit in minor units, present on cross-currency transfers. */
  destinationAmount?: number
  description: string
  fromAccountId: string
  toAccountId: string
}>()

const { mutateAsync: updateTransaction } = useUpdateTransaction<TransferTransaction>()
const { t } = useI18n()
const { data: accounts } = useAccounts()

const { handleSubmit: handleFormSubmit, isSubmitting } = useForm<TransferEditValues>({
  validationSchema: toTypedSchema(
    createTransferEditSchema({
      // Read at validate time, after setup - the iff-rule judges the live
      // account pair (the computeds below are initialized by then).
      isCrossCurrency: () => crossCurrency.value,
    }),
  ),
  initialValues: {
    type: 'transfer',
    amount: toMajorUnits(amount),
    destinationAmount:
      initialDestinationAmount !== undefined ? toMajorUnits(initialDestinationAmount) : undefined,
    description,
    fromAccountId: initialFrom,
    toAccountId: initialTo,
  },
})

const fromAccountId = useFieldValue<TransferEditValues['fromAccountId']>('fromAccountId')
const toAccountId = useFieldValue<TransferEditValues['toAccountId']>('toAccountId')

const fromCurrency = computed<CurrencyCode>(() => {
  const account = accounts.value?.find((a) => a.id === fromAccountId.value)
  return account?.currency ?? DEFAULT_CURRENCY
})
const toCurrency = computed<CurrencyCode>(() => {
  const account = accounts.value?.find((a) => a.id === toAccountId.value)
  return account?.currency ?? DEFAULT_CURRENCY
})
// Cross-currency pair: the destination-amount field appears and the payload
// carries the credit (the iff-rule - multi-currency, transactions spec).
const crossCurrency = computed(() => fromCurrency.value !== toCurrency.value)
const rates = useRates()
// The suggested rate for the hint: 1 source-currency unit in destination
// units, from the cached published rates; hidden while rates are missing
// (the degradation rule - the field stays editable regardless).
const conversionHint = computed(() => {
  if (!crossCurrency.value || !rates.value) return null
  const minor = convert(toMinorUnits(1), fromCurrency.value, toCurrency.value, rates.value)
  if (minor === null) return null
  const rate = Math.round(toMajorUnits(minor) * 10_000) / 10_000
  return t('addTransfer.conversionHint', {
    from: fromCurrency.value,
    to: toCurrency.value,
    rate,
  })
})

// Inline account creation for each selector (the TransferForm contract):
// the created account flows only into the triggering selector.
const fromAccountDialogOpen = ref(false)
const toAccountDialogOpen = ref(false)
const setFromAccountId = useSetFieldValue<TransferEditValues['fromAccountId']>('fromAccountId')
const setToAccountId = useSetFieldValue<TransferEditValues['toAccountId']>('toAccountId')

const handleSubmit = handleFormSubmit(async (data) => {
  const fromAccount = accounts.value?.find((a) => a.id === data.fromAccountId)
  const toAccount = accounts.value?.find((a) => a.id === data.toAccountId)
  const crossCurrency = !!fromAccount && !!toAccount && fromAccount.currency !== toAccount.currency

  try {
    await updateTransaction({
      id,
      payload: {
        version,
        type: data.type,
        fromAccountId: data.fromAccountId,
        toAccountId: data.toAccountId,
        amount: toMinorUnits(data.amount),
        description: data.description,
        // Same-currency transfers never carry a destination amount; the
        // schema already required the credit for a cross-currency pair.
        ...(crossCurrency ? { destinationAmount: toMinorUnits(data.destinationAmount!) } : {}),
      },
    })
    notification.success(t('editTransaction.success'))
    emit('success')
  } catch (error) {
    notification.mutationError(error, {
      title: t('editTransaction.error'),
      feature: 'transaction',
      action: 'update',
    })
  }
})
</script>

<template>
  <div>
    <form id="edit-transfer-form" class="flex flex-col gap-3" @submit="handleSubmit">
      <div class="flex items-end gap-2">
        <VeeField v-slot="{ value, setValue, errors }" name="fromAccountId">
          <div class="flex w-full items-end gap-2">
            <AccountSelect
              input-id="from-account-id"
              :label="t('addTransfer.fromAccountLabel')"
              :placeholder="t('addTransfer.fromAccountPlaceholder')"
              class="w-full"
              :model-value="value"
              :errors="errors"
              :exclude-id="toAccountId"
              @update:model-value="setValue"
            />
            <Button
              type="button"
              variant="outline"
              class="mb-0.5 size-9 shrink-0"
              :aria-label="t('addAccount.newAccount')"
              :title="t('addAccount.newAccount')"
              data-testid="open-new-from-account"
              @click="fromAccountDialogOpen = true"
            >
              <PlusIcon class="size-4" />
            </Button>
          </div>
        </VeeField>
        <VeeField v-slot="{ value, setValue, errors }" name="amount">
          <Field class="w-40" :data-invalid="!!errors.length">
            <FieldLabel for="transfer-edit-amount">{{ t('fields.amount') }}</FieldLabel>
            <AmountField
              id="transfer-edit-amount"
              class="w-full"
              :currency="fromCurrency"
              :model-value="value"
              :errors="errors"
              :placeholder="t('addTransfer.amountPlaceholder')"
              @update:model-value="(v) => setValue(v as number)"
            />
          </Field>
        </VeeField>
      </div>

      <VeeField v-slot="{ value, setValue, errors }" name="toAccountId">
        <div class="flex w-full items-end gap-2">
          <AccountSelect
            input-id="to-account-id"
            :label="t('addTransfer.toAccountLabel')"
            :placeholder="t('addTransfer.toAccountPlaceholder')"
            class="w-full"
            :model-value="value"
            :errors="errors"
            :exclude-id="fromAccountId"
            @update:model-value="setValue"
          />
          <Button
            type="button"
            variant="outline"
            class="mb-0.5 size-9 shrink-0"
            :aria-label="t('addAccount.newAccount')"
            :title="t('addAccount.newAccount')"
            data-testid="open-new-to-account"
            @click="toAccountDialogOpen = true"
          >
            <PlusIcon class="size-4" />
          </Button>
        </div>
      </VeeField>

      <VeeField v-if="crossCurrency" v-slot="{ value, setValue, errors }" name="destinationAmount">
        <Field :data-invalid="!!errors.length">
          <FieldLabel for="transfer-edit-destination-amount">
            {{ t('addTransfer.destinationAmountLabel') }}
          </FieldLabel>
          <AmountField
            id="transfer-edit-destination-amount"
            :currency="toCurrency"
            :model-value="value"
            :errors="errors"
            @update:model-value="(v) => setValue(v as number)"
          />
          <p v-if="conversionHint" class="text-xs text-muted-foreground">{{ conversionHint }}</p>
          <FieldError v-if="errors.length" :errors="errors" />
        </Field>
      </VeeField>

      <VeeField v-slot="{ field, errors }" name="description">
        <Field class="w-full md:min-w-56 md:flex-1" :data-invalid="!!errors.length">
          <FieldLabel for="transfer-description">{{
            t('addTransfer.descriptionLabel')
          }}</FieldLabel>
          <Input
            id="transfer-description"
            :placeholder="t('addTransfer.descriptionPlaceholder')"
            :model-value="field.value"
            :aria-invalid="!!errors.length"
            @update:model-value="field.onChange"
            @blur="field.onBlur"
          />
          <FieldError v-if="errors.length" :errors="errors" />
        </Field>
      </VeeField>

      <DialogFooter :class="DIALOG_FORM_FOOTER_CLASS">
        <DialogClose as-child>
          <Button type="button" variant="secondary" class="w-full sm:flex-1">
            {{ t('editTransaction.cancel') }}
          </Button>
        </DialogClose>
        <Button
          form="edit-transfer-form"
          type="submit"
          class="w-full sm:flex-1"
          :loading="isSubmitting"
        >
          {{ t('editTransaction.submit') }}
        </Button>
      </DialogFooter>
    </form>

    <NewAccountDialog
      v-model:open="fromAccountDialogOpen"
      data-testid="new-from-account-dialog"
      @created="setFromAccountId($event.id)"
    />
    <NewAccountDialog
      v-model:open="toAccountDialogOpen"
      data-testid="new-to-account-dialog"
      @created="setToAccountId($event.id)"
    />
  </div>
</template>
