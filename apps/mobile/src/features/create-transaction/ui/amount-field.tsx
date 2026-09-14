import { DEFAULT_CURRENCY } from '@trata/money'
import { useController, useFormContext, useWatch } from 'react-hook-form'
import { useAccounts } from '@/entities/account'
import type { TransactionFlowKind } from '../model/schema'
import type { CreateTransactionFormValues } from '../model/schema'
import { AmountDisplay } from './amount-display'

/**
 * The big read-only amount above the keypad. Subscribes to the amount alone;
 * the currency follows the account the money moves from, so that account's id
 * is the only other field watched here - keypad presses never re-render the
 * rest of the form.
 */
export function AmountField({ kind }: { kind: TransactionFlowKind }) {
  const { control } = useFormContext<CreateTransactionFormValues>()
  const { field, fieldState } = useController({ name: 'amount', control })
  const sourceAccountId =
    useWatch({ control, name: kind === 'transfer' ? 'fromAccountId' : 'accountId' }) ?? ''
  const accounts = useAccounts().data ?? []
  const currency =
    accounts.find((account) => account.id === sourceAccountId)?.currency ?? DEFAULT_CURRENCY

  return (
    <AmountDisplay
      value={field.value ?? ''}
      currency={currency}
      // The reference UX keeps the empty amount neutral - it is "not filled
      // in" rather than invalid.
      invalid={field.value !== '' && fieldState.invalid}
    />
  )
}
