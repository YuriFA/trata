// The edit-transaction form: prefilled from the record (via the detail
// query), one field per row (reference layout), and a header with close on
// the left and delete on the right. The amount is a plain text input - no
// custom keypad - staying a canonical string in form values;
// `toUpdatePayload` converts to int64 minor units and merges the record's
// CAS `version` at the submission boundary (conventions forms.md §2/§4).
//
// The root owns only the form lifecycle and the two mutations. Every field
// section (amount, accounts, category, date, note, submit) subscribes to its
// own slice of the form through useFormContext - the root holds no useWatch
// and reads no formState (conventions components-and-state.md).

import { useEffect } from 'react'
import { Alert, View } from 'react-native'
import { nowIso } from '@trata/dates'
import { zodResolver } from '@hookform/resolvers/zod'
import { FormProvider, useForm, useFormContext, useFormState } from 'react-hook-form'
import type { Transaction, TransactionType, UpdateTransactionPayload } from '@trata/api'
import { useTransaction, useDeleteTransaction, useUpdateTransaction } from '@/entities/transaction'
import { authorLabel, useHousehold } from '@/entities/household'
import { useAuth } from '@/entities/session'
import { getRepositoryErrorText } from '@/shared/lib/data/repository-errors-ru'
import { parseMajorUnitsToMinor } from '@/shared/lib/money/parse'
import { BottomSheetHeader } from '@/shared/ui/bottom-sheet'
import { Button } from '@/shared/ui/button'
import { FormError } from '@/shared/ui/form'
import { IconButton } from '@/shared/ui/icon-button'
import { Text } from '@/shared/ui/text'
import {
  editTransactionDefaultValues,
  editTransactionSchema,
  type EditTransactionFormValues,
} from '../model/schema'
import { AmountInputField } from './amount-input-field'
import {
  CashflowAccountRow,
  CategoryFieldRow,
  DateFieldRow,
  NoteField,
  TransferAccountRows,
} from './field-rows'

// TODO(i18n): RU wording until mobile i18n wiring lands.
const TYPE_TITLES: Record<TransactionType, string> = {
  expense: 'Расход',
  income: 'Доход',
  transfer: 'Перевод',
  adjustment: 'Корректировка',
}

// Placeholder branch for the (closed-sheet) gap before the record arrives;
// the reset effect swaps in the record's real values. `occurredAt` seeds with
// "now" like the create defaults - an empty string would hand
// `new Date('')` (Invalid Date) to the date picker on the transitional
// render and crash `monthLabel`.
const emptyExpenseValues: EditTransactionFormValues = {
  type: 'expense',
  amount: '',
  description: '',
  occurredAt: nowIso(),
  accountId: '',
  categoryId: '',
}

/**
 * The detail's provenance line (household-ux 2.4): unlike the compact row
 * markers, the detail shows who created the record even alone in the
 * household («вами») - provenance, not collaboration (design D2). Renders
 * nothing when the author is unknown (pre-authorship or departed member).
 */
function AuthorRow({ transaction }: { transaction: Transaction }) {
  const { status, user } = useAuth()
  const householdQuery = useHousehold({ enabled: status === 'authenticated' })
  if (status !== 'authenticated') return null
  const label = authorLabel(transaction.authorId, householdQuery.data?.members ?? [], user?.id, {
    selfLabel: 'вами',
    includeSingleMember: true,
  })
  if (!label) return null
  return (
    <Text
      variant="caption"
      className="text-muted-foreground px-4"
      testID={`edit-transaction-author-${transaction.id}`}
    >
      {`Кем записано: ${label}`}
    </Text>
  )
}

function toUpdatePayload(
  values: EditTransactionFormValues,
  version: number,
): UpdateTransactionPayload {
  const base = {
    version,
    // The schema's refine guarantees parseability; the fallback only
    // satisfies the parser's `number | null` return type.
    amount: parseMajorUnitsToMinor(values.amount) ?? 0,
    description: values.description.trim(),
    occurredAt: values.occurredAt,
  }

  if (values.type === 'transfer') {
    return {
      ...base,
      fromAccountId: values.fromAccountId,
      toAccountId: values.toAccountId,
      // The iff-rule: the figure travels only across currencies (the schema
      // validated presence and magnitude); same-currency updates omit it.
      ...(values.crossCurrency && values.destinationAmount !== ''
        ? { destinationAmount: parseMajorUnitsToMinor(values.destinationAmount) ?? 0 }
        : {}),
    }
  }
  if (values.type === 'adjustment') {
    return { ...base, accountId: values.accountId }
  }
  return { ...base, accountId: values.accountId, categoryId: values.categoryId }
}

/** The form-level (root) error slot, isolated so edits don't re-render it. */
function TransactionRootError() {
  const { control } = useFormContext<EditTransactionFormValues>()
  const { errors } = useFormState({ control })

  return <FormError testID="edit-transaction-error">{errors.root?.message}</FormError>
}

/** The Save button, isolated: it alone subscribes to form validity. */
function TransactionSubmitField({ pending, onSubmit }: { pending: boolean; onSubmit: () => void }) {
  const { control } = useFormContext<EditTransactionFormValues>()
  const { isValid, isSubmitting } = useFormState({ control })
  const blocked = pending || isSubmitting

  return (
    <Button
      variant="primary"
      text="Сохранить"
      className="mt-6"
      testID="edit-transaction-save"
      loading={blocked}
      disabled={!isValid || blocked}
      onPress={onSubmit}
    />
  )
}

export interface EditTransactionFormProps {
  /** The transaction to edit; nothing renders while it is unset. */
  transactionId: string | undefined
  /** Container hook: dismiss the sheet after a successful save/delete. */
  onSuccess: () => void
  /** Container hook: the header's close button. */
  onClose: () => void
}

export function EditTransactionForm({
  transactionId,
  onSuccess,
  onClose,
}: EditTransactionFormProps) {
  const form = useForm<EditTransactionFormValues>({
    resolver: zodResolver(editTransactionSchema),
    defaultValues: emptyExpenseValues,
    // Live validity drives the Save button's disabled state, like the create
    // form: it unlocks only once every required field of the flow is set.
    mode: 'onChange',
  })
  const transactionQuery = useTransaction(transactionId)
  const transaction = transactionQuery.data
  const updateTransaction = useUpdateTransaction()
  const deleteTransaction = useDeleteTransaction()
  const pending = updateTransaction.isPending || deleteTransaction.isPending

  // The form mounts before the query resolves, and refetches can swap
  // the transaction object while it is alive, so prefill is an explicit
  // reset (forms.md §3). reset() does not re-run the resolver, so
  // formState.isValid would keep its pre-reset value until the next
  // edit; trigger() recomputes it against the fresh defaults.
  useEffect(() => {
    if (!transaction) return
    form.reset(editTransactionDefaultValues(transaction))
    void form.trigger()
  }, [transaction, form])

  if (!transactionId) return null

  if (!transaction) {
    return (
      <View className="px-4 pb-6">
        {/* TODO(i18n): RU wording until mobile i18n wiring lands. */}
        <Text variant="body" className="text-muted-foreground">
          Загрузка…
        </Text>
      </View>
    )
  }

  const handleSubmit = async (values: EditTransactionFormValues) => {
    try {
      await updateTransaction.mutateAsync({
        id: transaction.id,
        payload: toUpdatePayload(values, transaction.version),
      })
      onSuccess()
    } catch (cause) {
      form.setError('root', { message: getRepositoryErrorText(cause) })
    }
  }

  const handleDeleteConfirm = async () => {
    try {
      await deleteTransaction.mutateAsync(transaction.id)
      onSuccess()
    } catch (cause) {
      form.setError('root', { message: getRepositoryErrorText(cause) })
    }
  }

  const handleDelete = () => {
    // TODO(i18n): RU wording until mobile i18n wiring lands.
    Alert.alert('Удалить транзакцию?', undefined, [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Удалить', style: 'destructive', onPress: () => void handleDeleteConfirm() },
    ])
  }

  return (
    <FormProvider {...form}>
      <BottomSheetHeader
        title={TYPE_TITLES[transaction.type]}
        left={
          <IconButton
            icon="close"
            size="md"
            colorClassName="accent-muted-foreground"
            accessibilityLabel="Закрыть"
            testID="edit-transaction-close"
            onPress={onClose}
          />
        }
        right={
          <IconButton
            icon="trash-outline"
            size="md"
            colorClassName="accent-destructive"
            accessibilityLabel="Удалить транзакцию"
            testID="edit-transaction-delete"
            disabled={pending}
            onPress={handleDelete}
          />
        }
      />

      <View className="gap-1 px-4 pb-safe">
        <AuthorRow transaction={transaction} />
        <AmountInputField
          currencySource={transaction.type === 'transfer' ? 'fromAccountId' : 'accountId'}
        />

        {transaction.type === 'transfer' ? (
          <TransferAccountRows />
        ) : transaction.type === 'adjustment' ? (
          <CashflowAccountRow kind={transaction.type} />
        ) : (
          <>
            <CashflowAccountRow kind={transaction.type} />
            <CategoryFieldRow kind={transaction.type} />
          </>
        )}

        <DateFieldRow />
        <NoteField />

        <TransactionRootError />
        <TransactionSubmitField pending={pending} onSubmit={form.handleSubmit(handleSubmit)} />
      </View>
    </FormProvider>
  )
}
