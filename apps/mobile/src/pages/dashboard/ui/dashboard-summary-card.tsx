import { useRef, useState } from 'react'
import type { AccountWithBalance, Transaction } from '@trata/api'
import { BottomSheetRef } from '@/shared/ui/bottom-sheet'
import { formatAmount } from '@/shared/lib/format/format'
import { SummaryCard, totalCashflow, type MonthCursor } from '@/features/cashflow-overview'
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
 * card. The income screen mounts that card directly with a fixed title.
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

  // TODO(i18n): RU strings are hardcoded until react-i18next is wired.
  const MODE_TITLES: Record<SummaryMode, string> = {
    expenses: 'Расходы',
    'monthly-balance': 'Баланс за месяц',
    'total-balance': 'Баланс общий',
  }

  const amountText =
    mode === 'expenses'
      ? formatAmount(totalCashflow(transactions, cursor, 'expense'))
      : mode === 'monthly-balance'
        ? formatAmount(monthlyBalance(transactions, cursor))
        : formatAmount(totalBalance(accounts))

  return (
    <>
      <SummaryCard
        title={MODE_TITLES[mode]}
        amountText={amountText}
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
