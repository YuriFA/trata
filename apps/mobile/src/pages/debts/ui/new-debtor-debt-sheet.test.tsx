// Combined contact+debt form behavior (design D9): direction-aware copy,
// name/amount validation, one submit creating the debtor and their initial
// debt with the section's direction and kind `debt`, duplicate-name error
// mapping at the root slot, and the partial-failure retry that reuses the
// already-created contact.

import { describe, expect, it, beforeEach, jest } from '@jest/globals'
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import { QueryClientProvider } from '@tanstack/react-query'
import { UnknownReferencesError, type DebtDirection, type Debtor } from '@trata/api'
import { ThemeProvider } from '@/shared/config/theme'
import { createQueryClient } from '@/shared/lib/query/query-client'
import { DebtRepositoryProvider } from '@/entities/debt'
import {
  createMockDebtOperationRepository,
  createMockDebtorRepository,
} from '@/shared/lib/testing/mock-debt-repositories'
import { BottomSheetProvider } from '@/shared/ui/bottom-sheet/bottom-sheet-provider'
import { NewDebtorDebtForm } from './new-debtor-debt-sheet'

// The form resolves the debtor currency from the household base (design D7);
// these suites run anonymous - no base currency, the repository default applies.
jest.mock('@/entities/session', () => ({
  ...(jest.requireActual('@/entities/session') as Record<string, unknown>),
  useAuth: () => ({ status: 'anonymous', user: null }),
}))
jest.mock('@/entities/household', () => ({
  ...(jest.requireActual('@/entities/household') as Record<string, unknown>),
  useHousehold: () => ({ data: undefined }),
}))

const ANNA: Debtor = { id: 'debtor-anna', name: 'Анна', currency: 'RUB', version: 1 }

function renderForm(direction: DebtDirection = 'receivable', { debtors = [] as Debtor[] } = {}) {
  const debtorRepository = createMockDebtorRepository(debtors)
  const debtOperationRepository = createMockDebtOperationRepository([])
  render(
    <QueryClientProvider client={createQueryClient()}>
      <DebtRepositoryProvider
        debtorRepository={debtorRepository}
        debtOperationRepository={debtOperationRepository}
      >
        <ThemeProvider>
          {/* The form mounts the date-picker sheet, so it needs the sheet host. */}
          <BottomSheetProvider>
            <NewDebtorDebtForm direction={direction} sheetRef={{ current: null }} />
          </BottomSheetProvider>
        </ThemeProvider>
      </DebtRepositoryProvider>
    </QueryClientProvider>,
  )
  return { debtorRepository, debtOperationRepository }
}

function typeAmount(digits: string) {
  for (const key of digits) {
    fireEvent.press(screen.getByTestId(`debts-new-debt-key-${key}`))
  }
}

function fillValidForm(name = 'Анна') {
  fireEvent.changeText(screen.getByTestId('debts-new-debt-name'), name)
  typeAmount('2500')
}

describe('NewDebtorDebtForm', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('titles the form by the section direction', () => {
    renderForm('payable')

    expect(screen.getByText('Кому должен')).toBeTruthy()
    expect(screen.getByText('Я должен')).toBeTruthy()
  })

  it('blocks submit without a name and without an amount', async () => {
    const { debtorRepository, debtOperationRepository } = renderForm()

    // An empty form keeps the circular submit disabled.
    expect(screen.getByTestId('debts-new-debt-submit')).toBeDisabled()

    // Editing the name with an empty value surfaces the field error.
    fireEvent.changeText(screen.getByTestId('debts-new-debt-name'), '')
    await waitFor(() =>
      expect(screen.getByTestId('debts-new-debt-name-error')).toHaveTextContent('Введите имя'),
    )

    // A name without an amount is still not submittable.
    fireEvent.changeText(screen.getByTestId('debts-new-debt-name'), 'Анна')
    expect(screen.getByTestId('debts-new-debt-submit')).toBeDisabled()

    expect(debtorRepository.calls.create).toBe(0)
    expect(debtOperationRepository.calls.create).toBe(0)
  })

  it('creates the contact and their initial debt in one submit', async () => {
    const { debtorRepository, debtOperationRepository } = renderForm('payable')

    fillValidForm()

    await waitFor(() => expect(screen.getByTestId('debts-new-debt-submit')).toBeEnabled())
    fireEvent.press(screen.getByTestId('debts-new-debt-submit'))

    await waitFor(() => expect(debtorRepository.calls.create).toBe(1))
    await waitFor(() => expect(debtOperationRepository.calls.create).toBe(1))
    expect(debtorRepository.snapshot()[0]).toMatchObject({ name: 'Анна' })
    expect(debtOperationRepository.snapshot()[0]).toMatchObject({
      debtorId: debtorRepository.snapshot()[0]?.id,
      direction: 'payable',
      kind: 'debt',
      amount: 250_000,
    })
  })

  it('maps a duplicate name to the root error and creates no operation', async () => {
    const { debtOperationRepository } = renderForm('receivable', {
      debtors: [ANNA],
    })

    fillValidForm()
    await waitFor(() => expect(screen.getByTestId('debts-new-debt-submit')).toBeEnabled())
    fireEvent.press(screen.getByTestId('debts-new-debt-submit'))

    await waitFor(() =>
      expect(screen.getByTestId('debts-new-debt-error')).toHaveTextContent('Уже существует'),
    )
    expect(debtOperationRepository.calls.create).toBe(0)
    expect(screen.getByTestId('debts-new-debt-name')).toHaveProp('value', 'Анна')
  })

  it('reuses the created contact when a retry follows an operation failure', async () => {
    const { debtorRepository, debtOperationRepository } = renderForm()
    debtOperationRepository.failNextCreateWith(
      new UnknownReferencesError('Debtor not found', {
        apiCode: 'DEBT_OPERATION_DEBTOR_NOT_FOUND',
      }),
    )

    fillValidForm()
    await waitFor(() => expect(screen.getByTestId('debts-new-debt-submit')).toBeEnabled())
    fireEvent.press(screen.getByTestId('debts-new-debt-submit'))

    // The contact was created, the operation failed: the root error shows.
    await waitFor(() =>
      expect(screen.getByTestId('debts-new-debt-error')).toHaveTextContent(
        'Указан неизвестный счёт или категория',
      ),
    )
    expect(debtorRepository.calls.create).toBe(1)

    // Retry: the already-created contact is reused, not re-created. (The
    // operation counter already counted the failed attempt.)
    await waitFor(() => expect(screen.getByTestId('debts-new-debt-submit')).toBeEnabled())
    fireEvent.press(screen.getByTestId('debts-new-debt-submit'))

    await waitFor(() => expect(debtOperationRepository.snapshot()).toHaveLength(1))
    expect(debtOperationRepository.calls.create).toBe(2)
    expect(debtorRepository.calls.create).toBe(1)
    expect(debtOperationRepository.snapshot()[0]).toMatchObject({
      debtorId: debtorRepository.snapshot()[0]?.id,
      kind: 'debt',
    })
  })
})
