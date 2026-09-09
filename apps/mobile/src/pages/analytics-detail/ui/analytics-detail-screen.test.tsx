import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals'
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { QueryClientProvider } from '@tanstack/react-query'
import type { Category, Transaction } from '@trata/api'
import { currentPeriod, periodRangeLabel, shiftPeriod, type PeriodCursor } from '@trata/dates'
import { ThemeProvider } from '@/shared/config/theme'
import { createQueryClient } from '@/shared/lib/query/query-client'
import { CategoryRepositoryProvider } from '@/entities/category'
import { createMockCategoryRepository } from '@/shared/lib/testing/mock-category-repository'
import { TransactionRepositoryProvider } from '@/entities/transaction'
import { createMockTransactionRepository } from '@/shared/lib/testing/mock-transaction-repository'
import type { AnalyticsDirection } from '@/features/analytics'
import { AnalyticsDetailScreen } from './analytics-detail-screen'

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
// ScreenHeader's back affordance defaults to router.back() (mocked; this
// screen itself never navigates programmatically).
const mockBack = jest.fn()
jest.mock('expo-router', () => ({ useRouter: () => ({ back: mockBack }) }))

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

// The screen derives "current period" from the wall clock, and the fixtures
// hardcode mid-August 2026 (the current week must be empty, the month must
// carry both rows). Freeze the clock there so the suite is deterministic on
// any run date; RNTL's waitFor advances the fake timers while polling.
beforeAll(() => {
  jest.useFakeTimers({ now: new Date('2026-08-14T09:00:00') })
})

afterAll(() => {
  jest.useRealTimers()
})

const TRANSACTIONS: Transaction[] = [
  {
    id: 'tx-taxi',
    type: 'expense',
    amount: 400_000,
    occurredAt: '2026-08-10T12:00:00.000Z',
    version: 1,
    accountId: 'acc-1',
    categoryId: 'cat-taxi',
  },
  {
    id: 'tx-cafe',
    type: 'expense',
    amount: 100_000,
    occurredAt: '2026-08-12T12:00:00.000Z',
    version: 1,
    accountId: 'acc-1',
    categoryId: 'cat-cafe',
  },
]

function renderScreen(direction: AnalyticsDirection = 'expense') {
  render(
    <SafeAreaProvider
      initialMetrics={{ insets: ZERO_INSETS, frame: { x: 0, y: 0, width: 375, height: 812 } }}
    >
      <QueryClientProvider client={createQueryClient()}>
        <CategoryRepositoryProvider repository={createMockCategoryRepository(CATEGORIES)}>
          <TransactionRepositoryProvider repository={createMockTransactionRepository(TRANSACTIONS)}>
            <ThemeProvider>
              <AnalyticsDetailScreen direction={direction} />
            </ThemeProvider>
          </TransactionRepositoryProvider>
        </CategoryRepositoryProvider>
      </QueryClientProvider>
    </SafeAreaProvider>,
  )
}

/** The chart center always carries the UPPER-CASED range label (a period
 *  without data still renders the full layout with zeroed figures). */
const centerLabel = (cursor: PeriodCursor) => periodRangeLabel(cursor).toUpperCase()

function checkboxChecked(testID: string): boolean {
  return Boolean(screen.getByTestId(testID).props.accessibilityState?.checked)
}

describe('AnalyticsDetailScreen', () => {
  it('opens on the current month with the breakdown, totals, and percentages', async () => {
    renderScreen()

    await waitFor(() => expect(screen.getByText('80%')).toBeTruthy())
    expect(screen.getByText(centerLabel(currentPeriod('month')))).toBeTruthy()
    // 400 000 + 100 000 minor = 5 000 ₽ total (total line + summary row);
    // 80% / 20% shares.
    expect(screen.getAllByText('5 000 ₽')).toHaveLength(2)
    expect(screen.getByText('4 000 ₽')).toBeTruthy()
    expect(screen.getByText('80%')).toBeTruthy()
    expect(screen.getByText('1 000 ₽')).toBeTruthy()
    expect(screen.getByText('20%')).toBeTruthy()
    expect(screen.getByText('Все расходы')).toBeTruthy()
    expect(screen.getByTestId('analytics-category-cat-taxi')).toBeTruthy()
    expect(screen.getByTestId('analytics-category-cat-cafe')).toBeTruthy()
    // All checkboxes start checked.
    expect(checkboxChecked('analytics-total-check')).toBe(true)
    expect(checkboxChecked('analytics-category-check-cat-taxi')).toBe(true)
  })

  it('switching the period kind resets to the current period of that kind', async () => {
    renderScreen()
    await waitFor(() => expect(screen.getByTestId('analytics-total-row')).toBeTruthy())

    // The fixtures are mid-August, so the current week is empty: same full
    // layout, zeroed figures (no empty-state card anymore).
    fireEvent.press(screen.getByTestId('analytics-period-week'))
    await waitFor(() => expect(screen.getByText(centerLabel(currentPeriod('week')))).toBeTruthy())
    expect(screen.getAllByText('0%')).toHaveLength(2)
    expect(checkboxChecked('analytics-category-check-cat-taxi')).toBe(true)

    fireEvent.press(screen.getByTestId('analytics-period-year'))
    await waitFor(() => expect(screen.getByText(centerLabel(currentPeriod('year')))).toBeTruthy())
  })

  it('arrows step to the adjacent period and update the range label', async () => {
    renderScreen()
    await waitFor(() => expect(screen.getByTestId('analytics-total-row')).toBeTruthy())

    fireEvent.press(screen.getByTestId('analytics-period-prev'))
    await waitFor(() =>
      expect(screen.getByText(centerLabel(shiftPeriod(currentPeriod('month'), -1)))).toBeTruthy(),
    )

    fireEvent.press(screen.getByTestId('analytics-period-next'))
    fireEvent.press(screen.getByTestId('analytics-period-next'))
    await waitFor(() =>
      expect(screen.getByText(centerLabel(shiftPeriod(currentPeriod('month'), 1)))).toBeTruthy(),
    )
  })

  it('renders the same full layout with zeroed figures for a period without data', async () => {
    renderScreen()
    await waitFor(() => expect(screen.getByTestId('analytics-total-row')).toBeTruthy())

    fireEvent.press(screen.getByTestId('analytics-period-next'))
    await waitFor(() =>
      expect(screen.getByText(centerLabel(shiftPeriod(currentPeriod('month'), 1)))).toBeTruthy(),
    )
    // Total line and summary row show 0; every direction category is listed
    // with a 0 amount and 0%.
    expect(screen.getAllByText('0 ₽').length).toBeGreaterThanOrEqual(4)
    expect(screen.getAllByText('0%')).toHaveLength(2)
    expect(screen.getByTestId('analytics-category-cat-taxi')).toBeTruthy()
    expect(screen.getByTestId('analytics-category-cat-cafe')).toBeTruthy()
  })

  it('renders the income copy for the income direction', async () => {
    renderScreen('income')

    await waitFor(() => expect(screen.getByTestId('analytics-category-cat-salary')).toBeTruthy())
    expect(screen.getByText('Все доходы')).toBeTruthy()
    expect(screen.getAllByText('0 ₽').length).toBeGreaterThanOrEqual(2)
  })

  it('unchecking a category clears its checkbox; the master follows the remaining state', async () => {
    renderScreen()
    await waitFor(() =>
      expect(screen.getByTestId('analytics-category-check-cat-cafe')).toBeTruthy(),
    )

    fireEvent.press(screen.getByTestId('analytics-category-check-cat-cafe'))
    expect(checkboxChecked('analytics-category-check-cat-cafe')).toBe(false)
    expect(checkboxChecked('analytics-category-check-cat-taxi')).toBe(true)
    // Some-but-not-all included → master off; row figures keep full-total
    // semantics (percentages unchanged).
    expect(checkboxChecked('analytics-total-check')).toBe(false)
    expect(screen.getByText('20%')).toBeTruthy()

    // Master off (some unchecked) → tapping it includes everything again;
    // master on → tapping it excludes everything.
    fireEvent.press(screen.getByTestId('analytics-total-check'))
    expect(checkboxChecked('analytics-category-check-cat-taxi')).toBe(true)
    expect(checkboxChecked('analytics-category-check-cat-cafe')).toBe(true)
    fireEvent.press(screen.getByTestId('analytics-total-check'))
    expect(checkboxChecked('analytics-category-check-cat-taxi')).toBe(false)
    expect(checkboxChecked('analytics-category-check-cat-cafe')).toBe(false)
  })

  it('tapping a category row opens the period-scoped category sheet', async () => {
    renderScreen()
    await waitFor(() => expect(screen.getByTestId('analytics-category-cat-taxi')).toBeTruthy())

    fireEvent.press(screen.getByTestId('analytics-category-cat-taxi'))
    await waitFor(() => expect(screen.getByTestId('category-expenses-period')).toBeTruthy())
    // Opens at the screen's current period (period-mode label, month kind).
    expect(screen.getByText(periodRangeLabel(currentPeriod('month')))).toBeTruthy()
  })

  it('resets filtering when the period changes', async () => {
    renderScreen()
    await waitFor(() =>
      expect(screen.getByTestId('analytics-category-check-cat-taxi')).toBeTruthy(),
    )

    fireEvent.press(screen.getByTestId('analytics-category-check-cat-taxi'))
    expect(checkboxChecked('analytics-category-check-cat-taxi')).toBe(false)

    // Step away (empty week) and back to the month: filtering reset, the
    // checkbox renders checked again.
    fireEvent.press(screen.getByTestId('analytics-period-week'))
    fireEvent.press(screen.getByTestId('analytics-period-month'))
    await waitFor(() =>
      expect(screen.getByTestId('analytics-category-check-cat-taxi')).toBeTruthy(),
    )
    expect(checkboxChecked('analytics-category-check-cat-taxi')).toBe(true)
  })
})
