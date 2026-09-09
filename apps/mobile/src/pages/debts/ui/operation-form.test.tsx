// Operation form behavior: fixed-context create (static «Контакт» /
// «Направление» rows, kind switch with Долг default), keypad amount
// validation, the expandable note/quick-date toolbar, over-repayment warning
// (warn, never block), repository error mapping at the root slot, and the
// edit variant's CAS version + immutable context rows.

import { describe, expect, it, beforeEach, jest } from '@jest/globals'
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import { Alert } from 'react-native'
import { QueryClientProvider } from '@tanstack/react-query'
import { UnknownReferencesError, type DebtOperation, type Debtor } from '@trata/api'
import { ThemeProvider } from '@/shared/config/theme'
import { createQueryClient } from '@/shared/lib/query/query-client'
import { DebtRepositoryProvider } from '@/entities/debt'
import {
  createMockDebtOperationRepository,
  createMockDebtorRepository,
} from '@/shared/lib/testing/mock-debt-repositories'
import { BottomSheetProvider } from '@/shared/ui/bottom-sheet/bottom-sheet-provider'
import { OperationForm, type OperationFormProps } from './operation-form'

const DEBTORS: Debtor[] = [
  { id: 'debtor-anna', name: 'Анна', note: '', version: 1 },
  { id: 'debtor-sergey', name: 'Сергей', note: '', version: 1 },
]

const EXISTING: DebtOperation[] = [
  {
    id: 'op-1',
    debtorId: 'debtor-anna',
    direction: 'receivable',
    kind: 'debt',
    amount: 500_000,
    note: '',
    occurredAt: '2026-08-20T10:00:00.000Z',
    version: 1,
  },
]

function renderForm(
  props: OperationFormProps,
  {
    debtors = DEBTORS,
    operations = EXISTING,
  }: { debtors?: Debtor[]; operations?: DebtOperation[] } = {},
) {
  const debtorRepository = createMockDebtorRepository(debtors)
  const debtOperationRepository = createMockDebtOperationRepository(operations)
  render(
    <QueryClientProvider client={createQueryClient()}>
      <DebtRepositoryProvider
        debtorRepository={debtorRepository}
        debtOperationRepository={debtOperationRepository}
      >
        <ThemeProvider>
          {/* The form mounts its own picker sheets, so it needs the sheet host. */}
          <BottomSheetProvider>
            <OperationForm {...props} />
          </BottomSheetProvider>
        </ThemeProvider>
      </DebtRepositoryProvider>
    </QueryClientProvider>,
  )
  return { debtorRepository, debtOperationRepository }
}

function typeAmount(digits: string) {
  for (const key of digits) {
    fireEvent.press(screen.getByTestId(`debts-operation-key-${key}`))
  }
}

describe('OperationForm (create, fixed context)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('shows static contact/direction rows and keeps submit disabled without an amount', async () => {
    const { debtOperationRepository } = renderForm({
      fixed: { debtorId: 'debtor-anna', direction: 'receivable' },
      onSuccess: jest.fn(),
    })

    expect(screen.getByText('Контакт')).toBeTruthy()
    // The debtors query resolves async; the name lands in the context row
    // and the header subtitle.
    await waitFor(() => expect(screen.getAllByText('Анна').length).toBeGreaterThan(0))
    expect(screen.getByText('Мне должны')).toBeTruthy()
    expect(screen.queryByTestId('debts-operation-direction')).toBeNull()
    expect(screen.queryByTestId('debts-operation-debtor')).toBeNull()

    expect(screen.getByTestId('debts-operation-submit')).toBeDisabled()
    expect(debtOperationRepository.calls.create).toBe(0)
  })

  it('creates a debt by default with the fixed contact and direction', async () => {
    const { debtOperationRepository } = renderForm({
      fixed: { debtorId: 'debtor-sergey', direction: 'payable' },
      onSuccess: jest.fn(),
    })

    typeAmount('2000')
    await waitFor(() => expect(screen.getByTestId('debts-operation-submit')).toBeEnabled())
    fireEvent.press(screen.getByTestId('debts-operation-submit'))

    await waitFor(() => expect(debtOperationRepository.calls.create).toBe(1))
    expect(debtOperationRepository.snapshot().at(-1)).toMatchObject({
      debtorId: 'debtor-sergey',
      direction: 'payable',
      kind: 'debt',
      amount: 200_000,
    })
  })

  it('creates a repayment through the kind switch', async () => {
    const { debtOperationRepository } = renderForm({
      fixed: { debtorId: 'debtor-sergey', direction: 'payable' },
      onSuccess: jest.fn(),
    })

    fireEvent.press(screen.getByTestId('debts-operation-kind-repayment'))
    typeAmount('1500')
    await waitFor(() => expect(screen.getByTestId('debts-operation-submit')).toBeEnabled())
    fireEvent.press(screen.getByTestId('debts-operation-submit'))

    await waitFor(() => expect(debtOperationRepository.calls.create).toBe(1))
    expect(debtOperationRepository.snapshot().at(-1)).toMatchObject({
      debtorId: 'debtor-sergey',
      direction: 'payable',
      kind: 'repayment',
      amount: 150_000,
    })
  })

  it('reveals the note input and quick dates from the action toolbar', async () => {
    const { debtOperationRepository } = renderForm({
      fixed: { debtorId: 'debtor-anna', direction: 'receivable' },
      onSuccess: jest.fn(),
    })

    fireEvent.press(screen.getByTestId('debts-operation-note-button'))
    fireEvent.changeText(screen.getByTestId('debts-operation-note-input'), 'за обед')
    fireEvent.press(screen.getByTestId('debts-operation-date-button'))
    expect(screen.getByTestId('debts-operation-quick-dates')).toBeTruthy()
    fireEvent.press(screen.getByTestId('debts-operation-quick-date-0'))

    typeAmount('100')
    await waitFor(() => expect(screen.getByTestId('debts-operation-submit')).toBeEnabled())
    fireEvent.press(screen.getByTestId('debts-operation-submit'))

    await waitFor(() => expect(debtOperationRepository.calls.create).toBe(1))
    expect(debtOperationRepository.snapshot().at(-1)?.note).toBe('за обед')
  })

  it('warns on over-repayment but still accepts the operation', async () => {
    const { debtOperationRepository } = renderForm({
      fixed: { debtorId: 'debtor-anna', direction: 'receivable' },
      onSuccess: jest.fn(),
    })
    // Remaining receivable balance for Анна is 5 000,00 ₽ (op-1).
    fireEvent.press(screen.getByTestId('debts-operation-kind-repayment'))
    typeAmount('6000')

    await waitFor(() => expect(screen.getByTestId('debts-operation-over-repayment')).toBeTruthy())

    await waitFor(() => expect(screen.getByTestId('debts-operation-submit')).toBeEnabled())
    fireEvent.press(screen.getByTestId('debts-operation-submit'))
    await waitFor(() => expect(debtOperationRepository.calls.create).toBe(1))
    expect(debtOperationRepository.snapshot().at(-1)?.amount).toBe(600_000)
  })

  it('maps a repository error to the root slot and keeps the values', async () => {
    const { debtOperationRepository } = renderForm({
      fixed: { debtorId: 'debtor-anna', direction: 'receivable' },
      onSuccess: jest.fn(),
    })
    debtOperationRepository.failNextCreateWith(
      new UnknownReferencesError('Debtor not found', {
        apiCode: 'DEBT_OPERATION_DEBTOR_NOT_FOUND',
      }),
    )

    typeAmount('100')
    await waitFor(() => expect(screen.getByTestId('debts-operation-submit')).toBeEnabled())
    fireEvent.press(screen.getByTestId('debts-operation-submit'))

    await waitFor(() =>
      expect(screen.getByTestId('debts-operation-error')).toHaveTextContent(
        'Указан неизвестный счёт или категория',
      ),
    )
    expect(screen.getByTestId('debts-operation-amount')).toHaveTextContent('100')
  })
})

describe('OperationForm (edit)', () => {
  it('prefills, keeps context immutable, and saves with the CAS version', async () => {
    const { debtOperationRepository } = renderForm({ operation: EXISTING[0], onSuccess: jest.fn() })

    await waitFor(() => expect(screen.getAllByText('Анна').length).toBeGreaterThan(0))
    expect(screen.getByText('Долг')).toBeTruthy()
    expect(screen.queryByTestId('debts-operation-kind')).toBeNull()

    // «5000» (5 000,00 ₽) + key 5 → «50005» = 50 005,00 ₽.
    typeAmount('5')
    await waitFor(() => expect(screen.getByTestId('debts-operation-submit')).toBeEnabled())

    fireEvent.press(screen.getByTestId('debts-operation-submit'))

    await waitFor(() => expect(debtOperationRepository.calls.update).toBe(1))
    expect(debtOperationRepository.snapshot()[0]).toMatchObject({
      id: 'op-1',
      amount: 5_000_500,
      version: 2,
    })
  })

  it('deletes through the confirm alert (always allowed)', async () => {
    const { debtOperationRepository } = renderForm({ operation: EXISTING[0], onSuccess: jest.fn() })
    const alertMock = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined)

    fireEvent.press(screen.getByTestId('debts-operation-delete'))
    expect(Alert.alert).toHaveBeenCalledWith(
      'Удалить операцию?',
      undefined,
      expect.arrayContaining([expect.objectContaining({ text: 'Удалить' })]),
    )

    const deleteButton = alertMock.mock.calls[0]?.[2]?.find(
      (button: { text?: string }) => button.text === 'Удалить',
    )
    if (!deleteButton) throw new Error('delete confirmation button missing')
    await deleteButton.onPress?.()

    await waitFor(() => expect(debtOperationRepository.calls.remove).toBe(1))
    expect(debtOperationRepository.snapshot()).toHaveLength(0)
  })
})
