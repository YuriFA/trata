// Debtor edit form + sheet (conventions forms.md §1/§3): name and note,
// delete with a confirm alert. Rename conflicts surface through the shared
// code-keyed error mapping (repository-errors-ru), CAS `version` on update.
// Creation lives in the combined contact+debt sheet (design D9) - this form
// is edit-only.

import { useEffect, useMemo } from 'react'
import { Alert, View } from 'react-native'
import { zodResolver } from '@hookform/resolvers/zod'
import { Controller, FormProvider, useForm, useFormContext, useFormState } from 'react-hook-form'
import type { Debtor } from '@trata/api'
import { useDeleteDebtor, useUpdateDebtor } from '@/entities/debt'
import { getRepositoryErrorText } from '@/shared/lib/data/repository-errors-ru'
import {
  BottomSheet,
  BottomSheetBody,
  BottomSheetHeader,
  BottomSheetInput,
  BottomSheetView,
  type BottomSheetRef,
} from '@/shared/ui/bottom-sheet'
import { Button } from '@/shared/ui/button'
import { FormError, FormField, FormLabel } from '@/shared/ui/form'
import { IconButton } from '@/shared/ui/icon-button'
import { DEBTS_CONTACT_NOUN } from '../model/kind'
import { debtorSchema, type DebtorFormValues } from '../model/schema'

export interface DebtorFormSheetProps {
  ref: React.Ref<BottomSheetRef>
  /** The debtor being edited; the sheet mounts with its subject (edit-only). */
  debtor: Debtor
}

export function DebtorFormSheet({ ref, debtor }: DebtorFormSheetProps) {
  // Mounts WITH its subject; presentOnMount presents it (forms.md §3). While
  // the subject stays set, the page's imperative present() is the reopen
  // path. The ref is handed to the form for its dismissal.

  return (
    <BottomSheet
      ref={ref}
      presentOnMount
      testID="debts-edit-debtor-sheet"
      snapPoints={['55%']}
      stackBehavior="push"
    >
      {/* The visible element carrying the sheet testID (accounts-sheet
          pattern): the modal container itself is zero-bounds to Maestro. */}
      <BottomSheetView testID="debts-edit-debtor-sheet">
        <BottomSheetBody>
          <DebtorForm debtor={debtor} sheetRef={ref} />
        </BottomSheetBody>
      </BottomSheetView>
    </BottomSheet>
  )
}

// The header renders inside the form (the edit-transaction layout): the
// title and the delete affordance on the right.

/** The submit button, isolated: it alone subscribes to form validity. */
function DebtorSubmitField({ pending, onSubmit }: { pending: boolean; onSubmit: () => void }) {
  const { control } = useFormContext<DebtorFormValues>()
  const { isValid, isSubmitting } = useFormState({ control })
  const blocked = pending || isSubmitting

  return (
    <Button
      variant="primary"
      text="Сохранить"
      testID="debts-debtor-submit"
      loading={blocked}
      disabled={!isValid || blocked}
      onPress={onSubmit}
    />
  )
}

export function DebtorForm({
  debtor,
  sheetRef,
}: {
  debtor: Debtor
  sheetRef: React.Ref<BottomSheetRef>
}) {
  const defaults = useMemo<DebtorFormValues>(
    () => ({ name: debtor.name, note: debtor.note }),
    [debtor],
  )

  const form = useForm<DebtorFormValues>({
    resolver: zodResolver(debtorSchema),
    defaultValues: defaults,
    mode: 'onChange',
  })
  const updateDebtor = useUpdateDebtor()
  const deleteDebtor = useDeleteDebtor()
  const pending = updateDebtor.isPending || deleteDebtor.isPending

  // The host stays mounted while editingDebtor is set (a re-tap can swap
  // the debtor object under a living form), so prefill is an explicit
  // reset (forms.md §3); trigger() recomputes validity for the fresh
  // defaults.
  useEffect(() => {
    form.reset(defaults)
    void form.trigger()
  }, [defaults, form])

  const dismiss = () => {
    // TODO(sheet-dismiss): see the matching TODO in
    // features/cashflow-overview/ui/edit-category-sheet.tsx.
    if (sheetRef && typeof sheetRef !== 'function') sheetRef.current?.dismiss()
  }

  const handleSubmit = async (values: DebtorFormValues) => {
    try {
      await updateDebtor.mutateAsync({
        id: debtor.id,
        // The form always carries the full note state: an untouched value
        // re-sends the same string, an emptied field clears it (D3).
        payload: { name: values.name, note: values.note, version: debtor.version },
      })
      dismiss()
    } catch (cause) {
      form.setError('root', { message: getRepositoryErrorText(cause) })
    }
  }

  const handleDeleteConfirm = async () => {
    try {
      await deleteDebtor.mutateAsync(debtor.id)
      dismiss()
    } catch (cause) {
      form.setError('root', { message: getRepositoryErrorText(cause) })
    }
  }

  const handleDelete = () => {
    // TODO(i18n): RU wording until mobile i18n wiring lands.
    Alert.alert(`Удалить ${DEBTS_CONTACT_NOUN.toLowerCase()}?`, undefined, [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Удалить', style: 'destructive', onPress: () => void handleDeleteConfirm() },
    ])
  }

  return (
    <FormProvider {...form}>
      <View className="gap-4">
        <BottomSheetHeader
          title={DEBTS_CONTACT_NOUN}
          right={
            <IconButton
              icon="trash-outline"
              size="md"
              colorClassName="accent-destructive"
              accessibilityLabel={`Удалить ${DEBTS_CONTACT_NOUN.toLowerCase()}`}
              testID="debts-debtor-delete"
              disabled={pending}
              onPress={handleDelete}
            />
          }
        />

        <Controller
          control={form.control}
          name="name"
          render={({ field, fieldState }) => (
            <FormField>
              <FormLabel className={fieldState.error ? 'text-destructive' : undefined}>
                Имя
              </FormLabel>
              <BottomSheetInput
                testID="debts-debtor-name"
                placeholder="Имя"
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                invalid={Boolean(fieldState.error)}
              />
              <FormError testID="debts-debtor-name-error">{fieldState.error?.message}</FormError>
            </FormField>
          )}
        />

        <Controller
          control={form.control}
          name="note"
          render={({ field }) => (
            <FormField>
              <FormLabel>Заметка</FormLabel>
              <BottomSheetInput
                testID="debts-debtor-note"
                placeholder="Заметка (необязательно)"
                value={field.value}
                onChangeText={field.onChange}
              />
            </FormField>
          )}
        />

        <FormError testID="debts-debtor-error">{form.formState.errors.root?.message}</FormError>

        <DebtorSubmitField pending={pending} onSubmit={form.handleSubmit(handleSubmit)} />
      </View>
    </FormProvider>
  )
}
