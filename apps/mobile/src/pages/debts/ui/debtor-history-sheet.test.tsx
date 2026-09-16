// Debtor history sheet behavior: remaining balance for the direction,
// day-grouped rows labeled Долг / Списание with signed amounts, row taps and
// the header's rename + delete affordances reporting up / acting, and the
// delete confirmation's operation count + non-zero balance warning.

import { describe, expect, it, jest, beforeEach } from '@jest/globals'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import { Alert } from 'react-native'
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

const ANNA: Debtor = { id: 'debtor-anna', name: 'Анна', currency: 'RUB', version: 1 }

const OPERATIONS: DebtOperation[] = [
  {
    id: 'op-1',
    debtorId: 'debtor-anna',
    direction: 'receivable',
    kind: 'debt',
    amount: 500_000,
    occurredAt: '2026-08-20T10:00:00.000Z',
    version: 1,
  },
  {
    id: 'op-2',
    debtorId: 'debtor-anna',
    direction: 'receivable',
    kind: 'repayment',
    amount: 150_000,
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
  const onRenameDebtor = jest.fn()
  const onNewOperation = jest.fn()
  const sheetRef = { current: null } as { current: BottomSheetRef | null }
  const debtorRepository = createMockDebtorRepository([ANNA])
  render(
    <SafeAreaProvider
      initialMetrics={{ frame: { x: 0, y: 0, width: 0, height: 0 }, insets: ZERO_INSETS }}
    >
      <ThemeProvider>
        <QueryClientProvider client={createQueryClient()}>
          <DebtRepositoryProvider
            debtorRepository={debtorRepository}
            debtOperationRepository={createMockDebtOperationRepository(operations)}
          >
            <BottomSheetProvider>
              <DebtorHistorySheet
                ref={sheetRef}
                debtor={debtor}
                direction={direction}
                operations={operations}
                onEditOperation={onEditOperation}
                onRenameDebtor={onRenameDebtor}
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
  return { onEditOperation, onRenameDebtor, onNewOperation, debtorRepository }
}

function confirmButton(index = 0) {
  const alertMock = jest.mocked(Alert.alert)
  const button = alertMock.mock.calls[index]?.[2]?.find(
    (candidate: { text?: string }) => candidate.text === 'Удалить',
  )
  if (!button) throw new Error('delete confirmation button missing')
  return button
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined)
})

describe('DebtorHistorySheet', () => {
  it('shows the remaining balance of the direction ledger only', () => {
    renderSheet()

    // 5 000,00 − 1 500,00 = 3 500,00; the payable op must not net in.
    expect(screen.getByTestId('debts-history-balance')).toHaveTextContent(
      formatAmount(350_000, 'RUB'),
    )
    expect(screen.getByText('Мне должны')).toBeTruthy()
  })

  it('groups operations by day, newest first, always labeled by kind with signed amounts', () => {
    renderSheet()

    const firstDay = screen.getByTestId('debts-history-day-2026-08-21')
    expect(firstDay).toBeTruthy()
    // Every row carries its kind label - there is no note to fall back to.
    expect(screen.getByText('Долг')).toBeTruthy()
    expect(screen.getByText('Списание')).toBeTruthy()
    // Signed display: the debt grows (+), the repayment shrinks (−).
    expect(screen.getByText(`+\u00A0${formatAmount(500_000, 'RUB')}`)).toBeTruthy()
    expect(screen.getByText(`−\u00A0${formatAmount(150_000, 'RUB')}`)).toBeTruthy()
  })

  it('reports row taps, debtor rename, and the new-repayment CTA upward', () => {
    const { onEditOperation, onRenameDebtor, onNewOperation } = renderSheet()

    fireEvent.press(screen.getByTestId('debts-history-op-op-1'))
    expect(onEditOperation).toHaveBeenCalledWith(OPERATIONS[0])

    fireEvent.press(screen.getByTestId('debts-history-rename-debtor'))
    expect(onRenameDebtor).toHaveBeenCalledWith(ANNA)

    fireEvent.press(screen.getByTestId('debts-new-repayment'))
    expect(onNewOperation).toHaveBeenCalledWith('debtor-anna', 'receivable')
  })

  it('confirms the delete with the live-operation count and the non-zero balance warning', async () => {
    const { debtorRepository } = renderSheet()

    fireEvent.press(screen.getByTestId('debts-history-delete-debtor'))
    expect(Alert.alert).toHaveBeenCalledWith(
      'Удалить должника?',
      // All THREE live operations (both ledgers) go; net = 3 500 − 2 000.
      `Должник будет удалён вместе со всеми своими операциями (3). Баланс ненулевой (${formatAmount(150_000, 'RUB')}).`,
      expect.arrayContaining([expect.objectContaining({ text: 'Удалить' })]),
    )

    await confirmButton().onPress?.()

    // The confirmed remove cascades in the repository; the sheet closes.
    await waitFor(() => expect(debtorRepository.calls.remove).toBe(1))
    expect(debtorRepository.snapshot()).toHaveLength(0)
  })

  it('warns nothing when the net balance is zero', () => {
    renderSheet({
      operations: [
        {
          id: 'op-1',
          debtorId: 'debtor-anna',
          direction: 'receivable',
          kind: 'debt',
          amount: 500_000,
          occurredAt: '2026-08-20T10:00:00.000Z',
          version: 1,
        },
        {
          id: 'op-2',
          debtorId: 'debtor-anna',
          direction: 'receivable',
          kind: 'repayment',
          amount: 500_000,
          occurredAt: '2026-08-21T10:00:00.000Z',
          version: 1,
        },
      ],
    })

    fireEvent.press(screen.getByTestId('debts-history-delete-debtor'))
    expect(Alert.alert).toHaveBeenCalledWith(
      'Удалить должника?',
      'Должник будет удалён вместе со всеми своими операциями (2).',
      expect.arrayContaining([expect.objectContaining({ text: 'Удалить' })]),
    )
  })

  it('renders nothing without a selected debtor', () => {
    // Render directly (the harness defaults `debtor` to ANNA for undefined,
    // but this case is exactly about the undefined gap). The delete mutation
    // hook still requires the repository context even with no subject.
    render(
      <SafeAreaProvider
        initialMetrics={{ frame: { x: 0, y: 0, width: 0, height: 0 }, insets: ZERO_INSETS }}
      >
        <ThemeProvider>
          <QueryClientProvider client={createQueryClient()}>
            <DebtRepositoryProvider
              debtorRepository={createMockDebtorRepository([ANNA])}
              debtOperationRepository={createMockDebtOperationRepository(OPERATIONS)}
            >
              <BottomSheetProvider>
                <DebtorHistorySheet
                  ref={{ current: null }}
                  debtor={undefined}
                  direction="receivable"
                  operations={OPERATIONS}
                  onEditOperation={jest.fn()}
                  onRenameDebtor={jest.fn()}
                  onNewOperation={jest.fn()}
                />
              </BottomSheetProvider>
            </DebtRepositoryProvider>
          </QueryClientProvider>
        </ThemeProvider>
      </SafeAreaProvider>,
    )
    expect(screen.queryByTestId('debts-history-sheet')).toBeNull()
  })
})
