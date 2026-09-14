<script setup lang="ts">
import { useForm, useFieldValue, useSetFieldValue, Field as VeeField } from 'vee-validate'
import { createTransferSchema, type TransferFormValues } from '../model/transfer-schema'
import { lastAccountIds } from '../model/last-account-ids'
import type { TransferTransaction } from '@/entities/transaction'
import { toTypedSchema } from '@vee-validate/zod'
import { Button } from '@/shared/ui/button'
import { Field, FieldError, FieldLabel } from '@/shared/ui/field'
import { Input } from '@/shared/ui/input'
import { useI18n } from 'vue-i18n'
import { AmountField } from '@/shared/ui/amount-field'
import { AccountSelect, NewAccountDialog, useAccounts } from '@/entities/account'
import { formatCalendarDay, nowIsoString } from '@/shared/lib/date'
import { useCreateTransaction } from '@/entities/transaction'
import { notification } from '@/shared/services/notification'
import {
  convert,
  DEFAULT_CURRENCY,
  toMajorUnits,
  toMinorUnits,
  type CurrencyCode,
} from '@/shared/lib/money'
import { useRates } from '@/shared/lib/money'
import { DialogClose, DialogFooter } from '@/shared/ui/dialog'
import { DIALOG_FORM_FOOTER_CLASS } from '@/shared/ui/responsive-dialog'
import { DateField } from '@/shared/ui/date-field'
import { PlusIcon } from '@lucide/vue'
import { computed, ref } from 'vue'

const emit = defineEmits<{
  success: []
}>()

const initialOccurredAt = nowIsoString()

const { mutateAsync: createTransaction } = useCreateTransaction<TransferTransaction>()
const { t, locale } = useI18n()
const { data: accounts } = useAccounts()

const initial = lastAccountIds.getTransferAccountIds()

const { handleSubmit: handleFormSubmit, isSubmitting } = useForm<TransferFormValues>({
  validationSchema: toTypedSchema(
    createTransferSchema({
      // Read at validate time, after setup - the iff-rule judges the live
      // account pair (the computeds below are initialized by then).
      isCrossCurrency: () => crossCurrency.value,
    }),
  ),
  initialValues: {
    type: 'transfer',
    fromAccountId: initial.fromAccountId ?? '',
    toAccountId: initial.toAccountId ?? '',
    destinationAmount: undefined,
    occurredAt: initialOccurredAt,
  },
})

const fromAccountId = useFieldValue<TransferFormValues['fromAccountId']>('fromAccountId')
const toAccountId = useFieldValue<TransferFormValues['toAccountId']>('toAccountId')

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

// Day-level choice, the initial clock time is preserved (see CashflowForm).
const occurredAt = useFieldValue<TransferFormValues['occurredAt']>('occurredAt')
const timeSuffix = initialOccurredAt.slice(10)
const selectedDay = computed(() => occurredAt.value.slice(0, 10))
const occurredAtLabel = computed(() =>
  formatCalendarDay(selectedDay.value, locale.value, { dateStyle: 'long' }),
)
const setOccurredAt = useSetFieldValue<TransferFormValues['occurredAt']>('occurredAt')
const onDatePick = (value: string) => {
  setOccurredAt(`${value}${timeSuffix}`)
}

// Inline account creation for each selector (the CashflowForm contract):
// the created account flows only into the selector whose "+" was used, so
// the from ≠ to pairing is decided by the user, never rewritten.
const fromAccountDialogOpen = ref(false)
const toAccountDialogOpen = ref(false)
const setFromAccountId = useSetFieldValue<TransferFormValues['fromAccountId']>('fromAccountId')
const setToAccountId = useSetFieldValue<TransferFormValues['toAccountId']>('toAccountId')

const handleSubmit = handleFormSubmit(async (data) => {
  const fromAccount = accounts.value?.find((a) => a.id === data.fromAccountId)
  const toAccount = accounts.value?.find((a) => a.id === data.toAccountId)
  const crossCurrency = !!fromAccount && !!toAccount && fromAccount.currency !== toAccount.currency

  try {
    await createTransaction({
      type: data.type,
      fromAccountId: data.fromAccountId,
      toAccountId: data.toAccountId,
      amount: toMinorUnits(data.amount),
      description: data.description,
      // Same-currency transfers never carry a destination amount; the
      // schema already required the credit for a cross-currency pair.
      ...(crossCurrency ? { destinationAmount: toMinorUnits(data.destinationAmount!) } : {}),
      occurredAt: data.occurredAt,
    })
    lastAccountIds.setTransferAccountIds(data.fromAccountId, data.toAccountId)
    notification.success(t('addTransfer.success'))
    emit('success')
  } catch (error) {
    notification.mutationError(error, {
      title: t('addTransfer.error'),
      feature: 'transaction',
      action: 'create',
    })
  }
})
</script>

<template>
  <form id="add-transfer-form" class="flex flex-col gap-4" @submit="handleSubmit">
    <VeeField v-slot="{ value, setValue, errors }" name="amount">
      <Field :data-invalid="!!errors.length">
        <FieldLabel for="transfer-amount">{{ t('fields.amount') }}</FieldLabel>
        <AmountField
          id="transfer-amount"
          :currency="fromCurrency"
          :model-value="value"
          :errors="errors"
          :placeholder="t('addTransfer.amountPlaceholder')"
          @update:model-value="(v) => setValue(v as number)"
        />
      </Field>
    </VeeField>

    <VeeField v-if="crossCurrency" v-slot="{ value, setValue, errors }" name="destinationAmount">
      <Field :data-invalid="!!errors.length">
        <FieldLabel for="transfer-destination-amount">
          {{ t('addTransfer.destinationAmountLabel') }}
        </FieldLabel>
        <AmountField
          id="transfer-destination-amount"
          :currency="toCurrency"
          :model-value="value"
          :errors="errors"
          @update:model-value="(v) => setValue(v as number)"
        />
        <p v-if="conversionHint" class="text-xs text-muted-foreground">{{ conversionHint }}</p>
        <FieldError v-if="errors.length" :errors="errors" />
      </Field>
    </VeeField>

    <div class="grid gap-4 sm:grid-cols-2">
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
    </div>

    <VeeField v-slot="{ errors }" name="occurredAt">
      <Field :data-invalid="!!errors.length">
        <FieldLabel for="transfer-occurred-at">{{ t('fields.date') }}</FieldLabel>
        <DateField
          input-id="transfer-occurred-at"
          :model-value="selectedDay"
          :placeholder="occurredAtLabel"
          :aria-invalid="!!errors.length"
          @update:model-value="onDatePick"
        />
        <FieldError v-if="errors.length" :errors="errors" />
      </Field>
    </VeeField>

    <VeeField v-slot="{ field, errors }" name="description">
      <Field class="w-full" :data-invalid="!!errors.length">
        <FieldLabel for="transfer-description">{{ t('addTransfer.descriptionLabel') }}</FieldLabel>
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

  <DialogFooter :class="DIALOG_FORM_FOOTER_CLASS">
    <DialogClose as-child>
      <Button type="button" variant="secondary" class="w-full sm:flex-1">
        {{ t('addTransfer.cancel') }}
      </Button>
    </DialogClose>
    <Button form="add-transfer-form" type="submit" class="w-full sm:flex-1" :loading="isSubmitting">
      {{ t('addTransfer.submit') }}
    </Button>
  </DialogFooter>
</template>
