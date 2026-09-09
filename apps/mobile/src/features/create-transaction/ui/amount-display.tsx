import type { CurrencyCode } from '@trata/money'
import { Text } from '@/shared/ui/text'
import { formatAmountInput } from '@/shared/lib/money/display'

/**
 * The large, read-only amount at the top of the sheet. Numeric input happens
 * exclusively through the custom keypad - there is no TextInput to focus, so
 * the system keyboard never appears for the amount.
 */
export function AmountDisplay({
  value,
  currency,
  invalid = false,
}: {
  value: string
  currency: CurrencyCode
  invalid?: boolean
}) {
  return (
    <Text
      variant="display"
      className={invalid ? 'text-destructive' : 'text-foreground'}
      adjustsFontSizeToFit
      numberOfLines={1}
      testID="new-transaction-amount"
      accessibilityLabel={`Сумма ${formatAmountInput(value, currency)}`}
    >
      {formatAmountInput(value, currency)}
    </Text>
  )
}
