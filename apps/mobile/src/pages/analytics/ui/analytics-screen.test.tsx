import { describe, expect, it, jest } from '@jest/globals'
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { QueryClientProvider } from '@tanstack/react-query'
import type { Category, Transaction } from '@trata/api'
import { ThemeProvider } from '@/shared/config/theme'
import { createQueryClient } from '@/shared/lib/query/query-client'
import { CategoryRepositoryProvider } from '@/entities/category'
import { createMockCategoryRepository } from '@/shared/lib/testing/mock-category-repository'
import { TransactionRepositoryProvider } from '@/entities/transaction'
import { createMockTransactionRepository } from '@/shared/lib/testing/mock-transaction-repository'
import { AnalyticsScreen } from './analytics-screen'

const mockPush = jest.fn()
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }))

const ZERO_INSETS = { top: 0, right: 0, bottom: 0, left: 0 }

const CATEGORIES: Category[] = [
  {
    id: 'cat-taxi',
    name: 'Такси',
    type: 'expense',
    icon: 'car',
    color: '#6366f1',
    archivedAt: null,
    version: 1,
  },
  {
    id: 'cat-cafe',
    name: 'Кафе',
    type: 'expense',
    icon: 'cafe',
    color: '#f97316',
    archivedAt: null,
    version: 1,
  },
  {
    id: 'cat-salary',
    name: 'Зарплата',
    type: 'income',
    icon: 'cash',
    color: '#22c55e',
    archivedAt: null,
    version: 1,
  },
]

// Date-relative helpers (the dashboard-suite convention): current-month rows
// sit on distinct clamped days, outside-month rows on the previous month.
function toIso(date: Date): string {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12).toISOString()
}

function dayThisMonth(day: number): string {
  const now = new Date()
  return toIso(new Date(now.getFullYear(), now.getMonth(), Math.min(day, now.getDate()), 12))
}

function dayPrevMonth(day: number): string {
  const prev = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1)
  const lastDay = new Date(prev.getFullYear(), prev.getMonth() + 1, 0).getDate()
  return toIso(new Date(prev.getFullYear(), prev.getMonth(), Math.min(day, lastDay), 12))
}

const TRANSACTIONS: Transaction[] = [
  {
    id: 'tx-taxi',
    type: 'expense',
    amount: 400_000,
    occurredAt: dayThisMonth(2),
    version: 1,
    accountId: 'acc-1',
    categoryId: 'cat-taxi',
  },
  {
    id: 'tx-cafe',
    type: 'expense',
    amount: 100_000,
    occurredAt: dayThisMonth(4),
    version: 1,
    accountId: 'acc-1',
    categoryId: 'cat-cafe',
  },
  {
    id: 'tx-salary',
    type: 'income',
    amount: 1_000_000,
    occurredAt: dayThisMonth(1),
    version: 1,
    accountId: 'acc-1',
    categoryId: 'cat-salary',
  },
  // Outside the current month: must not appear in any card.
  {
    id: 'tx-jul',
    type: 'expense',
    amount: 700_000,
    occurredAt: dayPrevMonth(15),
    version: 1,
    accountId: 'acc-1',
    categoryId: 'cat-taxi',
  },
  // Transfers are neither income nor expense.
  {
    id: 'tx-transfer',
    type: 'transfer',
    amount: 50_000,
    occurredAt: dayThisMonth(3),
    version: 1,
    fromAccountId: 'acc-1',
    toAccountId: 'acc-2',
  },
]

function renderScreen(transactions: Transaction[] = TRANSACTIONS) {
  render(
    <SafeAreaProvider
      initialMetrics={{ insets: ZERO_INSETS, frame: { x: 0, y: 0, width: 375, height: 812 } }}
    >
      <QueryClientProvider client={createQueryClient()}>
        <CategoryRepositoryProvider repository={createMockCategoryRepository(CATEGORIES)}>
          <TransactionRepositoryProvider repository={createMockTransactionRepository(transactions)}>
            <ThemeProvider>
              <AnalyticsScreen />
            </ThemeProvider>
          </TransactionRepositoryProvider>
        </CategoryRepositoryProvider>
      </QueryClientProvider>
    </SafeAreaProvider>,
  )
}

describe('AnalyticsScreen', () => {
  it('renders both cards with month totals and legends for the current month', async () => {
    renderScreen()

    await waitFor(() =>
      expect(screen.getByTestId('analytics-card-expenses-legend-cat-taxi')).toBeTruthy(),
    )
    expect(screen.getByTestId('analytics-card-expenses-legend-cat-cafe')).toBeTruthy()
    expect(screen.getByTestId('analytics-card-income-legend-cat-salary')).toBeTruthy()
    // 400 000 + 100 000 minor = 5 000 ₽; income = 10 000 ₽.
    expect(screen.getByText('5 000 ₽')).toBeTruthy()
    expect(screen.getByText('10 000 ₽')).toBeTruthy()
  })

  it('navigates to the direction detail screen on card press', async () => {
    renderScreen()
    await waitFor(() =>
      expect(screen.getByTestId('analytics-card-expenses-legend-cat-taxi')).toBeTruthy(),
    )

    fireEvent.press(screen.getByTestId('analytics-card-expenses'))
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/analytics-detail',
      params: { type: 'expense' },
    })

    fireEvent.press(screen.getByTestId('analytics-card-income'))
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/analytics-detail',
      params: { type: 'income' },
    })
  })

  it('shows the empty state when the month has no movement of a direction', async () => {
    renderScreen(TRANSACTIONS.filter((t) => t.type !== 'income'))

    // Wait for the expenses card's data before asserting the income empty state.
    await waitFor(() =>
      expect(screen.getByTestId('analytics-card-expenses-legend-cat-taxi')).toBeTruthy(),
    )
    expect(screen.getByText('Нет доходов за этот период')).toBeTruthy()
    expect(screen.getByTestId('analytics-card-income')).toBeTruthy()
    expect(screen.getByText('5 000 ₽')).toBeTruthy()
  })
})
