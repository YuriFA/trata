import { useEffect, useRef } from 'react'
import { useController, useFormContext, useWatch } from 'react-hook-form'
import { View } from 'react-native'
import { convert, currencySymbol, type CurrencyRates } from '@trata/money'
import { useAccounts } from '@/entities/account'
import { FormError, FormLabel } from '@/shared/ui/form'
import { Text } from '@/shared/ui/text'
import { BottomSheetInput } from '@/shared/ui/bottom-sheet'
import { useRates } from '@/shared/lib/db/rates'
import { groupAmountInput, minorToInputValue } from '@/shared/lib/money/display'
import { parseMajorUnitsToMinor, sanitizeAmountInput } from '@/shared/lib/money/parse'
import type { CreateTransactionFormValues } from '../model/schema'

/** "1.2345" -> "1,2345": display-grade rate with trailing zeros trimmed. */
function formatRate(rate: number): string {
  return rate.toFixed(4).replace(/0+$/, '').replace(/\.$/, '').replace('.', ',')
}

/** RU conversion hint from the cached snapshot: "Курс: 1 USD ≈ 90,5 RUB". */
function conversionHint(from: string, to: string, rates: CurrencyRates): string | null {
  const fromRate = rates.rates[from]
  const toRate = rates.rates[to]
  if (fromRate === undefined || toRate === undefined || fromRate === 0) return null
  return `Курс: 1 ${from} \u2248 ${formatRate(toRate / fromRate)} ${to}`
}

/**
 * The cross-currency transfer's destination amount (multi-currency 6.3):
 * shown only when the two accounts' currencies differ; the cached rate
 * SUGGESTS the figure from the entered source amount while the user has not
 * typed one, and the entered value stays authoritative and editable. A
 * missing cached rate leaves the field empty - the user enters the figure,
 * otherwise the schema blocks the submit (the backend would reject it too).
 */
export function DestinationAmountField() {
  const { control, getValues, setValue } = useFormContext<CreateTransactionFormValues>()
  const { field, fieldState } = useController({ name: 'destinationAmount', control })
  const crossCurrency = useWatch({ control, name: 'crossCurrency' })
  const sourceAmount = useWatch({ control, name: 'amount' })
  const fromId = useWatch({ control, name: 'fromAccountId' })
  const toId = useWatch({ control, name: 'toAccountId' })
  const accounts = useAccounts().data ?? []
  const rates = useRates().data ?? null

  const from = accounts.find((account) => account.id === fromId)
  const to = accounts.find((account) => account.id === toId)
  // Switching either account discards the figure (and the touched mark): the
  // suggestion restarts for the new pair. Typing sets the mark and stops the
  // auto-suggestion until the next account switch.
  const touchedRef = useRef(false)
  useEffect(() => {
    touchedRef.current = false
    setValue('destinationAmount', '', { shouldValidate: true })
  }, [fromId, toId, setValue])

  useEffect(() => {
    if (!crossCurrency || touchedRef.current || !from || !to || !rates) return
    const sourceMinor = parseMajorUnitsToMinor(sourceAmount)
    if (sourceMinor === null || sourceMinor < 1) return
    const converted = convert(sourceMinor, from.currency, to.currency, rates)
    if (converted === null || converted < 1) return
    if (getValues('destinationAmount') === '') {
      setValue('destinationAmount', minorToInputValue(converted), { shouldValidate: true })
    }
  }, [crossCurrency, sourceAmount, from, to, rates, getValues, setValue])

  if (!crossCurrency) return null

  return (
    <View className="gap-1">
      <FormLabel>Сумма зачисления</FormLabel>
      <View className="flex-row items-center gap-3 rounded-2xl bg-secondary px-4 py-3">
        <View className="flex-1">
          <BottomSheetInput
            testID="new-transaction-destination-amount"
            className="border-0 bg-transparent px-0 py-1 text-3xl font-bold"
            accessibilityLabel="Сумма зачисления"
            keyboardType="decimal-pad"
            placeholder="0"
            value={groupAmountInput(field.value ?? '')}
            onChangeText={(text) => {
              touchedRef.current = true
              field.onChange(sanitizeAmountInput(text))
            }}
            invalid={Boolean(fieldState.error)}
          />
        </View>
        {to ? (
          <Text
            variant="h3"
            className="text-muted-foreground"
            testID="new-transaction-destination-currency"
          >
            {currencySymbol(to.currency)}
          </Text>
        ) : null}
      </View>
      {from && to && rates ? (
        <Text
          variant="caption"
          className="text-muted-foreground"
          testID="new-transaction-conversion-hint"
        >
          {conversionHint(from.currency, to.currency, rates)}
        </Text>
      ) : null}
      <FormError testID="new-transaction-destination-amount-error">
        {fieldState.error?.message}
      </FormError>
    </View>
  )
}
