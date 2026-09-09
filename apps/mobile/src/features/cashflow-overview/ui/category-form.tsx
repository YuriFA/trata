// Category form: name, type toggle, and the type-filtered icon picker from
// the unified emoji set. The color is never picked: it is the icon's
// pre-paired color (displaced to the nearest free one when another
// category already holds it). Create mode writes through
// `useCreateCategory`; edit mode (a `category` prop) prefills from the
// record and writes through `useUpdateCategory`, sending the record's
// version as the CAS token.

import { zodResolver } from '@hookform/resolvers/zod'
import { Controller, useForm } from 'react-hook-form'
import { Pressable, View } from 'react-native'
import type { Category, CategoryType } from '@trata/api'
import { BottomSheetInput } from '@/shared/ui/bottom-sheet'
import { Button } from '@/shared/ui/button'
import { FormError, FormField, FormLabel } from '@/shared/ui/form'
import { Text } from '@/shared/ui/text'
import { cn } from '@/shared/lib/utils'
import { getRepositoryErrorText } from '@/shared/lib/data/repository-errors-ru'
import {
  categoryIconsForType,
  defaultCategoryIcon,
  pickCategoryColor,
  useCategoriesIncludingArchived,
  useCreateCategory,
  useUpdateCategory,
} from '@/entities/category'
import {
  newCategoryDefaultValues,
  newCategorySchema,
  type NewCategoryFormValues,
} from '../model/schema'

interface CategoryFormProps {
  /** The record to edit; omit for the create flow. */
  category?: Category
  /** Optional container hook; the create sheet stays open on success. */
  onSuccess?: () => void
  /** Initial type for the create flow (the toggle stays user-editable). */
  defaultType?: CategoryType
  /** testID stem for the create flow's fields; edit always uses `category-edit`. */
  createTestID?: string
}

function categoryInitialValues(
  category: Category | undefined,
  defaultType: CategoryType | undefined,
): NewCategoryFormValues {
  if (!category)
    return { ...newCategoryDefaultValues, type: defaultType ?? newCategoryDefaultValues.type }
  // A stored icon outside the current set stays as-is: it renders, simply
  // without a selected tile, and survives the save unless the user picks one.
  return { name: category.name, type: category.type, icon: category.icon }
}

export function CategoryForm({
  category,
  onSuccess,
  defaultType,
  createTestID,
}: CategoryFormProps) {
  const isEdit = category !== undefined
  // testIDs stay stable per mode: the create and edit sheets can both be
  // mounted on one screen, so each mode needs its own unique prefix.
  const id = isEdit ? 'category-edit' : (createTestID ?? 'home-new-category')
  const createDefaults = categoryInitialValues(undefined, defaultType)

  const form = useForm<NewCategoryFormValues>({
    resolver: zodResolver(newCategorySchema),
    defaultValues: categoryInitialValues(category, defaultType),
  })
  const createCategory = useCreateCategory()
  const updateCategory = useUpdateCategory()
  const { data: allCategories } = useCategoriesIncludingArchived()
  const pending =
    form.formState.isSubmitting || createCategory.isPending || updateCategory.isPending

  const type = form.watch('type')
  const icon = form.watch('icon')
  const iconOptions = categoryIconsForType(type)

  const handleSubmit = async (values: NewCategoryFormValues) => {
    // Colors taken by OTHER categories (archived included - they still
    // render in charts) displace to the nearest free palette color.
    const takenColors = (allCategories ?? [])
      .filter((candidate) => candidate.id !== category?.id)
      .map((candidate) => candidate.color)
    const color = pickCategoryColor(values.icon, takenColors)

    try {
      if (isEdit && category) {
        await updateCategory.mutateAsync({
          id: category.id,
          payload: { ...values, color, version: category.version },
        })
      } else {
        await createCategory.mutateAsync({ ...values, color })
        form.reset(createDefaults)
      }
      onSuccess?.()
    } catch (cause) {
      form.setError('root', { message: getRepositoryErrorText(cause) })
    }
  }

  const selectType = (next: CategoryType, onChange: (type: CategoryType) => void) => {
    onChange(next)
    // The icon vocabulary follows the type: an icon not offered for the
    // new type falls back to that type's default.
    if (!categoryIconsForType(next).some((option) => option.icon === icon)) {
      form.setValue('icon', defaultCategoryIcon(next), { shouldDirty: true })
    }
  }

  return (
    <View className="gap-4 pb-safe">
      <Controller
        control={form.control}
        name="name"
        render={({ field, fieldState }) => (
          <FormField>
            <FormLabel className={fieldState.error ? 'text-destructive' : undefined}>
              Название
            </FormLabel>
            <BottomSheetInput
              placeholder="Например, Транспорт"
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              invalid={Boolean(fieldState.error)}
              testID={`${id}-name`}
            />
            <FormError testID={`${id}-name-error`}>{fieldState.error?.message}</FormError>
          </FormField>
        )}
      />

      <Controller
        control={form.control}
        name="type"
        render={({ field }) => (
          <View className="flex-row gap-2">
            <Button
              variant={field.value === 'expense' ? 'primary' : 'outline'}
              text="Расход"
              className="flex-1"
              onPress={() => selectType('expense', field.onChange)}
              testID={`${id}-type-expense`}
            />
            <Button
              variant={field.value === 'income' ? 'primary' : 'outline'}
              text="Доход"
              className="flex-1"
              onPress={() => selectType('income', field.onChange)}
              testID={`${id}-type-income`}
            />
          </View>
        )}
      />

      <Controller
        control={form.control}
        name="icon"
        render={({ field }) => (
          <View className="gap-2">
            <Text variant="label">Иконка</Text>
            <View className="flex-row flex-wrap gap-2" testID={`${id}-icons`}>
              {iconOptions.map((option) => (
                <Pressable
                  key={option.icon}
                  testID={`${id}-icon-${option.icon}`}
                  accessibilityRole="button"
                  accessibilityLabel={`Иконка ${option.icon}`}
                  accessibilityState={{ selected: field.value === option.icon }}
                  className={cn(
                    'h-11 w-11 items-center justify-center rounded-full border-2',
                    field.value === option.icon ? 'border-primary' : 'border-transparent',
                  )}
                  style={{ backgroundColor: `${option.color}26` }}
                  onPress={() => field.onChange(option.icon)}
                >
                  <Text style={{ fontSize: 20 }}>{option.icon}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}
      />

      <FormError testID={`${id}-error`}>{form.formState.errors.root?.message}</FormError>

      <Button
        testID={`${id}-submit`}
        className="my-8"
        variant="primary"
        text={isEdit ? 'Сохранить' : 'Создать'}
        loading={pending}
        disabled={pending}
        onPress={form.handleSubmit(handleSubmit)}
      />
    </View>
  )
}
