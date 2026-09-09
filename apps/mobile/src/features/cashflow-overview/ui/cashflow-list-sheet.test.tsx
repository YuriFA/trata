// CashflowListSheet behavior over the AllCashflowCard harness (it owns the
// sheet's open flow): the opened month renders its day-grouped rows, a
// tapped row delegates to the page-composed edit action, and rows stay
// non-interactive when no edit action is composed.

import { describe, expect, it, jest, beforeEach } from '@jest/globals'
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
import { BottomSheetProvider } from '@/shared/ui/bottom-sheet/bottom-sheet-provider'
import { AllCashflowCard } from './all-cashflow-card'
import { CASHFLOW_KIND_VIEWS } from './kind'
import { currentMonth } from '../model/selectors'

// Authorship markers (household-ux 2.4) resolve against the household cache;
// the defaults are anonymous with no members (no marker renders), and the
// marker tests flip these to a multi-member household.
let mockAuth: { status: 'authenticated' | 'anonymous'; user: { id: string } | null } = {
  status: 'anonymous',
  user: null,
}
let mockMembers: readonly import('@trata/api').HouseholdMember[] | null = null

jest.mock('@/entities/session', () => ({
  ...(jest.requireActual('@/entities/session') as Record<string, unknown>),
  useAuth: () => mockAuth,
}))

jest.mock('@/entities/household', () => ({
  ...(jest.requireActual('@/entities/household') as Record<string, unknown>),
  useHousehold: () => ({ data: mockMembers ? { members: mockMembers } : undefined }),
}))

beforeEach(() => {
  mockAuth = { status: 'anonymous', user: null }
  mockMembers = null
})
const ZERO_INSETS = { top: 0, right: 0, left: 0, bottom: 0 }

function toIso(date: Date): string {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12).toISOString()
}

function dayThisMonth(day: number): string {
  const now = new Date()
  return toIso(new Date(now.getFullYear(), now.getMonth(), Math.min(day, now.getDate()), 12))
}

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
]

const TRANSACTIONS: Transaction[] = [
  {
    id: 'tx-taxi-1',
    type: 'expense',
    amount: 1_931_300,
    description: 'Поездка в центр',
    occurredAt: dayThisMonth(2),
    version: 1,
    accountId: 'acc-card',
    categoryId: 'cat-taxi',
  },
]

const { ids } = CASHFLOW_KIND_VIEWS.expense

function renderCard(onEditTransaction?: (id: string) => void) {
  const onNewTransaction = jest.fn()
  render(
    <SafeAreaProvider
      initialMetrics={{ insets: ZERO_INSETS, frame: { x: 0, y: 0, width: 375, height: 812 } }}
    >
      <QueryClientProvider client={createQueryClient()}>
        <CategoryRepositoryProvider repository={createMockCategoryRepository(CATEGORIES)}>
          <TransactionRepositoryProvider repository={createMockTransactionRepository(TRANSACTIONS)}>
            <ThemeProvider>
              <BottomSheetProvider>
                <AllCashflowCard
                  kind="expense"
                  cursor={currentMonth()}
                  transactions={TRANSACTIONS}
                  categories={CATEGORIES}
                  onNewTransaction={onNewTransaction}
                  onEditTransaction={onEditTransaction}
                />
              </BottomSheetProvider>
            </ThemeProvider>
          </TransactionRepositoryProvider>
        </CategoryRepositoryProvider>
      </QueryClientProvider>
    </SafeAreaProvider>,
  )
  return { onNewTransaction }
}

async function openListSheet() {
  fireEvent.press(screen.getByTestId(ids.allCard))
  await waitFor(() => expect(screen.getByTestId(`${ids.listRow}-tx-taxi-1`)).toBeTruthy())
}

describe('CashflowListSheet', () => {
  it('delegates a tapped row to the page-composed edit action', async () => {
    const onEditTransaction = jest.fn()
    renderCard(onEditTransaction)
    await openListSheet()

    fireEvent.press(screen.getByTestId(`${ids.listRow}-tx-taxi-1`))

    expect(onEditTransaction).toHaveBeenCalledWith('tx-taxi-1')
  })

  it('renders rows as non-interactive when no edit action is composed', async () => {
    renderCard()
    await openListSheet()

    expect(screen.getByTestId(`${ids.listRow}-tx-taxi-1`).props.accessibilityState.disabled).toBe(
      true,
    )
  })
})

describe('CashflowListSheet · authorship markers', () => {
  const ME = 'u-me'
  const SIBLING = 'u-sibling'

  function membersOf(...ids: string[]) {
    return ids.map((userId) => ({
      userId,
      email: `${userId}@example.com`,
      displayName: userId === SIBLING ? 'Жена' : null,
      role: 'owner' as const,
      joinedAt: '2026-08-01T00:00:00.000Z',
    }))
  }

  function transactionAuthoredBy(authorId: string | null): Transaction {
    return { ...TRANSACTIONS[0], authorId } as Transaction
  }

  function renderWithTransactions(transactions: Transaction[]) {
    const onNewTransaction = jest.fn()
    render(
      <SafeAreaProvider
        initialMetrics={{ insets: ZERO_INSETS, frame: { x: 0, y: 0, width: 375, height: 812 } }}
      >
        <QueryClientProvider client={createQueryClient()}>
          <CategoryRepositoryProvider repository={createMockCategoryRepository(CATEGORIES)}>
            <TransactionRepositoryProvider
              repository={createMockTransactionRepository(transactions)}
            >
              <ThemeProvider>
                <BottomSheetProvider>
                  <AllCashflowCard
                    kind="expense"
                    cursor={currentMonth()}
                    transactions={transactions}
                    categories={CATEGORIES}
                    onNewTransaction={onNewTransaction}
                  />
                </BottomSheetProvider>
              </ThemeProvider>
            </TransactionRepositoryProvider>
          </CategoryRepositoryProvider>
        </QueryClientProvider>
      </SafeAreaProvider>,
    )
  }

  it('marks a sibling-authored row with the display name', async () => {
    mockAuth = { status: 'authenticated', user: { id: ME } }
    mockMembers = membersOf(ME, SIBLING)
    renderWithTransactions([transactionAuthoredBy(SIBLING)])
    await openListSheet()

    expect(screen.getByTestId(`${ids.listRow}-tx-taxi-1-author`)).toHaveTextContent('Жена')
  })

  it('renders no marker for own, unknown, or anonymous-era records', async () => {
    mockAuth = { status: 'authenticated', user: { id: ME } }
    mockMembers = membersOf(ME, SIBLING)
    renderWithTransactions([transactionAuthoredBy(ME)])
    await openListSheet()
    expect(screen.queryByTestId(`${ids.listRow}-tx-taxi-1-author`)).toBeNull()
  })

  it('renders no marker in a single-member household', async () => {
    mockAuth = { status: 'authenticated', user: { id: ME } }
    mockMembers = membersOf(ME)
    renderWithTransactions([transactionAuthoredBy(SIBLING)])
    await openListSheet()
    expect(screen.queryByTestId(`${ids.listRow}-tx-taxi-1-author`)).toBeNull()
  })
})
