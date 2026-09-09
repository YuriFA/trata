// Create-account form: name and the opening balance entered in MAJOR units
// and converted to integer minor units via the shared money helpers in
// `toAccountPayload` (never float arithmetic on stored values; the single
// x100 rounding happens at the boundary). The app is ruble-only (openspec
// app-currency): no currency picker - the mapper always submits RUB.

import { zodResolver } from '@hookform/resolvers/zod'
import { Controller, useForm } from 'react-hook-form'
import { View } from 'react-native'
import type { CreateAccountPayload } from '@trata/api'
import { BottomSheetInput } from '@/shared/ui/bottom-sheet'
import { Button } from '@/shared/ui/button'
import { FormError, FormField, FormLabel } from '@/shared/ui/form'
import { getRepositoryErrorText } from '@/shared/lib/data/repository-errors-ru'
import { parseMajorUnitsToMinor } from '@/shared/lib/money/parse'
import { useCreateAccount } from '@/entities/account'
import { newAccountSchema, type NewAccountFormValues } from '../model/schema'

const defaultValues: NewAccountFormValues = {
  name: '',
  openingBalance: '',
}

function toAccountPayload(values: NewAccountFormValues): CreateAccountPayload {
  return {
    name: values.name,
    // Ruble-only app (openspec app-currency); the API enum stays wider.
    currency: 'RUB',
    // The schema's refine guarantees parseability; the fallback only
    // satisfies the parser's `number | null` return type.
    openingBalance: parseMajorUnitsToMinor(values.openingBalance) ?? 0,
  }
}

interface NewAccountFormProps {
  onSuccess: () => void
}

export function NewAccountForm({ onSuccess }: NewAccountFormProps) {
  const form = useForm<NewAccountFormValues>({
    resolver: zodResolver(newAccountSchema),
    defaultValues,
  })
  const createAccount = useCreateAccount()

  const handleSubmit = async (values: NewAccountFormValues) => {
    try {
      await createAccount.mutateAsync(toAccountPayload(values))
      form.reset(defaultValues)
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
    </View>
  )
}
