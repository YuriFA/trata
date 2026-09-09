import { useController, useFormContext, useWatch } from 'react-hook-form'
import { View } from 'react-native'
import { currencySymbol } from '@trata/money'
import { useAccounts } from '@/entities/account'
import { FormError } from '@/shared/ui/form'
import { Text } from '@/shared/ui/text'
import { BottomSheetInput } from '@/shared/ui/bottom-sheet'
import { groupAmountInput } from '@/shared/lib/money/display'
import { sanitizeAmountInput } from '@/shared/lib/money/parse'
import type { EditTransactionFormValues } from '../model/schema'

/**
 * The edit form's amount: a plain text input (decimal keyboard) in a soft box
 * with the currency chip beside it - the reference layout. The form value
 * stays the canonical ungrouped string; grouping is display-only and input is
 * canonicalized through `sanitizeAmountInput`, so the submit-seam parse stays
 * exact. The chip derives from the field that owns the amount's currency:
 * the account for cash flows, the source account for transfers.
 */
export function AmountInputField({
  currencySource,
}: {
  currencySource: 'accountId' | 'fromAccountId'
}) {
  const { control, setValue } = useFormContext<EditTransactionFormValues>()
  const { field, fieldState } = useController({ name: 'amount', control })
  const accounts = useAccounts().data ?? []
  const currencyOwnerId = useWatch({ control, name: currencySource })
  const currency = accounts.find((account) => account.id === currencyOwnerId)?.currency

  return (
    <View className="gap-1">
      <View className="flex-row items-center gap-3 rounded-2xl bg-secondary px-4 py-3">
        <View className="flex-1">
          <BottomSheetInput
            testID="edit-transaction-amount"
            className="border-0 bg-transparent px-0 py-1 text-3xl font-bold"
            accessibilityLabel="Сумма"
            keyboardType="decimal-pad"
            placeholder="0"
            value={groupAmountInput(field.value)}
            onChangeText={(text) =>
              setValue('amount', sanitizeAmountInput(text), { shouldValidate: true })
            }
            invalid={Boolean(fieldState.error)}
          />
        </View>
        {currency ? (
          <Text variant="h3" className="text-muted-foreground" testID="edit-transaction-currency">
            {currencySymbol(currency)}
          </Text>
        ) : null}
      </View>
      <FormError testID="edit-transaction-amount-error">{fieldState.error?.message}</FormError>
    </View>
  )
}
