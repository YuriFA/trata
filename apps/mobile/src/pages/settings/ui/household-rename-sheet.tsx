// Household rename sheet (household-ux 2.2, owner only): one name field
// preloaded with the current display name; an emptied submission clears it
// (PATCH `name: null`). Mirrors the join-by-code sheet (forms.md §1/§3).
//
// TODO(i18n): RU wording until mobile i18n wiring lands.

import { useRef, useState } from 'react'
import { View } from 'react-native'
import { zodResolver } from '@hookform/resolvers/zod'
import { Controller, useForm } from 'react-hook-form'
import type { Household } from '@trata/api'
import { useHouseholdActions } from '@/entities/household'
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
import { householdNameSchema, type HouseholdNameFormValues } from '../model/schema'

export interface HouseholdRenameSheetProps {
  household: Household
  onClose: () => void
}

export function HouseholdRenameSheet({ household, onClose }: HouseholdRenameSheetProps) {
  // Mounted per open with a fresh key; presentOnMount presents it (forms.md §3).
  const sheetRef = useRef<BottomSheetRef>(null)

  return (
    <BottomSheet
      ref={sheetRef}
      presentOnMount
      testID="settings-household-rename-sheet"
      snapPoints={['40%']}
      stackBehavior="push"
      onDismiss={onClose}
    >
      <BottomSheetView testID="settings-household-rename-sheet">
        <BottomSheetBody>
          <RenameForm sheetRef={sheetRef} initialName={household.name ?? ''} onRenamed={onClose} />
        </BottomSheetBody>
      </BottomSheetView>
    </BottomSheet>
  )
}

function RenameForm({
  sheetRef,
  initialName,
  onRenamed,
}: {
  sheetRef: React.Ref<BottomSheetRef>
  initialName: string
  onRenamed: () => void
}) {
  const form = useForm<HouseholdNameFormValues>({
    resolver: zodResolver(householdNameSchema),
    defaultValues: { name: initialName },
    mode: 'onChange',
  })
  const actions = useHouseholdActions()
  const [isRenaming, setIsRenaming] = useState(false)

  const dismiss = () => {
    // TODO(sheet-dismiss): see the matching TODO in join-by-code-sheet.tsx.
    if (sheetRef && typeof sheetRef !== 'function') sheetRef.current?.dismiss()
  }

  const handleSubmit = async (values: HouseholdNameFormValues) => {
    setIsRenaming(true)
    try {
      // Empty (after trim) clears the name; otherwise sets it (1-100 chars).
      await actions.rename.mutateAsync(values.name.trim() || null)
      dismiss()
      onRenamed()
    } catch (cause) {
      form.setError('root', { message: getRepositoryErrorText(cause) })
      setIsRenaming(false)
    }
  }

  return (
    <View className="gap-4">
      <BottomSheetHeader title="Название домохозяйства" />

      <Controller
        control={form.control}
        name="name"
        render={({ field, fieldState }) => (
          <FormField>
            <FormLabel className={fieldState.error ? 'text-destructive' : undefined}>
              Название
            </FormLabel>
            <BottomSheetInput
              testID="settings-household-rename-input"
              placeholder="Например, Семья"
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              autoCapitalize="sentences"
              maxLength={100}
              invalid={Boolean(fieldState.error)}
            />
            <FormError testID="settings-household-rename-error">
              {fieldState.error?.message}
            </FormError>
          </FormField>
        )}
      />

      <FormError testID="settings-household-rename-form-error">
        {form.formState.errors.root?.message}
      </FormError>

      <Button
        variant="primary"
        text="Сохранить"
        loading={isRenaming || form.formState.isSubmitting}
        disabled={isRenaming}
        onPress={form.handleSubmit(handleSubmit)}
        testID="settings-household-rename-submit"
      />
    </View>
  )
}
