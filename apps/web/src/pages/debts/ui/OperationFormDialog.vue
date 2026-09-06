<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useForm, Field as VeeField, useFieldValue, useSetFieldValue } from 'vee-validate'
import { toTypedSchema } from '@vee-validate/zod'
import { calendarDayKey } from '@expense-tracker/dates'
import type { Debtor } from '@/entities/debtor'
import {
  balanceInDirection,
  useCreateDebtOperation,
  useDeleteDebtOperation,
  useUpdateDebtOperation,
  type DebtDirection,
  type DebtOperation,
} from '@/entities/debt-operation'
import { createOperationSchema, type OperationFormValues } from '../model/schemas'
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
import { SegmentedControl, type SegmentedControlOption } from '@/shared/ui/segmented-control'
import { Field, FieldError, FieldLabel } from '@/shared/ui/field'
import { DateField } from '@/shared/ui/date-field'
import { Input } from '@/shared/ui/input'
import { AmountField } from '@/shared/ui/amount-field'
import { Trash2 } from '@lucide/vue'
import { notification } from '@/shared/services/notification'
import { DEFAULT_CURRENCY, formatMoney, toMajorUnits, toMinorUnits } from '@/shared/lib/money'

// Create/edit a debt operation. Direction, kind, and debtor are immutable
// (debts capability): create fixes them from the calling context; edit shows
// them as static rows. A repayment larger than the remaining balance warns
// but never blocks (over-repayment is legal data).

const props = defineProps<{
  debtor: Debtor
  direction: DebtDirection
  /** null = create with the section's fixed context. */
  operation: DebtOperation | null
  /** Live operations of the debtor, for the over-repayment warning. */
  operations: readonly DebtOperation[]
  /** Create-mode kind preset (the history footer's split actions). */
  initialKind?: OperationFormValues['kind']
}>()

const open = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
  success: []
  deleted: []
}>()

const { t, locale } = useI18n()
// Debts carry no currency of their own; the app display currency is fixed
// (currency-rub-only).
const displayCurrency = computed(() => DEFAULT_CURRENCY)

const isEdit = computed(() => props.operation !== null)

const { mutateAsync: createOperation } = useCreateDebtOperation()
const { mutateAsync: updateOperation } = useUpdateDebtOperation()
const { mutateAsync: deleteOperation } = useDeleteDebtOperation()

const { handleSubmit: handleFormSubmit, isSubmitting } = useForm<OperationFormValues>({
  validationSchema: toTypedSchema(createOperationSchema()),
  initialValues: {
    kind: props.initialKind ?? 'debt',
    amount: props.operation ? toMajorUnits(props.operation.amount) : undefined,
    occurredAt: props.operation
      ? calendarDayKey(new Date(props.operation.occurredAt))
      : calendarDayKey(new Date()),
    note: props.operation?.note ?? '',
  },
})

const kindValue = useFieldValue<OperationFormValues['kind']>('kind')
const setKind = useSetFieldValue<OperationFormValues['kind']>('kind')
// Literal keys per branch (the i18n lint bans dynamic keys).
const kindOptions = computed<SegmentedControlOption<OperationFormValues['kind']>[]>(() => [
  { value: 'debt', label: t('debts.debt') },
  { value: 'repayment', label: t('debts.repayment') },
])
const amountValue = useFieldValue<OperationFormValues['amount']>('amount')

const directionLabel = computed(() =>
  props.direction === 'receivable' ? t('debts.receivable') : t('debts.payable'),
)

const balance = computed(() =>
  balanceInDirection(props.operations, props.debtor.id, props.direction),
)

// The kind the warning keys off: the form switch in create mode, the
// operation's immutable kind in edit mode.
const effectiveKind = computed(() => (isEdit.value ? props.operation!.kind : kindValue.value))

// Warns only, never blocks (debts capability: over-repayment is recorded).
const overRepayment = computed(() => {
  if (effectiveKind.value !== 'repayment' || amountValue.value === undefined) return null
  return toMinorUnits(amountValue.value) > balance.value
    ? t('debts.overRepayment', {
        remaining: formatMoney(balance.value, displayCurrency.value, locale.value),
      })
    : null
})

const handleSubmit = handleFormSubmit(async (data) => {
  const occurredAt = new Date(`${data.occurredAt}T12:00:00.000Z`).toISOString()
  try {
    if (props.operation) {
      await updateOperation({
        id: props.operation.id,
        payload: {
          version: props.operation.version,
          amount: toMinorUnits(data.amount),
          note: data.note.trim(),
          occurredAt,
        },
      })
      notification.success(t('debts.operationUpdated'))
    } else {
      await createOperation({
        debtorId: props.debtor.id,
        direction: props.direction,
        kind: data.kind,
        amount: toMinorUnits(data.amount),
        note: data.note.trim(),
        occurredAt,
      })
      notification.success(t('debts.operationAdded'))
    }
    emit('success')
    open.value = false
  } catch (error) {
    notification.mutationError(error, {
      title: t('debts.error'),
      feature: 'debt-operation',
      action: props.operation ? 'update' : 'create',
    })
  }
})

const deleteOpen = ref(false)
const isDeleting = ref(false)

const handleDelete = async () => {
  if (!props.operation) return
  isDeleting.value = true
  try {
    await deleteOperation(props.operation.id)
    notification.success(t('debts.operationDeleted'))
    emit('deleted')
    open.value = false
  } catch (error) {
    notification.mutationError(error, {
      title: t('debts.error'),
      feature: 'debt-operation',
      action: 'delete',
    })
  } finally {
    isDeleting.value = false
    deleteOpen.value = false
  }
}
</script>

<template>
  <ResponsiveDialog v-model:open="open" class="sm:max-w-sm" data-testid="debts-operation-dialog">
    <template #title>{{ isEdit ? t('debts.operation') : t('debts.newOperation') }}</template>
    <template #description>{{ debtor.name }}</template>

    <form id="debts-operation-form" class="flex flex-col gap-3" @submit="handleSubmit">
      <div class="grid grid-cols-2 gap-2 text-sm">
        <div>
          <p class="text-muted-foreground">{{ t('debts.contact') }}</p>
          <p class="font-medium">{{ debtor.name }}</p>
        </div>
        <div>
          <p class="text-muted-foreground">{{ t('debts.direction') }}</p>
          <p class="font-medium">{{ directionLabel }}</p>
        </div>
      </div>

      <SegmentedControl
        v-if="!isEdit"
        :model-value="kindValue"
        class="w-full"
        :options="kindOptions"
        :aria-label="t('fields.transactionType')"
        data-testid="debts-operation-kind"
        @update:model-value="setKind"
      />
      <div v-else class="text-sm">
        <p class="text-muted-foreground">{{ t('fields.transactionType') }}</p>
        <p class="font-medium">
          {{ operation!.kind === 'debt' ? t('debts.debt') : t('debts.repayment') }}
        </p>
      </div>

      <VeeField v-slot="{ value, setValue, errors }" name="amount">
        <Field :data-invalid="!!errors.length">
          <FieldLabel for="debts-operation-amount">{{ t('fields.amount') }}</FieldLabel>
          <AmountField
            id="debts-operation-amount"
            class="w-full"
            :currency="displayCurrency"
            :model-value="value"
            :errors="errors"
            @update:model-value="(v) => setValue(v as number)"
          />
        </Field>
      </VeeField>

      <p
        v-if="overRepayment"
        class="text-xs text-[var(--warning)]"
        data-testid="debts-operation-over-repayment"
      >
        {{ overRepayment }}
      </p>

      <VeeField v-slot="{ value, setValue, errors }" name="occurredAt">
        <Field :data-invalid="!!errors.length">
          <FieldLabel for="debts-operation-date">{{ t('fields.date') }}</FieldLabel>
          <DateField
            input-id="debts-operation-date"
            :model-value="value"
            :placeholder="t('fields.datePlaceholder')"
            :aria-invalid="!!errors.length"
            @update:model-value="setValue"
          />
          <FieldError v-if="errors.length" :errors="errors" />
        </Field>
      </VeeField>

      <VeeField v-slot="{ value, setValue }" name="note">
        <Field>
          <FieldLabel for="debts-operation-note">{{ t('fields.description') }}</FieldLabel>
          <Input
            id="debts-operation-note"
            type="text"
            :placeholder="t('debts.notePlaceholder')"
            :model-value="value"
            @update:model-value="setValue"
          />
        </Field>
      </VeeField>
    </form>

    <template #footer>
      <Button
        v-if="isEdit"
        type="button"
        variant="outline"
        :aria-label="t('debts.deleteOperation')"
        data-testid="debts-operation-delete"
        @click="deleteOpen = true"
      >
        <Trash2 class="size-4" />
      </Button>
      <Button
        type="submit"
        form="debts-operation-form"
        :loading="isSubmitting"
        data-testid="debts-operation-submit"
      >
        {{ isEdit ? t('debts.saveOperation') : t('debts.addOperation') }}
      </Button>
    </template>

    <AlertDialog v-model:open="deleteOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{{ t('debts.deleteOperationTitle') }}</AlertDialogTitle>
          <AlertDialogDescription>
            {{ t('deleteTransaction.confirmDeleteDescription') }}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{{ t('debts.cancel') }}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" :loading="isDeleting" @click="handleDelete">
            {{ t('debts.delete') }}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </ResponsiveDialog>
</template>
