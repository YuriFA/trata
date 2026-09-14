import { useEffect, useRef } from 'react'
import { useController, useFormContext } from 'react-hook-form'
import { View } from 'react-native'
import { useAccounts } from '@/entities/account'
import type { BottomSheetRef } from '@/shared/ui/bottom-sheet'
import type { CreateTransactionFormValues } from '../model/schema'
import { AccountPickerSheet } from '@/shared/ui/account-picker-sheet'
import { AccountSelectorRow } from '@/shared/ui/account-selector-row'
import { SheetContentPortal } from '@/shared/ui/sheet-content-portal'
import { DestinationAmountField } from './destination-amount-field'

/**
 * The transfer variant's source and destination selectors: both rows, both
 * picker sheets, and the cross-currency bridge. Multi-currency (6.3): the
 * destination candidates are every OTHER account - currencies may differ,
 * and the schema's `crossCurrency` flag mirrors the effective pair so the
 * iff-rule for the destination amount becomes ordinary schema validation.
 * All fromAccountId/toAccountId subscriptions live here - the root form
 * never re-renders on transfer selection changes.
 */
export function TransferFields() {
  const { control, getValues, setValue } = useFormContext<CreateTransactionFormValues>()
  const fromField = useController({ name: 'fromAccountId', control }).field
  const toField = useController({ name: 'toAccountId', control }).field
  const accounts = useAccounts().data ?? []
  const fromAccount = accounts.find((account) => account.id === fromField.value)
  const toAccount = accounts.find((account) => account.id === toField.value)
  const fromPickerRef = useRef<BottomSheetRef>(null)
  const toPickerRef = useRef<BottomSheetRef>(null)

  // The effective pair's currency comparison, carried as form data.
  const crossCurrency =
    fromAccount !== undefined &&
    toAccount !== undefined &&
    fromAccount.currency !== toAccount.currency

  useEffect(() => {
    if (getValues('crossCurrency') !== crossCurrency) {
      setValue('crossCurrency', crossCurrency, { shouldValidate: true })
    }
  }, [crossCurrency, getValues, setValue])

  const handleFromSelect = (id: string) => {
    setValue('fromAccountId', id, { shouldValidate: true })
  }
  const handleToSelect = (id: string) => setValue('toAccountId', id, { shouldValidate: true })

  return (
    <View>
      <AccountSelectorRow
        label="Откуда"
        account={fromAccount}
        onPress={() => fromPickerRef.current?.present()}
        testID="new-transaction-from"
      />
      <AccountSelectorRow
        label="Куда"
        account={toAccount}
        disabled={!fromAccount}
        onPress={() => toPickerRef.current?.present()}
        testID="new-transaction-to"
      />

      <DestinationAmountField />

      <SheetContentPortal>
        <AccountPickerSheet
          ref={fromPickerRef}
          title="Откуда"
          accounts={accounts}
          selectedId={fromField.value ?? ''}
          onSelect={handleFromSelect}
          testIDPrefix="new-transaction-from"
        />
      </SheetContentPortal>
      <SheetContentPortal>
        <AccountPickerSheet
          ref={toPickerRef}
          title="Куда"
          // Multi-currency: every account except the source (the legacy
          // same-currency-only rule is gone).
          accounts={accounts.filter((account) => account.id !== fromAccount?.id)}
          selectedId={toField.value ?? ''}
          onSelect={handleToSelect}
          testIDPrefix="new-transaction-to"
        />
      </SheetContentPortal>
    </View>
  )
}
