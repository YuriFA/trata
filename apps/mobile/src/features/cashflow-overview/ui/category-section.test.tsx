import { describe, expect, it, jest } from '@jest/globals'
import { render, screen } from '@testing-library/react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from '@/shared/config/theme'
import { createQueryClient } from '@/shared/lib/query/query-client'
import { CategoryRepositoryProvider } from '@/entities/category'
import { createMockCategoryRepository } from '@/shared/lib/testing/mock-category-repository'
import { TransactionRepositoryProvider } from '@/entities/transaction'
import { createMockTransactionRepository } from '@/shared/lib/testing/mock-transaction-repository'
import { CategorySection } from './category-section'
import { currentMonth } from '../model/selectors'

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

// Empty category repository reaches the "no categories yet" branch.
function renderSection(kind: 'income' | 'expense' = 'expense') {
  const categoryRepository = createMockCategoryRepository([])
  const transactionRepository = createMockTransactionRepository([])

  return render(
    <SafeAreaProvider
      initialMetrics={{ insets: ZERO_INSETS, frame: { x: 0, y: 0, width: 375, height: 812 } }}
    >
      <QueryClientProvider client={createQueryClient()}>
        <CategoryRepositoryProvider repository={categoryRepository}>
          <TransactionRepositoryProvider repository={transactionRepository}>
            <ThemeProvider>
              <CategorySection
                kind={kind}
                cursor={currentMonth()}
                transactions={[]}
                categories={[]}
                onNewTransaction={jest.fn()}
              />
            </ThemeProvider>
          </TransactionRepositoryProvider>
        </CategoryRepositoryProvider>
      </QueryClientProvider>
    </SafeAreaProvider>,
  )
}

describe('CategorySection (empty states)', () => {
  it('offers category creation when the user has none', () => {
    renderSection()
    expect(screen.getByText('Нет категорий')).toBeTruthy()
    expect(screen.getByTestId('home-new-category')).toBeTruthy()
  })

  it('uses the income wording and ids for the income kind', () => {
    renderSection('income')
    expect(screen.getByText('Нет категорий')).toBeTruthy()
    expect(screen.getByText('Создайте первую категорию, чтобы записывать доходы')).toBeTruthy()
    expect(screen.getByTestId('income-new-category')).toBeTruthy()
  })
})
