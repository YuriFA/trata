// Debtor rename sheet (simplify-debt-domain): the debtor is rename-only -
// a single name field replaces the old contact edit form, and deletion lives
// in the debtor history header. The sheet mounts WITH its subject and
// presents itself (forms.md §3); a re-tap can swap the debtor under the
// living form, so prefill is an explicit reset. Rename conflicts surface
// through the shared code-keyed error mapping (repository-errors-ru);
// CAS `version` rides along on the update. A no-op submit (same or empty
// name) never reaches the API.

import { useEffect, useMemo } from 'react'
import { View } from 'react-native'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  Controller,
  FormProvider,
  useForm,
  useFormContext,
  useFormState,
  useWatch,
} from 'react-hook-form'
import type { Debtor } from '@trata/api'
import { useUpdateDebtor } from '@/entities/debt'
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
import { debtorSchema, type DebtorFormValues } from '../model/schema'

// TODO(i18n): RU wording until mobile i18n wiring lands
// (debts.renameDebtorTitle / namePlaceholder / save / cancel).
const RENAME_TITLE = 'Переименовать должника'

export interface DebtorRenameSheetProps {
  ref: React.Ref<BottomSheetRef>
  /** The debtor being renamed; the sheet mounts with its subject. */
  debtor: Debtor
}

export function DebtorRenameSheet({ ref, debtor }: DebtorRenameSheetProps) {
  return (
    <BottomSheet
      ref={ref}
      presentOnMount
      testID="debts-rename-debtor-sheet"
      snapPoints={['45%']}
      stackBehavior="push"
    >
      {/* The visible element carrying the sheet testID (accounts-sheet
          pattern): the modal container itself is zero-bounds to Maestro. */}
      <BottomSheetView testID="debts-rename-debtor-sheet">
        <BottomSheetBody>
          <DebtorRenameForm debtor={debtor} sheetRef={ref} />
        </BottomSheetBody>
      </BottomSheetView>
    </BottomSheet>
  )
}

/**
 * The submit button, isolated: it alone subscribes to form validity and the
 * name - a no-op (same name) keeps it disabled, so no update is ever sent.
 */
function DebtorRenameSubmitField({
  debtor,
  pending,
  onSubmit,
}: {
  debtor: Debtor
  pending: boolean
  onSubmit: () => void
}) {
  const { control } = useFormContext<DebtorFormValues>()
  const { isValid, isSubmitting } = useFormState({ control })
  const name = useWatch({ control, name: 'name' }) ?? ''
  const noOp = name.trim() === debtor.name

  return (
    <Button
      variant="primary"
      text="Сохранить"
      testID="debts-rename-submit"
      className="flex-1"
      loading={pending || isSubmitting}
      disabled={!isValid || noOp || pending || isSubmitting}
      onPress={onSubmit}
    />
  )
}

export function DebtorRenameForm({
  debtor,
  sheetRef,
}: {
  debtor: Debtor
  sheetRef: React.Ref<BottomSheetRef>
}) {
  const defaults = useMemo<DebtorFormValues>(() => ({ name: debtor.name }), [debtor])

  const form = useForm<DebtorFormValues>({
    resolver: zodResolver(debtorSchema),
    defaultValues: defaults,
    mode: 'onChange',
  })
  const updateDebtor = useUpdateDebtor()

  // The host stays mounted while renamingDebtor is set (a re-tap can swap
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
    // The disabled submit is the no-op gate; this guard keeps a racing
    // submit (e.g. keyboard return key) from reaching the API either.
    if (values.name === debtor.name) return
    try {
      await updateDebtor.mutateAsync({
        id: debtor.id,
        payload: { name: values.name, version: debtor.version },
      })
      dismiss()
    } catch (cause) {
      form.setError('root', { message: getRepositoryErrorText(cause) })
    }
  }

  return (
    <FormProvider {...form}>
      <View className="gap-4">
        <BottomSheetHeader title={RENAME_TITLE} />

        <Controller
          control={form.control}
          name="name"
          render={({ field, fieldState }) => (
            <FormField>
              <FormLabel className={fieldState.error ? 'text-destructive' : undefined}>
                Имя
              </FormLabel>
              <BottomSheetInput
                testID="debts-rename-name"
                placeholder="Имя"
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                invalid={Boolean(fieldState.error)}
              />
              <FormError testID="debts-rename-name-error">{fieldState.error?.message}</FormError>
            </FormField>
          )}
        />

        <FormError testID="debts-rename-error">{form.formState.errors.root?.message}</FormError>

        <View className="flex-row gap-3">
          <Button
            variant="outline"
            text="Отмена"
            testID="debts-rename-cancel"
            className="flex-1"
            disabled={updateDebtor.isPending}
            onPress={dismiss}
          />
          <DebtorRenameSubmitField
            debtor={debtor}
            pending={updateDebtor.isPending}
            onSubmit={form.handleSubmit(handleSubmit)}
          />
        </View>
      </View>
    </FormProvider>
  )
}
