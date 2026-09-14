// Combined contact+debt creation sheet (design D9): ONE submit creates a
// debtor and their initial debt in the section's direction. The direction is
// structural context (a prop from the tapped section, never a form value);
// the copy is direction-aware («Кто должен» / «Кому должен»). The amount
// stays a digit string in form values; the named mapper converts to int64
// minor units exactly once at the submission boundary (forms.md §2/§4).
//
// The page mounts a fresh instance per open (a keyed session) and the sheet
// self-presents - the edit-sheet pattern - so every open starts from clean
// values without a mounted-sheet reset dance (forms.md §3).
//
// A submit that created the contact but failed to create the operation
// keeps the created debtor id: a retry records the operation for that
// contact instead of colliding with its own duplicate name.

import { useRef } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { Controller, FormProvider, useForm } from 'react-hook-form'
import { View } from 'react-native'
import type { DebtDirection, DebtOperationRepository } from '@trata/api'
import { AmountKeypad, applyKeypadInput, type KeypadKey } from '@/features/create-transaction'
import { useCreateDebtor, useCreateDebtOperation } from '@/entities/debt'
import { useAuth } from '@/entities/session'
import { useHousehold } from '@/entities/household'
import { getRepositoryErrorText } from '@/shared/lib/data/repository-errors-ru'
import { parseMajorUnitsToMinor } from '@/shared/lib/money/parse'
import {
  BottomSheet,
  BottomSheetHeader,
  BottomSheetInput,
  BottomSheetView,
  type BottomSheetRef,
} from '@/shared/ui/bottom-sheet'
import { useSheetContentPickers } from '@/shared/ui/sheet-content-portal'
import { FormError } from '@/shared/ui/form'
import { Text } from '@/shared/ui/text'
import { DEBT_DIRECTION_VIEWS } from '../model/kind'
import {
  debtorDebtDefaultValues,
  debtorDebtSchema,
  type DebtorDebtFormValues,
} from '../model/schema'
import { DebtsFormActions } from './form-actions'

export interface NewDebtorDebtSheetProps {
  /** The tapped section's direction - fixes the debt's direction and the copy. */
  direction: DebtDirection
}

export function NewDebtorDebtSheet({ direction }: NewDebtorDebtSheetProps) {
  // Mounted per open with a fresh key; presentOnMount presents it
  // (forms.md §3). The ref is handed to the form for its dismissal.
  const sheetRef = useRef<BottomSheetRef>(null)

  // The date picker declared inside the form re-renders beside this sheet
  // element (outside its portal content) — see useSheetContentPickers.
  const pickers = useSheetContentPickers()

  return (
    <>
      {pickers.nodes}
      <BottomSheet
        ref={sheetRef}
        presentOnMount
        testID="debts-new-debt-sheet"
        snapPoints={['70%']}
        stackBehavior="push"
      >
        {/* The visible element carrying the sheet testID (accounts-sheet
            pattern): the modal container is zero-bounds to Maestro. */}
        <BottomSheetView testID="debts-new-debt-sheet" className="flex-1">
          <pickers.Provider>
            <NewDebtorDebtForm direction={direction} sheetRef={sheetRef} />
          </pickers.Provider>
        </BottomSheetView>
      </BottomSheet>
    </>
  )
}

function toCreatePayload(
  values: DebtorDebtFormValues,
  debtorId: string,
  direction: DebtDirection,
): Parameters<DebtOperationRepository['create']>[0] {
  return {
    debtorId,
    direction,
    kind: 'debt',
    // The schema's refine guarantees parseability; the fallback only
    // satisfies the parser's `number | null` return type.
    amount: parseMajorUnitsToMinor(values.amount) ?? 0,
    note: values.note.trim(),
    occurredAt: values.occurredAt,
  }
}

/** The keypad-driven amount display with its validation error. */
function AmountField() {
  return (
    <Controller
      name="amount"
      render={({ field, fieldState }) => (
        <View className="gap-1 pt-2">
          <Text variant="h1" className="text-center text-foreground" testID="debts-new-debt-amount">
            {field.value ? field.value.replace('.', ',') : '0'}
          </Text>
          <FormError testID="debts-new-debt-amount-error">{fieldState.error?.message}</FormError>
        </View>
      )}
    />
  )
}

export function NewDebtorDebtForm({
  direction,
  sheetRef,
}: {
  direction: DebtDirection
  sheetRef: React.Ref<BottomSheetRef>
}) {
  const view = DEBT_DIRECTION_VIEWS[direction]

  const form = useForm<DebtorDebtFormValues>({
    resolver: zodResolver(debtorDebtSchema),
    defaultValues: debtorDebtDefaultValues(),
    mode: 'onChange',
  })
  const createDebtor = useCreateDebtor()
  const createDebtOperation = useCreateDebtOperation()
  // The debtor's immutable ledger currency defaults to the household's base
  // currency - sent EXPLICITLY: the repository's RUB backstop is wrong for
  // any non-RUB household (debts capability, design D7).
  const { status } = useAuth()
  const householdQuery = useHousehold({ enabled: status === 'authenticated' })
  const baseCurrency = householdQuery.data?.currency
  const pending = createDebtor.isPending || createDebtOperation.isPending

  // Set when the contact was created but the operation failed; a retry
  // reuses it instead of re-creating (and colliding with) the contact.
  const createdDebtorIdRef = useRef<string | null>(null)

  const dismiss = () => {
    // TODO(sheet-dismiss): see the matching TODO in
    // features/cashflow-overview/ui/edit-category-sheet.tsx.
    if (sheetRef && typeof sheetRef !== 'function') sheetRef.current?.dismiss()
  }

  const handleAmountKey = (key: KeypadKey) => {
    form.setValue('amount', applyKeypadInput(form.getValues('amount'), key), {
      shouldValidate: true,
    })
  }

  const handleSubmit = async (values: DebtorDebtFormValues) => {
    try {
      if (!createdDebtorIdRef.current) {
        const debtor = await createDebtor.mutateAsync({
          name: values.name,
          ...(baseCurrency !== undefined ? { currency: baseCurrency } : {}),
        })
        createdDebtorIdRef.current = debtor.id
      }
      await createDebtOperation.mutateAsync(
        toCreatePayload(values, createdDebtorIdRef.current, direction),
      )
      createdDebtorIdRef.current = null
      form.reset(debtorDebtDefaultValues())
      dismiss()
    } catch (cause) {
      form.setError('root', { message: getRepositoryErrorText(cause) })
    }
  }

  return (
    <FormProvider {...form}>
      <View className="flex-1">
        <BottomSheetHeader title={view.sheetTitle} subtitle={view.summaryLabel} />

        <View className="flex-1 gap-3 px-4">
          <Controller
            name="name"
            render={({ field, fieldState }) => (
              <View className="gap-1">
                <BottomSheetInput
                  testID="debts-new-debt-name"
                  placeholder="Имя"
                  value={field.value}
                  onChangeText={field.onChange}
                  onBlur={field.onBlur}
                  invalid={Boolean(fieldState.error)}
                />
                <FormError testID="debts-new-debt-name-error">
                  {fieldState.error?.message}
                </FormError>
              </View>
            )}
          />

          <AmountField />

          <FormError testID="debts-new-debt-error">{form.formState.errors.root?.message}</FormError>

          <DebtsFormActions
            testIDPrefix="debts-new-debt"
            pending={pending}
            onSubmit={form.handleSubmit(handleSubmit)}
            submitAccessibilityLabel="Добавить долг"
          />
        </View>

        <AmountKeypad onKey={handleAmountKey} testIDPrefix="debts-new-debt" />
      </View>
    </FormProvider>
  )
}
