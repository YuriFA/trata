import { useRef, useState } from 'react'
import type { AccountWithBalance, Transaction } from '@trata/api'
import { BottomSheetRef } from '@/shared/ui/bottom-sheet'
import { aggregateDetailText, aggregateHeroText, rateDateLabel } from '@/shared/lib/money/aggregate'
import {
  SummaryCard,
  cashflowTotal,
  useCashflowPresentation,
  type MonthCursor,
} from '@/features/cashflow-overview'
import { monthlyBalance, totalBalance } from '../model/selectors'
import { ModeSheet, type SummaryMode } from './mode-sheet'

export interface DashboardSummaryCardProps {
  cursor: MonthCursor
  accounts: AccountWithBalance[]
  transactions: Transaction[]
  onPrevPeriod: () => void
  onNextPeriod: () => void
}

/**
 * Dashboard-only summary: owns the mode state (expenses / month balance /
 * total balance) and its picker sheet, feeding the shared presentational
 * card. Every mode figure is a per-currency aggregate (multi-currency 6.4):
 * exact single-currency heroes, «≈» converted heroes with the per-currency
 * detail line and the rate date, and the exact per-currency join when no
 * rates are cached. The income screen mounts that card directly with a
 * fixed title.
 */
export function DashboardSummaryCard({
  cursor,
  accounts,
  transactions,
  onPrevPeriod,
  onNextPeriod,
}: DashboardSummaryCardProps) {
  const modeSheetRef = useRef<BottomSheetRef>(null)
  const [mode, setMode] = useState<SummaryMode>('expenses')
  const presentation = useCashflowPresentation()

  // TODO(i18n): RU strings are hardcoded until react-i18next is wired.
  const MODE_TITLES: Record<SummaryMode, string> = {
    expenses: 'Расходы',
    'monthly-balance': 'Баланс за месяц',
    'total-balance': 'Баланс общий',
  }

  const aggregate =
    mode === 'expenses'
      ? cashflowTotal(transactions, cursor, 'expense', presentation)
      : mode === 'monthly-balance'
        ? monthlyBalance(transactions, cursor, presentation)
        : totalBalance(accounts, presentation)

  const amountText = aggregateHeroText(aggregate)
  const detailText = aggregateDetailText(aggregate)
  const footnoteText = aggregate.converted
    ? `Курс на ${rateDateLabel(presentation.rates?.asOf ?? '')}`
    : undefined

  return (
    <>
      <SummaryCard
        title={MODE_TITLES[mode]}
        amountText={amountText}
        detailText={detailText ?? undefined}
        footnoteText={footnoteText}
        cursor={cursor}
        onPrevPeriod={onPrevPeriod}
        onNextPeriod={onNextPeriod}
        onTitlePress={() => modeSheetRef.current?.present()}
        testIDPrefix="home"
      />

      <ModeSheet
        ref={modeSheetRef}
        activeMode={mode}
        onSelect={(nextMode) => {
          setMode(nextMode)
          modeSheetRef.current?.dismiss()
        }}
      />
    </>
  )
}
