import { View } from 'react-native'
import type { Category } from '@trata/api'
import { Icon } from '@/shared/ui/icon'
import { CategoryAvatar } from '@/shared/ui/category-avatar'
import { Text } from '@/shared/ui/text'
import { Pressable } from '@/shared/ui/pressable'
import {
  BottomSheet,
  BottomSheetHeader,
  BottomSheetRef,
  BottomSheetScrollView,
} from '@/shared/ui/bottom-sheet'

/**
 * Full category list presented as a sheet stacked above the transaction
 * sheet. Selecting a category reports it up (the quick bar then scrolls to
 * it) and dismisses only this sheet.
 */
export function CategoryPickerSheet({
  ref,
  categories,
  selectedId,
  onSelect,
}: {
  ref: React.Ref<BottomSheetRef>
  categories: Category[]
  selectedId: string
  onSelect: (id: string) => void
}) {
  const handleSelect = (id: string) => {
    onSelect(id)
    if (ref && typeof ref !== 'function') ref.current?.dismiss()
  }

  return (
    <BottomSheet
      ref={ref}
      snapPoints={['70%']}
      testID="new-transaction-category-picker"
      stackBehavior="push"
    >
      <BottomSheetHeader title="Категория" />
      <BottomSheetScrollView testID="new-transaction-category-picker-list">
        <View className="gap-1 px-4 pb-4">
          {categories.length === 0 ? (
            <Text variant="body-sm" className="text-muted-foreground">
              Нет категорий этого типа - создайте категорию на главном экране
            </Text>
          ) : (
            categories.map((category) => {
              const selected = category.id === selectedId
              return (
                <Pressable
                  key={category.id}
                  testID={`new-transaction-category-option-${category.id}`}
                  accessibilityRole="button"
                  accessibilityLabel={category.name}
                  accessibilityState={{ selected }}
                  className="flex-row items-center gap-3 py-3"
                  onPress={() => handleSelect(category.id)}
                >
                  <CategoryAvatar
                    icon={category.icon}
                    color={category.color}
                    boxClassName="h-10 w-10"
                    iconSize={20}
                  />
                  <Text variant="body" className="flex-1 text-foreground" numberOfLines={1}>
                    {category.name}
                  </Text>
                  {selected ? (
                    <Icon name="checkmark" size={20} colorClassName="accent-primary" />
                  ) : null}
                </Pressable>
              )
            })
          )}
        </View>
      </BottomSheetScrollView>
    </BottomSheet>
  )
}
