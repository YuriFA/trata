// Debtor history sheet behavior: remaining balance for the direction,
// day-grouped rows labeled Долг / Списание with signed amounts, row taps and
// header/footer affordances reporting up to the page.

import { describe, expect, it, jest } from '@jest/globals'
import { act, fireEvent, render, screen } from '@testing-library/react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { QueryClientProvider } from '@tanstack/react-query'
import type { DebtDirection, DebtOperation, Debtor } from '@trata/api'
import { ThemeProvider } from '@/shared/config/theme'
import { createQueryClient } from '@/shared/lib/query/query-client'
import { DebtRepositoryProvider } from '@/entities/debt'
import {
  createMockDebtOperationRepository,
  createMockDebtorRepository,
} from '@/shared/lib/testing/mock-debt-repositories'
import { BottomSheetProvider } from '@/shared/ui/bottom-sheet/bottom-sheet-provider'
import type { BottomSheetRef } from '@/shared/ui/bottom-sheet'
import { formatAmount } from '@/shared/lib/format/format'
import { DebtorHistorySheet } from './debtor-history-sheet'

const ZERO_INSETS = { top: 0, right: 0, bottom: 0, left: 0 }

const ANNA: Debtor = { id: 'debtor-anna', name: 'Анна', note: '', version: 1 }

const OPERATIONS: DebtOperation[] = [
  {
    id: 'op-1',
    debtorId: 'debtor-anna',
    direction: 'receivable',
    kind: 'debt',
    amount: 500_000,
    note: 'займ',
    occurredAt: '2026-08-20T10:00:00.000Z',
    version: 1,
  },
  {
    id: 'op-2',
    debtorId: 'debtor-anna',
    direction: 'receivable',
    kind: 'repayment',
    amount: 150_000,
    note: '',
    occurredAt: '2026-08-21T10:00:00.000Z',
    version: 1,
  },
  // Noise: another ledger of the same debtor - must not leak in.
  {
    id: 'op-3',
    debtorId: 'debtor-anna',
    direction: 'payable',
    kind: 'debt',
    amount: 200_000,
    note: '',
    occurredAt: '2026-08-22T10:00:00.000Z',
    version: 1,
  },
]

function renderSheet({
  debtor = ANNA,
  direction = 'receivable' as DebtDirection,
  operations = OPERATIONS,
} = {}) {
  const onEditOperation = jest.fn()
  const onEditDebtor = jest.fn()
  const onNewOperation = jest.fn()
  const sheetRef = { current: null } as { current: BottomSheetRef | null }
  render(
    <SafeAreaProvider
      initialMetrics={{ frame: { x: 0, y: 0, width: 0, height: 0 }, insets: ZERO_INSETS }}
    >
      <ThemeProvider>
        <QueryClientProvider client={createQueryClient()}>
          <DebtRepositoryProvider
            debtorRepository={createMockDebtorRepository([ANNA])}
            debtOperationRepository={createMockDebtOperationRepository(operations)}
          >
            <BottomSheetProvider>
              <DebtorHistorySheet
                ref={sheetRef}
                debtor={debtor}
                direction={direction}
                operations={operations}
                onEditOperation={onEditOperation}
                onEditDebtor={onEditDebtor}
                onNewOperation={onNewOperation}
              />
            </BottomSheetProvider>
          </DebtRepositoryProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </SafeAreaProvider>,
  )
  // The @gorhom mock mounts sheet children only while presented.
  if (debtor) act(() => sheetRef.current?.present())
  return { onEditOperation, onEditDebtor, onNewOperation }
}

describe('DebtorHistorySheet', () => {
  it('shows the remaining balance of the direction ledger only', () => {
    renderSheet()

    // 5 000,00 − 1 500,00 = 3 500,00; the payable op must not net in.
    expect(screen.getByTestId('debts-history-balance')).toHaveTextContent(formatAmount(350_000))
    expect(screen.getByText('Мне должны')).toBeTruthy()
  })

  it('groups operations by day, newest first, with kind labels and signed amounts', () => {
    renderSheet()

    const firstDay = screen.getByTestId('debts-history-day-2026-08-21')
    expect(firstDay).toBeTruthy()
    // The debt row shows its note, the repayment falls back to the kind label.
    expect(screen.getByText('займ')).toBeTruthy()
    expect(screen.getByText('Списание')).toBeTruthy()
    // Signed display: the debt grows (+), the repayment shrinks (−).
    expect(screen.getByText(`+\u00A0${formatAmount(500_000)}`)).toBeTruthy()
    expect(screen.getByText(`−\u00A0${formatAmount(150_000)}`)).toBeTruthy()
  })

  it('reports row taps, debtor edit, and the new-repayment CTA upward', () => {
    const { onEditOperation, onEditDebtor, onNewOperation } = renderSheet()

    fireEvent.press(screen.getByTestId('debts-history-op-op-1'))
    expect(onEditOperation).toHaveBeenCalledWith(OPERATIONS[0])

    fireEvent.press(screen.getByTestId('debts-history-edit-debtor'))
    expect(onEditDebtor).toHaveBeenCalledWith(ANNA)

    fireEvent.press(screen.getByTestId('debts-new-repayment'))
    expect(onNewOperation).toHaveBeenCalledWith('debtor-anna', 'receivable')
  })

  it('renders nothing without a selected debtor', () => {
    // Render directly: the harness defaults `debtor` to ANNA for undefined,
    // but this case is exactly about the undefined gap.
    render(
      <DebtorHistorySheet
        ref={{ current: null }}
        debtor={undefined}
        direction="receivable"
        operations={OPERATIONS}
        onEditOperation={jest.fn()}
        onEditDebtor={jest.fn()}
        onNewOperation={jest.fn()}
      />,
    )
    expect(screen.queryByTestId('debts-history-sheet')).toBeNull()
  })
})
