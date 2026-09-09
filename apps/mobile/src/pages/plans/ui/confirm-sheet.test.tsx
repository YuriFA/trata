// Confirm sheet behavior: prefilled amount/date/note from the plan with the
// account/category as static context, keypad amount editing, the submitted
// D6 composite input (occurrence date at mid-day UTC), and failure keeping
// the entered values with the mapped repository error.

import { describe, expect, it, beforeEach, jest } from '@jest/globals'
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { QueryClientProvider } from '@tanstack/react-query'
import type { Account, Category, PlannedPayment } from '@trata/api'
import { ThemeProvider } from '@/shared/config/theme'
import { createQueryClient } from '@/shared/lib/query/query-client'
import { AccountRepositoryProvider } from '@/entities/account'
import { CategoryRepositoryProvider } from '@/entities/category'
import { PlannedPaymentRepositoryProvider } from '@/entities/planned-payment'
import { createMockAccountRepository } from '@/shared/lib/testing/mock-account-repository'
import { createMockCategoryRepository } from '@/shared/lib/testing/mock-category-repository'
import {
  createMockPlannedPaymentRepository,
  type MockPlannedPaymentRepository,
} from '@/shared/lib/testing/mock-planned-payment-repository'
import { BottomSheetProvider } from '@/shared/ui/bottom-sheet/bottom-sheet-provider'
import { ConfirmSheet } from './confirm-sheet'

const ZERO_INSETS = { top: 0, right: 0, bottom: 0, left: 0 }

const ACCOUNTS: Account[] = [
  {
    id: 'acc-main',
    name: 'Основной',
    currency: 'RUB',
    openingBalance: 0,
    version: 1,
  },
]

const CATEGORIES: Category[] = [
  {
    id: 'cat-utilities',
    name: 'ЖКХ',
    type: 'expense',
    icon: 'home',
    color: '#7c5cff',
    archivedAt: null,
    version: 1,
  },
]

const PLAN: PlannedPayment = {
  id: 'plan-utilities',
  type: 'expense',
  amount: 240_000,
  name: 'Коммуналка',
  accountId: 'acc-main',
  categoryId: 'cat-utilities',
  nextDue: '2026-09-05',
  anchorDate: '2026-09-05',
  regularity: 'monthly',
  confirmMode: 'manual',
  reminder: 'off',
  note: '',
  version: 2,
}

function renderSheet(plan: PlannedPayment = PLAN, repository?: MockPlannedPaymentRepository) {
  const planRepository = repository ?? createMockPlannedPaymentRepository([plan])
  render(
    <SafeAreaProvider
      initialMetrics={{ frame: { x: 0, y: 0, width: 0, height: 0 }, insets: ZERO_INSETS }}
    >
      <ThemeProvider>
        <QueryClientProvider client={createQueryClient()}>
          <AccountRepositoryProvider repository={createMockAccountRepository(ACCOUNTS)}>
            <CategoryRepositoryProvider repository={createMockCategoryRepository(CATEGORIES)}>
              <PlannedPaymentRepositoryProvider repository={planRepository}>
                <BottomSheetProvider>
                  <ConfirmSheet plan={plan} />
                </BottomSheetProvider>
              </PlannedPaymentRepositoryProvider>
            </CategoryRepositoryProvider>
          </AccountRepositoryProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </SafeAreaProvider>,
  )
  return { planRepository }
}

/** The amount is retyped into the decimal-pad input (sanitized on change). */
function setAmount(value: string) {
  fireEvent.changeText(screen.getByTestId('plans-confirm-amount'), value)
}

describe('ConfirmSheet', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('prefills the amount, fixes the account/category as context, and defaults to the scheduled date', async () => {
    renderSheet()

    await waitFor(() => expect(screen.getByDisplayValue('2\u202F400')).toBeTruthy())
    expect(screen.getByText('Основной')).toBeTruthy()
    expect(screen.getByText('ЖКХ')).toBeTruthy()
    expect(screen.getByText('Счёт списания')).toBeTruthy()
    // The amount carries the plan's account currency chip.
    expect(screen.getByTestId('plans-confirm-currency')).toHaveTextContent('₽')
    // The note prefills with the plan's name (note-equals-plan-name rule).
    expect(screen.getByDisplayValue('Коммуналка')).toBeTruthy()
    // The date row shows the occurrence's scheduled date.
    expect(screen.getByTestId('plans-confirm-date')).toHaveTextContent(/5 сентября/)
  })

  it('submits the composite with an edited amount', async () => {
    const { planRepository } = renderSheet()

    await waitFor(() => expect(screen.getByTestId('plans-confirm-submit')).toBeEnabled())
    setAmount('2650')
    fireEvent.press(screen.getByTestId('plans-confirm-submit'))

    await waitFor(() => expect(planRepository.calls.confirm).toBe(1))
    expect(planRepository.confirmations[0]).toEqual({
      planId: 'plan-utilities',
      amount: 265_000,
      // Mid-day UTC keeps the transaction inside its calendar day (D2).
      occurredAt: '2026-09-05T12:00:00.000Z',
      note: 'Коммуналка',
    })
  })

  it('keeps the entered values with the mapped error when the composite fails', async () => {
    // The plan is NOT in the repository: the composite lands as not-found.
    const { planRepository } = renderSheet(PLAN, createMockPlannedPaymentRepository([]))

    await waitFor(() => expect(screen.getByTestId('plans-confirm-submit')).toBeEnabled())
    setAmount('2650')
    fireEvent.press(screen.getByTestId('plans-confirm-submit'))

    await waitFor(() =>
      expect(screen.getByTestId('plans-confirm-error')).toHaveTextContent('Не найдено'),
    )
    expect(planRepository.confirmations).toHaveLength(1)
    expect(screen.getByDisplayValue('2\u202F650')).toBeTruthy()
  })
})
