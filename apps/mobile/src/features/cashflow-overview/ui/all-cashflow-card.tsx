import { Pressable, View } from 'react-native'
import { Card } from '@/shared/ui/card'
import { Icon } from '@/shared/ui/icon'
import { Text } from '@/shared/ui/text'
import { formatAmount } from '@/shared/lib/format/format'
import { monthRangeLabelShort, relativeDayLabel } from '@trata/dates'
import type { Category, Transaction } from '@trata/api'
import type { LatestCashflowView } from './all-cashflow-card.types'
import {
  cashflowDayGroups,
  latestCashflow,
  totalCashflow,
  type CashflowKind,
  type MonthCursor,
} from '../model/selectors'
import { useCashflowAuthor } from '../model/use-cashflow-author'
import { CASHFLOW_KIND_VIEWS } from './kind'
import { CashflowListSheet } from './cashflow-list-sheet'
import { useRef } from 'react'
import { BottomSheetRef } from '@/shared/ui/bottom-sheet'

interface AllCashflowCardProps {
  kind: CashflowKind
  cursor: MonthCursor
  transactions: Transaction[]
  categories: Category[]
  /** Opens the kind's new-transaction sheet (composed by the hosting page). */
  onNewTransaction: () => void
  /** Opens the edit sheet for the tapped list row (composed by the hosting page). */
  onEditTransaction?: (id: string) => void
}

export function AllCashflowCard({
  kind,
  cursor,
  transactions,
  categories,
  onNewTransaction,
  onEditTransaction,
}: AllCashflowCardProps) {
  const { copy, ids } = CASHFLOW_KIND_VIEWS[kind]
  const listSheetRef = useRef<BottomSheetRef>(null)
  const last = latestCashflow(transactions, cursor, kind)
  const lastCategory = last ? categories.find((c) => c.id === last.categoryId) : undefined
  const latest: LatestCashflowView | null = last
    ? {
        amountText: formatAmount(last.amount),
        categoryName: lastCategory?.name ?? 'Без категории',
        dayLabel: relativeDayLabel(last.occurredAt),
      }
    : null

  const author = useCashflowAuthor()
  const sheetGroups = cashflowDayGroups(transactions, categories, cursor, kind, author)
  const sheetSubtitle = `${monthRangeLabelShort(cursor.year, cursor.month)}, ${formatAmount(
    totalCashflow(transactions, cursor, kind),
  )}`

  return (
    <>
      <Pressable
        testID={ids.allCard}
        accessibilityRole="button"
        accessibilityLabel={`${copy.allTitle}${latest ? `, последний ${latest.categoryName}` : ''}`}
        className="active:opacity-70"
        onPress={() => {
          listSheetRef.current?.present()
        }}
      >
        <Card variant="elevated" className="bg-success/10">
          <View className="gap-2">
            <Text variant="h4">{copy.allTitle}</Text>

            {latest ? (
              <View className="flex-row items-center gap-4">
                <View className="flex-1 gap-2">
                  <Text variant="body" className="text-muted-foreground">
                    Последний {latest.dayLabel.toLowerCase()}
                    {'\n'}
                    {latest.amountText}, {latest.categoryName}
                  </Text>
                </View>
                <Icon name="chevron-forward" size={18} colorClassName="accent-muted-foreground" />
              </View>
            ) : (
              <View className="gap-2">
                <Text variant="body" className="text-muted-foreground">
                  {copy.allEmpty}
                </Text>
              </View>
            )}
          </View>
        </Card>
      </Pressable>

      <CashflowListSheet
        ref={listSheetRef}
        kind={kind}
        subtitle={sheetSubtitle}
        groups={sheetGroups}
        onNewTransaction={onNewTransaction}
        onEditTransaction={onEditTransaction}
      />
    </>
  )
}
