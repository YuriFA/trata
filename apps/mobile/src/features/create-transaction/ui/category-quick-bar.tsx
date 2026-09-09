import { useEffect, useRef, useState } from 'react'
import { FlatList, View } from 'react-native'
import type { Category } from '@trata/api'
import { Icon } from '@/shared/ui/icon'
import { CategoryAvatar } from '@/shared/ui/category-avatar'
import { Text } from '@/shared/ui/text'
import { Pressable } from '@/shared/ui/pressable'
import { cn } from '@/shared/lib/utils'

export function CategoryQuickBar({
  categories,
  selectedId,
  onSelect,
  onOpenMenu,
}: {
  categories: Category[]
  selectedId: string
  onSelect: (id: string) => void
  onOpenMenu: () => void
}) {
  const listRef = useRef<FlatList<Category>>(null)
  const itemLayouts = useRef(new Map<string, { x: number; width: number }>())
  const [listWidth, setListWidth] = useState(0)
  const [contentWidth, setContentWidth] = useState(0)

  useEffect(() => {
    const layout = itemLayouts.current.get(selectedId)
    if (!layout || listWidth === 0) return
    const centered = layout.x - (listWidth - layout.width) / 2
    const maxOffset = Math.max(0, contentWidth - listWidth)
    listRef.current?.scrollToOffset({
      offset: Math.min(Math.max(0, centered), maxOffset),
      animated: true,
    })
  }, [selectedId, listWidth, contentWidth])

  return (
    <View className="flex flex-row gap-2">
      <Pressable
        testID="new-transaction-category-menu"
        accessibilityRole="button"
        accessibilityLabel="Все категории"
        className="size-12 items-center justify-center rounded-2xl border border-border"
        onPress={onOpenMenu}
      >
        <Icon name="menu" size={18} colorClassName="accent-muted-foreground" />
      </Pressable>

      <FlatList
        ref={listRef}
        testID="new-transaction-category-list"
        horizontal
        data={categories}
        keyExtractor={(category) => category.id}
        showsHorizontalScrollIndicator={false}
        contentContainerClassName="gap-2"
        onLayout={(event) => setListWidth(event.nativeEvent.layout.width)}
        onContentSizeChange={(width) => setContentWidth(width)}
        renderItem={({ item: category }) => {
          const selected = category.id === selectedId
          return (
            <Pressable
              testID={`new-transaction-category-${category.id}`}
              accessibilityRole="button"
              accessibilityLabel={category.name}
              accessibilityState={{ selected }}
              className={cn(
                'h-12 flex-row items-center gap-2 rounded-2xl ring-inset ring ring-border px-2 pr-3',
                selected ? 'ring-primary bg-secondary' : 'ring-border',
              )}
              onLayout={(event) =>
                itemLayouts.current.set(category.id, {
                  x: event.nativeEvent.layout.x,
                  width: event.nativeEvent.layout.width,
                })
              }
              onPress={() => onSelect(category.id)}
            >
              <CategoryAvatar
                icon={category.icon}
                color={category.color}
                boxClassName="size-9"
                iconSize={16}
              />
              <Text
                variant="body-sm"
                className={selected ? 'font-medium text-primary' : 'text-foreground'}
                numberOfLines={1}
              >
                {category.name}
              </Text>
            </Pressable>
          )
        }}
      />
    </View>
  )
}
