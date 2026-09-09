import { Card } from '@/shared/ui/card'
import { Icon } from '@/shared/ui/icon'
import { Pressable } from '@/shared/ui/pressable'
import { Text } from '@/shared/ui/text'
import type { Category, Transaction } from '@trata/api'
import { formatAmount } from '@/shared/lib/format/format'
import { categoryBreakdown, type CashflowKind, type MonthCursor } from '../model/selectors'
import { CASHFLOW_KIND_VIEWS } from './kind'
import { NewCategorySheet } from './new-category-sheet'
import { useRef, useState } from 'react'
import { BottomSheetRef } from '@/shared/ui/bottom-sheet'
import { CategoryRow } from './category-row'
import { View } from 'react-native'
import { CategoryCashflowSheet } from './category-cashflow-sheet'

export interface CategorySectionProps {
  kind: CashflowKind
  cursor: MonthCursor
  transactions: Transaction[]
  categories: Category[]
  /** Opens the new-transaction sheet with the category preselected (page composition). */
  onNewTransaction: (categoryId: string | undefined) => void
  /** Opens the edit sheet for a tapped list row (page composition, invariant #15). */
  onEditTransaction?: (id: string) => void
}

export function CategorySection({
  kind,
  cursor,
  transactions,
  categories,
  onNewTransaction,
  onEditTransaction,
}: CategorySectionProps) {
  const { copy, ids } = CASHFLOW_KIND_VIEWS[kind]
  const categorySheetRef = useRef<BottomSheetRef>(null)
  const newCategorySheetRef = useRef<BottomSheetRef>(null)
  const [categoryDetailId, setCategoryDetailId] = useState<string | undefined>(undefined)

  const hasAnyCategories = categories.length > 0
  const sheetCategory = categoryDetailId
    ? categories.find((c) => c.id === categoryDetailId)
    : undefined

  const rows = categoryBreakdown(transactions, categories, cursor, kind)

  const openNewCategory = () => {
    newCategorySheetRef.current?.present()
  }

  return (
    <>
      <Card variant="elevated" className="gap-4">
        <Pressable
          testID={ids.newCategory}
          accessibilityRole="button"
          accessibilityLabel="Новая категория"
          onPress={openNewCategory}
        >
          <View className="flex-row items-center gap-2">
            <View className="h-10 w-10 items-center justify-center rounded-full bg-muted">
              <Icon name="add" size={24} colorClassName="accent-foreground" />
            </View>
            <Text variant="body" className="font-medium text-foreground">
              Новая категория
            </Text>
          </View>
        </Pressable>

        {!hasAnyCategories ? (
          <View className="gap-2">
            <Text variant="body" className="text-muted-foreground">
              Нет категорий
            </Text>
            <Text variant="body-sm" className="text-muted-foreground">
              {copy.categoryHint}
            </Text>
          </View>
        ) : rows.length === 0 ? (
          <Text variant="body-sm" className="text-muted-foreground">
            {copy.monthEmpty}
          </Text>
        ) : (
          <View className="gap-4">
            {rows.map(({ category, totalMinor }) => (
              <CategoryRow
                key={category.id}
                kind={kind}
                categoryId={category.id}
                name={category.name}
                icon={category.icon}
                color={category.color}
                amountText={formatAmount(totalMinor)}
                onPress={(categoryId) => {
                  setCategoryDetailId(categoryId)
                  categorySheetRef.current?.present()
                }}
              />
            ))}
          </View>
        )}
      </Card>

      <NewCategorySheet ref={newCategorySheetRef} defaultType={kind} testID={ids.newCategoryForm} />

      <CategoryCashflowSheet
        ref={categorySheetRef}
        kind={kind}
        category={sheetCategory}
        categories={categories}
        initialCursor={cursor}
        onNewTransaction={onNewTransaction}
        onEditTransaction={onEditTransaction}
      />
    </>
  )
}
