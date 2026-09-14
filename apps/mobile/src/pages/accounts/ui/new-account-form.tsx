// Create-account form: name, currency, and the opening balance entered in
// MAJOR units and converted to integer minor units via the shared money
// helpers in `toAccountPayload` (never float arithmetic on stored values; the
// single x100 rounding happens at the boundary). Multi-currency (app-currency
// 6.2): the picker offers the full catalog, preselecting the display
// currency's chain default (household base) - the chosen currency is
// submitted with the created account.

import { useRef } from 'react'
import { Pressable, View } from 'react-native'
import { zodResolver } from '@hookform/resolvers/zod'
import { Controller, useForm } from 'react-hook-form'
import { currencySymbol } from '@trata/money'
import { BottomSheetInput, BottomSheetRef } from '@/shared/ui/bottom-sheet'
import { SheetContentPortal } from '@/shared/ui/sheet-content-portal'
import type { CreateAccountPayload } from '@trata/api'
import { Button } from '@/shared/ui/button'
import { FormError, FormField, FormLabel } from '@/shared/ui/form'
import { getRepositoryErrorText } from '@/shared/lib/data/repository-errors-ru'
import { parseMajorUnitsToMinor } from '@/shared/lib/money/parse'
import { CurrencyPickerSheet } from '@/shared/ui/currency-picker-sheet'
import { Text } from '@/shared/ui/text'
import { useCreateAccount } from '@/entities/account'
import { useDisplayCurrency } from '@/entities/household'
import { newAccountSchema, type NewAccountFormValues } from '../model/schema'

function toAccountPayload(values: NewAccountFormValues): CreateAccountPayload {
  return {
    name: values.name,
    // The chosen catalog currency (the ruble-only submit mapper is gone).
    currency: values.currency,
    // The schema's refine guarantees parseability; the fallback only
    // satisfies the parser's `number | null` return type.
    openingBalance: parseMajorUnitsToMinor(values.openingBalance) ?? 0,
  }
}

interface NewAccountFormProps {
  onSuccess: () => void
}

export function NewAccountForm({ onSuccess }: NewAccountFormProps) {
  // The picker's preselect follows the display-currency chain (explicit
  // preference, then household base, then RUB) - the household base is the
  // spec's preselect for a fresh device.
  const defaultCurrency = useDisplayCurrency()
  const form = useForm<NewAccountFormValues>({
    resolver: zodResolver(newAccountSchema),
    defaultValues: {
      name: '',
      currency: defaultCurrency,
      openingBalance: '',
    },
  })
  const createAccount = useCreateAccount()
  const currencyPickerRef = useRef<BottomSheetRef>(null)
  const selectedCurrency = form.watch('currency')

  const handleSubmit = async (values: NewAccountFormValues) => {
    try {
      await createAccount.mutateAsync(toAccountPayload(values))
      form.reset({ name: '', currency: defaultCurrency, openingBalance: '' })
      onSuccess()
    } catch (cause) {
      form.setError('root', { message: getRepositoryErrorText(cause) })
    }
  }

  return (
    <View className="gap-4">
      <Controller
        control={form.control}
        name="name"
        render={({ field, fieldState }) => (
          <FormField>
            <FormLabel className={fieldState.error ? 'text-destructive' : undefined}>
              Название
            </FormLabel>
            <BottomSheetInput
              placeholder="Например, Карта"
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              invalid={Boolean(fieldState.error)}
              testID="accounts-create-name"
            />
            <FormError testID="accounts-create-name-error">{fieldState.error?.message}</FormError>
          </FormField>
        )}
      />

      <FormField>
        <FormLabel>Валюта</FormLabel>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Валюта счёта"
          className="flex-row items-center justify-between rounded-2xl bg-secondary px-4 py-3 active:opacity-70"
          onPress={() => currencyPickerRef.current?.present()}
          testID="accounts-create-currency"
        >
          <Text variant="body" className="text-foreground">
            {selectedCurrency}
          </Text>
          <Text variant="body" className="text-muted-foreground">
            {currencySymbol(selectedCurrency)}
          </Text>
        </Pressable>
        <FormError testID="accounts-create-currency-error">
          {form.formState.errors.currency?.message}
        </FormError>
      </FormField>

      <Controller
        control={form.control}
        name="openingBalance"
        render={({ field, fieldState }) => (
          <FormField>
            <FormLabel className={fieldState.error ? 'text-destructive' : undefined}>
              Начальный баланс
            </FormLabel>
            <BottomSheetInput
              placeholder="0,00"
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              keyboardType="decimal-pad"
              invalid={Boolean(fieldState.error)}
              testID="accounts-create-opening-balance"
            />
            <FormError testID="accounts-create-opening-balance-error">
              {fieldState.error?.message}
            </FormError>
          </FormField>
        )}
      />

      <FormError testID="accounts-create-error">{form.formState.errors.root?.message}</FormError>

      <Button
        variant="primary"
        text="Создать"
        loading={form.formState.isSubmitting || createAccount.isPending}
        disabled={createAccount.isPending}
        onPress={form.handleSubmit(handleSubmit)}
        testID="accounts-create-submit"
      />

      <SheetContentPortal>
        <CurrencyPickerSheet
          ref={currencyPickerRef}
          title="Валюта счёта"
          selectedCode={selectedCurrency ?? ''}
          onSelect={(code) => {
            void form.setValue('currency', code as NewAccountFormValues['currency'], {
              shouldValidate: true,
            })
          }}
          testIDPrefix="accounts-create-currency"
        />
      </SheetContentPortal>
    </View>
  )
}
