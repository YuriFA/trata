// Debtor rename sheet behavior (simplify-debt-domain): prefill, no-op
// submit (same/empty name) never calls the API, CAS-versioned rename, the
// duplicate-name mapping at the root slot, and cancel dismissing without a
// mutation. Deletion lives in the debtor history header. The form renders
// standalone (the @gorhom mock degrades BottomSheetInput to a plain input
// under jest).

import { describe, expect, it, beforeEach, jest } from '@jest/globals'
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import { QueryClientProvider } from '@tanstack/react-query'
import type { Debtor } from '@trata/api'
import { ThemeProvider } from '@/shared/config/theme'
import { createQueryClient } from '@/shared/lib/query/query-client'
import { DebtRepositoryProvider } from '@/entities/debt'
import {
  createMockDebtOperationRepository,
  createMockDebtorRepository,
} from '@/shared/lib/testing/mock-debt-repositories'
import type { BottomSheetRef } from '@/shared/ui/bottom-sheet'
import { DebtorRenameForm } from './debtor-rename-sheet'

const ANNA: Debtor = { id: 'debtor-anna', name: 'Анна', currency: 'RUB', version: 3 }
const SERGEY: Debtor = { id: 'debtor-sergey', name: 'Сергей', currency: 'RUB', version: 1 }

function renderForm(debtor: Debtor = ANNA, { debtors = [ANNA, SERGEY] as Debtor[] } = {}) {
  const debtorRepository = createMockDebtorRepository(debtors)
  const sheetRef = {
    current: { present: jest.fn(), dismiss: jest.fn() },
  } as unknown as { current: BottomSheetRef }
  render(
    <QueryClientProvider client={createQueryClient()}>
      <DebtRepositoryProvider
        debtorRepository={debtorRepository}
        debtOperationRepository={createMockDebtOperationRepository([])}
      >
        <ThemeProvider>
          <DebtorRenameForm debtor={debtor} sheetRef={sheetRef} />
        </ThemeProvider>
      </DebtRepositoryProvider>
    </QueryClientProvider>,
  )
  return { debtorRepository, sheetRef }
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('DebtorRenameForm (rename only)', () => {
  it('prefills from the record', () => {
    renderForm()

    expect(screen.getByTestId('debts-rename-name')).toHaveProp('value', 'Анна')
  })

  it('blocks an emptied name with the field error and no update call', async () => {
    const { debtorRepository } = renderForm()

    fireEvent.changeText(screen.getByTestId('debts-rename-name'), '')
    fireEvent.press(screen.getByTestId('debts-rename-submit'))

    await waitFor(() =>
      expect(screen.getByTestId('debts-rename-name-error')).toHaveTextContent('Введите имя'),
    )
    expect(debtorRepository.calls.update).toBe(0)
  })

  it('keeps a no-op (same-name) submit disabled and never calls the API', async () => {
    const { debtorRepository } = renderForm()

    // The prefilled state is already a no-op.
    expect(screen.getByTestId('debts-rename-submit')).toBeDisabled()

    // Typing the original name back closes the no-op gate again.
    fireEvent.changeText(screen.getByTestId('debts-rename-name'), 'Анна П.')
    await waitFor(() => expect(screen.getByTestId('debts-rename-submit')).toBeEnabled())
    fireEvent.changeText(screen.getByTestId('debts-rename-name'), 'Анна')
    expect(screen.getByTestId('debts-rename-submit')).toBeDisabled()

    expect(debtorRepository.calls.update).toBe(0)
  })

  it('renames with the record CAS version', async () => {
    const { debtorRepository } = renderForm()

    fireEvent.changeText(screen.getByTestId('debts-rename-name'), 'Анна П.')
    await waitFor(() => expect(screen.getByTestId('debts-rename-submit')).toBeEnabled())
    fireEvent.press(screen.getByTestId('debts-rename-submit'))

    await waitFor(() => expect(debtorRepository.calls.update).toBe(1))
    expect(debtorRepository.snapshot()[0]).toMatchObject({ name: 'Анна П.', version: 4 })
  })

  it('maps a duplicate name to the root error and keeps the sheet open', async () => {
    const { debtorRepository, sheetRef } = renderForm()

    fireEvent.changeText(screen.getByTestId('debts-rename-name'), 'Сергей')
    await waitFor(() => expect(screen.getByTestId('debts-rename-submit')).toBeEnabled())
    fireEvent.press(screen.getByTestId('debts-rename-submit'))

    await waitFor(() =>
      expect(screen.getByTestId('debts-rename-error')).toHaveTextContent('Уже существует'),
    )
    expect(debtorRepository.calls.update).toBe(1)
    expect(screen.getByTestId('debts-rename-name')).toHaveProp('value', 'Сергей')
    expect(sheetRef.current?.dismiss).not.toHaveBeenCalled()
  })

  it('cancels without a mutation', () => {
    const { debtorRepository, sheetRef } = renderForm()

    fireEvent.press(screen.getByTestId('debts-rename-cancel'))

    expect(sheetRef.current?.dismiss).toHaveBeenCalledTimes(1)
    expect(debtorRepository.calls.update).toBe(0)
  })
})
