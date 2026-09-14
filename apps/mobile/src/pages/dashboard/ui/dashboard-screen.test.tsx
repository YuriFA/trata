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
import { monthRangeLabelShort } from '@trata/dates'
import { aggregateHeroText } from '@/shared/lib/money/aggregate'
import type { MoneyPresentation } from '@/shared/lib/money/aggregate'
import {
  cashflowDayGroups,
  cashflowInMonth,
  cashflowTotal,
  currentMonth,
  previousMonth,
} from '@/features/cashflow-overview'
import { DashboardScreen } from './dashboard-screen'
import { monthlyBalance, totalBalance } from '../model/selectors'

// The suite runs anonymous: the empty account map falls back to the display
// currency (RUB) and no rates are cached, so figures stay exact single-currency.
const PRESENTATION: MoneyPresentation = {
  currencyByAccountId: new Map(),
  displayCurrency: 'RUB',
  rates: null,
}

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
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }))
// The badge mounts sync/auth infrastructure the screen test does not provide;
// it has its own test in the widget slice.
jest.mock('@/widgets/sync-status', () => ({
  SyncStatusBadge: () => null,
}))

// The suite pins the presentation context: anonymous fresh device - empty
// account map (native = display RUB), no cached rates, exact figures only.
jest.mock('@/features/cashflow-overview/model/presentation', () => ({
  useCashflowPresentation: () => ({
    currencyByAccountId: new Map(),
    displayCurrency: 'RUB',
    rates: null,
  }),
}))

const ZERO_INSETS = { top: 0, right: 0, bottom: 0, left: 0 }

// --- Date-relative domain fixtures (current month has data, previous too,
// the month before the previous is empty) ----------------------------------

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
    id: 'acc-cash',
    name: 'Наличные',
    currency: 'RUB',
    openingBalance: 500_000,
    version: 1,
  },
  {
    id: 'acc-card',
    name: 'Карта',
    currency: 'RUB',
    openingBalance: 3_200_000_000,
    version: 1,
  },
]

const CATEGORIES: Category[] = [
  {
    id: 'cat-taxi',
    name: 'Такси',
    type: 'expense',
    icon: 'car',
    color: '#7c5cff',
    archivedAt: null,
    version: 1,
  },
  {
    id: 'cat-cafe',
    name: 'Кафе',
    type: 'expense',
    icon: 'cafe',
    color: '#a78bfa',
    archivedAt: null,
    version: 1,
  },
  {
    id: 'cat-salary',
    name: 'Зарплата',
    type: 'income',
    icon: 'cash',
    color: '#16a34a',
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
    id: 'tx-taxi',
    type: 'expense',
    amount: 1_931_300,
    description: 'Поездка в центр',
    occurredAt: dayThisMonth(2),
    version: 1,
    accountId: 'acc-card',
    categoryId: 'cat-taxi',
  },
  {
    id: 'tx-cafe',
    type: 'expense',
    amount: 300_000,
    description: 'Кофе с собой',
    occurredAt: dayThisMonth(6),
    version: 1,
    accountId: 'acc-cash',
    categoryId: 'cat-cafe',
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
    amount: 1_500_000,
    description: 'Зарплата',
    occurredAt: dayPrevMonth(3),
    version: 1,
    accountId: 'acc-card',
    categoryId: 'cat-salary',
  },
  {
    id: 'tx-prev-taxi',
    type: 'expense',
    amount: 950_000,
    description: 'Поездка в аэропорт',
    occurredAt: dayPrevMonth(12),
    version: 1,
    accountId: 'acc-card',
    categoryId: 'cat-taxi',
  },
]

// The mock repository computes balances as opening + manualAdjustment.
const expectedAccounts = () =>
  ACCOUNTS.map((account) => ({
    ...account,
    balance: account.openingBalance,
  }))

function renderDashboard() {
  const accountRepository = createMockAccountRepository(ACCOUNTS)
  const categoryRepository = createMockCategoryRepository(CATEGORIES)
  const transactionRepository = createMockTransactionRepository(TRANSACTIONS)
  const queryClient = createQueryClient()

  render(
    <SafeAreaProvider
      initialMetrics={{ insets: ZERO_INSETS, frame: { x: 0, y: 0, width: 375, height: 812 } }}
    >
      <QueryClientProvider client={queryClient}>
        <AccountRepositoryProvider repository={accountRepository}>
          <CategoryRepositoryProvider repository={categoryRepository}>
            <TransactionRepositoryProvider repository={transactionRepository}>
              <ThemeProvider>
                <BottomSheetProvider>
                  <DashboardScreen />
                </BottomSheetProvider>
              </ThemeProvider>
            </TransactionRepositoryProvider>
          </CategoryRepositoryProvider>
        </AccountRepositoryProvider>
      </QueryClientProvider>
    </SafeAreaProvider>,
  )

  return { accountRepository, categoryRepository, transactionRepository }
}

const expensesRowCount = () => screen.queryAllByTestId(/^home-expense-row-/).length

describe('DashboardScreen (Home)', () => {
  it('renders the sections with the expenses total for the current month', async () => {
    renderDashboard()

    expect(screen.getByTestId('screen-dashboard')).toBeTruthy()
    await waitFor(() => expect(screen.getByText('Все расходы')).toBeTruthy())

    expect(screen.getByTestId('home-quick-accounts')).toBeTruthy()
    expect(screen.getByTestId('home-quick-income')).toBeTruthy()
    expect(screen.getByTestId('home-quick-debts')).toBeTruthy()

    expect(screen.getByText('Расходы')).toBeTruthy()
    const expected = aggregateHeroText(
      cashflowTotal(TRANSACTIONS, currentMonth(), 'expense', PRESENTATION),
    )
    await waitFor(() => expect(screen.getByText(expected)).toBeTruthy())
  })

  it('switches the summary mode via the bottom sheet', async () => {
    renderDashboard()
    await waitFor(() => expect(screen.getByText('Все расходы')).toBeTruthy())

    fireEvent.press(screen.getByTestId('home-summary-mode'))
    expect(screen.getByTestId('home-mode-sheet')).toBeTruthy()

    fireEvent.press(screen.getByTestId('home-mode-option-total-balance'))
    expect(screen.queryByTestId('home-mode-sheet')).toBeNull()
    expect(screen.getByText('Баланс общий')).toBeTruthy()
    await waitFor(() =>
      expect(
        screen.getByText(aggregateHeroText(totalBalance(expectedAccounts(), PRESENTATION))),
      ).toBeTruthy(),
    )
    fireEvent.press(screen.getByTestId('home-summary-mode'))
    fireEvent.press(screen.getByTestId('home-mode-option-monthly-balance'))
    await waitFor(() =>
      expect(
        screen.getByText(
          aggregateHeroText(monthlyBalance(TRANSACTIONS, currentMonth(), PRESENTATION)),
        ),
      ).toBeTruthy(),
    )
  })

  it('navigates to the previous month and shows its expenses total', async () => {
    renderDashboard()
    await waitFor(() => expect(screen.getByText('Все расходы')).toBeTruthy())

    fireEvent.press(screen.getByTestId('home-period-prev'))
    const prev = previousMonth(currentMonth())
    // The amount also appears in the category breakdown row - at least once.
    await waitFor(() =>
      expect(
        screen.getAllByText(
          aggregateHeroText(cashflowTotal(TRANSACTIONS, prev, 'expense', PRESENTATION)),
        ).length,
      ).toBeGreaterThanOrEqual(1),
    )
  })

  it('shows the empty state for a month without expenses', async () => {
    renderDashboard()
    await waitFor(() => expect(screen.getByText('Все расходы')).toBeTruthy())

    fireEvent.press(screen.getByTestId('home-period-prev'))
    fireEvent.press(screen.getByTestId('home-period-prev'))
    await waitFor(() =>
      expect(screen.getAllByText('В этом месяце расходов нет').length).toBeGreaterThanOrEqual(1),
    )
  })

  it('opens the all-expenses sheet with the period expenses grouped by day', async () => {
    renderDashboard()
    await waitFor(() => expect(screen.getByText('Все расходы')).toBeTruthy())

    fireEvent.press(screen.getByTestId('home-all-expenses'))
    const expectedCount = cashflowInMonth(TRANSACTIONS, currentMonth(), 'expense').length
    await waitFor(() => expect(expensesRowCount()).toBe(expectedCount))

    // Subtitle: the selected period range plus its expense total.
    const now = new Date()
    const expectedSubtitle = `${monthRangeLabelShort(now.getFullYear(), now.getMonth())}, ${aggregateHeroText(
      cashflowTotal(TRANSACTIONS, currentMonth(), 'expense', PRESENTATION),
    )}`
    expect(screen.getByText(expectedSubtitle)).toBeTruthy()

    // One day header per distinct expense day of the period.
    expect(screen.queryAllByTestId(/^home-expense-day-/).length).toBe(
      cashflowDayGroups(TRANSACTIONS, CATEGORIES, currentMonth(), 'expense', PRESENTATION).length,
    )
  })

  it('opens a new-expense sheet from the sheet footer button', async () => {
    renderDashboard()
    await waitFor(() => expect(screen.getByText('Все расходы')).toBeTruthy())

    fireEvent.press(screen.getByTestId('home-all-expenses'))
    await waitFor(() => expect(screen.getByTestId('home-new-expense-button')).toBeTruthy())
    fireEvent.press(screen.getByTestId('home-new-expense-button'))
    await waitFor(() => expect(screen.getByTestId('home-new-expense-sheet')).toBeTruthy())
  })

  it('opens a category-filtered expense sheet', async () => {
    renderDashboard()
    await waitFor(() => expect(screen.getByText('Все расходы')).toBeTruthy())

    await waitFor(() => expect(screen.getByTestId('home-category-cat-taxi')).toBeTruthy())
    fireEvent.press(screen.getByTestId('home-category-cat-taxi'))
    expect(screen.getByTestId('category-expenses-sheet')).toBeTruthy()
    await waitFor(() =>
      expect(screen.queryAllByTestId(/^category-expense-row-/).length).toBe(
        cashflowInMonth(TRANSACTIONS, currentMonth(), 'expense').filter(
          (t) => t.categoryId === 'cat-taxi',
        ).length,
      ),
    )
  })

  it('creates a category through the sheet and shows it afterwards', async () => {
    const { categoryRepository } = renderDashboard()
    await waitFor(() => expect(screen.getByText('Все расходы')).toBeTruthy())

    fireEvent.press(screen.getByTestId('home-new-category'))
    expect(screen.getByTestId('home-new-category-sheet')).toBeTruthy()

    fireEvent.changeText(screen.getByTestId('home-new-category-name'), 'Транспорт')
    fireEvent.press(screen.getByTestId('home-new-category-type-income'))
    fireEvent.press(screen.getByTestId('home-new-category-icon-💼'))
    fireEvent.press(screen.getByTestId('home-new-category-submit'))

    await waitFor(() => expect(categoryRepository.snapshot()).toHaveLength(4))
    // Form resets after a successful submit.
    await waitFor(() => expect(screen.getByTestId('home-new-category-name').props.value).toBe(''))
  })
})
