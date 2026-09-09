import { describe, expect, it, jest } from '@jest/globals'
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { QueryClientProvider } from '@tanstack/react-query'
import type { Account, Category, Transaction } from '@trata/api'
import { ThemeProvider } from '@/shared/config/theme'
import { createQueryClient } from '@/shared/lib/query/query-client'
import { AccountRepositoryProvider } from '@/entities/account'
import { createMockAccountRepository } from '@/shared/lib/testing/mock-account-repository'
import { CategoryRepositoryProvider } from '@/entities/category'
import { createMockCategoryRepository } from '@/shared/lib/testing/mock-category-repository'
import { TransactionRepositoryProvider } from '@/entities/transaction'
import { createMockTransactionRepository } from '@/shared/lib/testing/mock-transaction-repository'
import { BottomSheetProvider } from '@/shared/ui/bottom-sheet/bottom-sheet-provider'
import { formatAmount } from '@/shared/lib/format/format'
import {
  cashflowInMonth,
  currentMonth,
  previousMonth,
  totalCashflow,
} from '@/features/cashflow-overview'
import { IncomeScreen } from './income-screen'

// Authorship markers (household-ux 2.4) resolve against the household cache;
// these suites run anonymous with no members, so no marker ever renders.
jest.mock('@/entities/session', () => ({
  ...(jest.requireActual('@/entities/session') as Record<string, unknown>),
  useAuth: () => ({ status: 'anonymous', user: null }),
}))

jest.mock('@/entities/household', () => ({
  ...(jest.requireActual('@/entities/household') as Record<string, unknown>),
  useHousehold: () => ({ data: undefined }),
}))
const mockBack = jest.fn()
jest.mock('expo-router', () => ({ useRouter: () => ({ back: mockBack }) }))

const ZERO_INSETS = { top: 0, right: 0, bottom: 0, left: 0 }

// --- Date-relative domain fixtures (current month has incomes plus expense
// noise, the previous month one income, older months are empty) -------------

function toIso(date: Date): string {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12).toISOString()
}

/** Day `day` of the current month, clamped to today, at 12:00 local. */
function dayThisMonth(day: number): string {
  const now = new Date()
  return toIso(new Date(now.getFullYear(), now.getMonth(), Math.min(day, now.getDate()), 12))
}

function dayPrevMonth(day: number): string {
  const prev = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1)
  const lastDay = new Date(prev.getFullYear(), prev.getMonth() + 1, 0).getDate()
  return toIso(new Date(prev.getFullYear(), prev.getMonth(), Math.min(day, lastDay), 12))
}

const ACCOUNTS: Account[] = [
  {
    id: 'acc-card',
    name: 'Карта',
    currency: 'RUB',
    openingBalance: 3_200_000,
    version: 1,
  },
]

const CATEGORIES: Category[] = [
  {
    id: 'cat-salary',
    name: 'Зарплата',
    type: 'income',
    icon: 'cash',
    color: '#16a34a',
    archivedAt: null,
    version: 1,
  },
  {
    id: 'cat-taxi',
    name: 'Такси',
    type: 'expense',
    icon: 'car',
    color: '#7c5cff',
    archivedAt: null,
    version: 1,
  },
]

const TRANSACTIONS: Transaction[] = [
  {
    id: 'tx-salary',
    type: 'income',
    amount: 1_500_000,
    description: 'Зарплата',
    occurredAt: dayThisMonth(3),
    version: 1,
    accountId: 'acc-card',
    categoryId: 'cat-salary',
  },
  {
    id: 'tx-freelance',
    type: 'income',
    amount: 400_000,
    description: 'Фриланс',
    occurredAt: dayThisMonth(7),
    version: 1,
    accountId: 'acc-card',
    categoryId: 'cat-salary',
  },
  {
    id: 'tx-taxi',
    type: 'expense',
    amount: 1_931_300,
    description: 'Поездка в центр',
    occurredAt: dayThisMonth(5),
    version: 1,
    accountId: 'acc-card',
    categoryId: 'cat-taxi',
  },
  {
    id: 'tx-transfer',
    type: 'transfer',
    amount: 500_000,
    description: 'Снятие наличных',
    occurredAt: dayThisMonth(4),
    version: 1,
    fromAccountId: 'acc-card',
    toAccountId: 'acc-cash',
  },
  {
    id: 'tx-prev-salary',
    type: 'income',
    amount: 1_200_000,
    description: 'Зарплата',
    occurredAt: dayPrevMonth(3),
    version: 1,
    accountId: 'acc-card',
    categoryId: 'cat-salary',
  },
]

function renderIncome() {
  const accountRepository = createMockAccountRepository(ACCOUNTS)
  const categoryRepository = createMockCategoryRepository(CATEGORIES)
  const transactionRepository = createMockTransactionRepository(TRANSACTIONS)

  render(
    <SafeAreaProvider
      initialMetrics={{ insets: ZERO_INSETS, frame: { x: 0, y: 0, width: 375, height: 812 } }}
    >
      <QueryClientProvider client={createQueryClient()}>
        <AccountRepositoryProvider repository={accountRepository}>
          <CategoryRepositoryProvider repository={categoryRepository}>
            <TransactionRepositoryProvider repository={transactionRepository}>
              <ThemeProvider>
                <BottomSheetProvider>
                  <IncomeScreen />
                </BottomSheetProvider>
              </ThemeProvider>
            </TransactionRepositoryProvider>
          </CategoryRepositoryProvider>
        </AccountRepositoryProvider>
      </QueryClientProvider>
    </SafeAreaProvider>,
  )
}

describe('IncomeScreen', () => {
  it('renders the fixed Доходы summary with the month income total only', async () => {
    renderIncome()

    expect(screen.getByTestId('screen-income')).toBeTruthy()
    await waitFor(() => expect(screen.getByText('Все доходы')).toBeTruthy())

    // The header's large title carries «Доходы»; the summary card has no
    // title of its own (the title lives in the collapsible header).
    expect(screen.getByText('Доходы')).toBeTruthy()
    // The total also appears in the category breakdown row - at least once.
    await waitFor(() =>
      expect(
        screen.getAllByText(formatAmount(totalCashflow(TRANSACTIONS, currentMonth(), 'income')))
          .length,
      ).toBeGreaterThanOrEqual(1),
    )

    // No balance-mode switch: the title is not a pressable.
    expect(screen.queryByTestId('income-summary-mode')).toBeNull()
    expect(screen.queryByTestId('home-summary-mode')).toBeNull()

    // Expenses and transfers contribute to no figure on this screen: the
    // expense amount is not rendered anywhere.
    expect(screen.queryByText(formatAmount(1_931_300))).toBeNull()

    // Income categories only in the breakdown.
    expect(screen.getByTestId('income-category-cat-salary')).toBeTruthy()
    expect(screen.queryByTestId('income-category-cat-taxi')).toBeNull()
  })

  it('navigates to the previous month and shows its income total', async () => {
    renderIncome()
    await waitFor(() => expect(screen.getByText('Все доходы')).toBeTruthy())

    fireEvent.press(screen.getByTestId('income-period-prev'))
    const prev = previousMonth(currentMonth())
    await waitFor(() =>
      expect(
        screen.getAllByText(formatAmount(totalCashflow(TRANSACTIONS, prev, 'income'))).length,
      ).toBeGreaterThanOrEqual(1),
    )
  })

  it('opens the all-incomes sheet with the period incomes grouped by day', async () => {
    renderIncome()
    await waitFor(() => expect(screen.getByText('Все доходы')).toBeTruthy())

    fireEvent.press(screen.getByTestId('income-all-incomes'))
    const expectedCount = cashflowInMonth(TRANSACTIONS, currentMonth(), 'income').length
    await waitFor(() => expect(screen.queryAllByTestId(/^income-row-/).length).toBe(expectedCount))
    expect(screen.queryByTestId('income-row-tx-taxi')).toBeNull()
    expect(screen.getByText('Список доходов')).toBeTruthy()
  })

  it('returns via the header back button', async () => {
    renderIncome()
    await waitFor(() => expect(screen.getByText('Все доходы')).toBeTruthy())

    fireEvent.press(screen.getByTestId('screen-header-back'))
    expect(mockBack).toHaveBeenCalledTimes(1)
  })
})
