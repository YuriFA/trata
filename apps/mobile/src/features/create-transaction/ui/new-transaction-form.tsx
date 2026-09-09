// The create-transaction form: one discriminated-union schema, three flows
// (expense / income / transfer) in the redesigned keypad sheet. The amount is
// edited exclusively through the custom keypad - the amount never renders a
// TextInput, so no system keyboard for it; the note is the only native input.
// Amount stays a string in form values; `toTransactionPayload` converts to
// int64 minor units at the submission boundary (conventions forms.md §2/§4).
//
// The root owns only the form lifecycle and submission. Every field section
// (amount, accounts, category, the action toolbar) subscribes to its own
// slice of the form through useFormContext - the root holds no useWatch and
// reads no formState, so edits re-render only the section that shows them.
// Each picker sheet mounts inside its owning section (always mounted, so
// conditional reveal rows never unmount an open sheet).

import { useCallback, useEffect, useMemo, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { FormProvider, useForm, useFormContext, useFormState } from 'react-hook-form'
import { View } from 'react-native'
import type { CreateTransactionPayload } from '@trata/api'
import { useAccounts } from '@/entities/account'
import { useCreateTransaction } from '@/entities/transaction'
import { getRepositoryErrorText } from '@/shared/lib/data/repository-errors-ru'
import { parseMajorUnitsToMinor } from '@/shared/lib/money/parse'
import { FormError } from '@/shared/ui/form'
import { Icon } from '@/shared/ui/icon'
import { Text } from '@/shared/ui/text'
import { applyKeypadInput, type KeypadKey } from '../model/amount-keypad'
import {
  createTransactionDefaultValues,
  createTransactionSchema,
  type CreateTransactionFormValues,
  type TransactionFlowKind,
} from '../model/schema'
import { AccountField } from './account-field'
import { AmountField } from './amount-field'
import { AmountKeypad } from './amount-keypad'
import { CategoryField } from './category-field'
import { FormActions } from './form-actions'
import { TransferFields } from './transfer-fields'

function toTransactionPayload(values: CreateTransactionFormValues): CreateTransactionPayload {
  const base = {
    // The schema's refine guarantees parseability; the fallback only
    // satisfies the parser's `number | null` return type.
    amount: parseMajorUnitsToMinor(values.amount) ?? 0,
    description: values.description.trim(),
    occurredAt: values.occurredAt,
  }

  if (values.kind === 'transfer') {
    return {
      type: 'transfer',
      ...base,
      fromAccountId: values.fromAccountId,
      toAccountId: values.toAccountId,
    }
  }

  return {
    type: values.kind,
    ...base,
    accountId: values.accountId,
    categoryId: values.categoryId,
  }
}

interface NewTransactionFormProps {
  kind: TransactionFlowKind
  /** Preselected category id for expense/income flows (e.g. a category sheet). */
  defaultCategoryId?: string
  onSuccess: () => void
}

/** The form-level (root) error slot, isolated so edits don't re-render it. */
function TransactionRootError() {
  const { control } = useFormContext<CreateTransactionFormValues>()
  const { errors } = useFormState({ control })

  return <FormError testID="new-transaction-error">{errors.root?.message}</FormError>
}

export function NewTransactionForm({
  kind,
  defaultCategoryId,
  onSuccess,
}: NewTransactionFormProps) {
  const form = useForm<CreateTransactionFormValues>({
    resolver: zodResolver(createTransactionSchema),
    defaultValues: createTransactionDefaultValues(kind, defaultCategoryId),
    // Live validity drives the submit button's disabled state (the reference
    // UX): it unlocks only once every required field of the flow is set.
    mode: 'onChange',
  })
  const createTransaction = useCreateTransaction()
  const accounts = useAccounts().data ?? []

  // Bumped on every reset; re-mounts the action toolbar so its reveal state
  // (note input, quick dates) collapses with the fresh form.
  const [formEpoch, setFormEpoch] = useState(0)

  const defaultValues = useMemo(
    () => createTransactionDefaultValues(kind, defaultCategoryId),
    [kind, defaultCategoryId],
  )

  // reset() does not re-run the resolver, so formState.isValid (the submit's
  // disabled source) would keep its pre-reset value until the next edit;
  // trigger() recomputes it against the fresh defaults.
  const resetForm = useCallback(
    (values: CreateTransactionFormValues) => {
      form.reset(values)
      void form.trigger()
      setFormEpoch((epoch) => epoch + 1)
    },
    [form],
  )

  // Re-initialize the form whenever a new flow opens from the speed dial.
  useEffect(() => {
    resetForm(defaultValues)
  }, [defaultValues, resetForm])

  const handleAmountKey = (key: KeypadKey) => {
    form.setValue('amount', applyKeypadInput(form.getValues('amount'), key), {
      shouldValidate: true,
    })
  }

  const handleSubmit = async (values: CreateTransactionFormValues) => {
    try {
      await createTransaction.mutateAsync(toTransactionPayload(values))
      // Full reset: the next open starts from the defaults, selections
      // included (the old partial reset deliberately left them behind). The
      // preselected category survives so follow-up creates keep the context.
      resetForm(createTransactionDefaultValues(kind, defaultCategoryId))
      onSuccess()
    } catch (cause) {
      form.setError('root', { message: getRepositoryErrorText(cause) })
    }
  }

  return (
    <FormProvider {...form}>
      <View className="flex-1">
        <View className="flex-1 gap-4 px-4">
          {kind === 'transfer' ? <TransferFields /> : <AccountField />}

          <AmountField kind={kind} />

          {kind !== 'transfer' ? <CategoryField kind={kind} /> : null}

          <FormActions
            key={formEpoch}
            pending={createTransaction.isPending}
            onSubmit={form.handleSubmit(handleSubmit)}
          />

          {accounts.length === 0 ? (
            <View className="flex-row items-center gap-2">
              <Icon name="information-circle" size={16} colorClassName="accent-muted-foreground" />
              <Text variant="caption" className="flex-1 text-muted-foreground">
                Чтобы записать транзакцию, сначала создайте счёт
              </Text>
            </View>
          ) : null}

          <TransactionRootError />
        </View>

        <AmountKeypad onKey={handleAmountKey} />
      </View>
    </FormProvider>
  )
}
