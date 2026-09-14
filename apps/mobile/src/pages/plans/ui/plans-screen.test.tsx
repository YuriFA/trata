// Plans screen tests: both cards' live counts and normalized «X ₽/мес»
// figures from ONE plans read (the spec's monthly-normalization example:
// 599,00 monthly + 6 000,00 yearly → 1 099,00 ₽/мес), empty states, and the
// card → list-sheet entry.

import { describe, expect, it, jest, beforeEach } from '@jest/globals'
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
import { createMockPlannedPaymentRepository } from '@/shared/lib/testing/mock-planned-payment-repository'
import { BottomSheetProvider } from '@/shared/ui/bottom-sheet/bottom-sheet-provider'
import type { CurrencyAggregate } from '@/shared/lib/money/aggregate'
import { monthlyTotalText } from '../model/selectors'

// Single-RUB aggregate: the exact hero path of the plans card figure.
const rubAggregate = (amount: number): CurrencyAggregate => ({
  totals: [{ currency: 'RUB', amount }],
  isMixed: false,
  converted: null,
})
import { PlansScreen } from './plans-screen'

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
const ZERO_INSETS = { top: 0, right: 0, bottom: 0, left: 0 }

// The reminder driver calls the (native) scheduler on every data change; its
// behavior is pinned by reminders.test.ts — here it is a no-op stub.
jest.mock('@/entities/planned-payment/model/reminders', () => ({
  reschedule: jest.fn(),
  requestNotificationPermissions: jest.fn(),
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
    id: 'cat-fun',
    name: 'Развлечения',
    type: 'expense',
    icon: 'film',
    color: '#7c5cff',
    archivedAt: null,
    version: 1,
  },
]

const PLANS: PlannedPayment[] = [
  {
    id: 'plan-netflix',
    type: 'expense',
    amount: 59_900, // 599,00 ₽ monthly
    name: 'Netflix',
    accountId: 'acc-main',
    categoryId: 'cat-fun',
    nextDue: '2099-01-05',
    anchorDate: '2099-01-05',
    regularity: 'monthly',
    confirmMode: 'manual',
    reminder: 'off',
    note: '',
    version: 1,
  },
  {
    id: 'plan-insurance',
    type: 'expense',
    amount: 600_000, // 6 000,00 ₽ yearly → 500,00 ₽/мес
    name: '',
    accountId: 'acc-main',
    categoryId: 'cat-fun',
    nextDue: '2099-03-01',
    anchorDate: '2099-03-01',
    regularity: 'yearly',
    confirmMode: 'manual',
    reminder: 'off',
    note: '',
    version: 1,
  },
]

function renderPlans({
  plans = PLANS,
  categories = CATEGORIES,
}: { plans?: PlannedPayment[]; categories?: Category[] } = {}) {
  const planRepository = createMockPlannedPaymentRepository(plans)
  render(
    <SafeAreaProvider
      initialMetrics={{ frame: { x: 0, y: 0, width: 0, height: 0 }, insets: ZERO_INSETS }}
    >
      <ThemeProvider>
        <QueryClientProvider client={createQueryClient()}>
          <AccountRepositoryProvider repository={createMockAccountRepository(ACCOUNTS)}>
            <CategoryRepositoryProvider repository={createMockCategoryRepository(categories)}>
              <PlannedPaymentRepositoryProvider repository={planRepository}>
                <BottomSheetProvider>
                  <PlansScreen />
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

describe('PlansScreen', () => {
  it('renders both cards with counts and normalized monthly totals', async () => {
    renderPlans()

    // 599,00 monthly + 6 000,00 yearly (÷12 = 500,00) = 1 099,00 ₽/мес.
    await waitFor(() =>
      expect(screen.getByTestId('plans-count-expense')).toHaveTextContent('2 плана'),
    )
    expect(screen.getByTestId('plans-total-expense')).toHaveTextContent(
      monthlyTotalText(rubAggregate(109_900)),
    )
    expect(screen.getByTestId('plans-count-income')).toHaveTextContent('0 планов')
    expect(screen.getByTestId('plans-total-income')).toHaveTextContent(
      monthlyTotalText(rubAggregate(0)),
    )
    expect(screen.getByText('Подписки, платежи по кредитам и прочее')).toBeTruthy()
    expect(screen.getByText('Зарплата, премии и прочее')).toBeTruthy()
  })

  it('shows zero figures on both cards when no plans exist', async () => {
    renderPlans({ plans: [] })

    await waitFor(() =>
      expect(screen.getByTestId('plans-count-expense')).toHaveTextContent('0 планов'),
    )
    expect(screen.getByTestId('plans-total-expense')).toHaveTextContent(
      monthlyTotalText(rubAggregate(0)),
    )
  })

  it('opens the per-type list sheet from a card', async () => {
    renderPlans()

    await waitFor(() => expect(screen.getByTestId('plans-card-expense')).toBeTruthy())
    // The @gorhom mock mounts sheet children only while presented.
    fireEvent.press(screen.getByTestId('plans-card-expense'))
    await waitFor(() => expect(screen.getByTestId('plans-row-plan-netflix')).toBeTruthy())
    // The unnamed plan's row title is its category name.
    expect(screen.getByTestId('plans-row-plan-insurance')).toBeTruthy()
  })

  it('loads every figure from exactly ONE plans read (perf pin)', async () => {
    const { planRepository } = renderPlans()

    await waitFor(() =>
      expect(screen.getByTestId('plans-count-expense')).toHaveTextContent('2 плана'),
    )
    await waitFor(() =>
      expect(screen.getByTestId('plans-count-income')).toHaveTextContent('0 планов'),
    )
    expect(planRepository.calls.getAll).toBe(1)
  })

  it('keeps the card figures untouched while a sheet opens', async () => {
    renderPlans()

    await waitFor(() =>
      expect(screen.getByTestId('plans-count-expense')).toHaveTextContent('2 плана'),
    )
    fireEvent.press(screen.getByTestId('plans-card-expense'))
    await waitFor(() => expect(screen.getByTestId('plans-row-plan-netflix')).toBeTruthy())
    expect(screen.getByTestId('plans-total-expense')).toHaveTextContent(
      monthlyTotalText(rubAggregate(109_900)),
    )
  })

  it('marks sibling-authored plan rows and stays clean in a single-member household', async () => {
    const ME = 'u-me'
    const SIBLING = 'u-sibling'
    mockAuth = { status: 'authenticated', user: { id: ME } }
    mockMembers = [
      {
        userId: ME,
        email: 'me@example.com',
        displayName: null,
        role: 'owner',
        joinedAt: '2026-08-01T00:00:00.000Z',
      },
      {
        userId: SIBLING,
        email: 'wife@example.com',
        displayName: 'Жена',
        role: 'member',
        joinedAt: '2026-08-02T00:00:00.000Z',
      },
    ]
    renderPlans({
      plans: [
        { ...PLANS[0], authorId: SIBLING },
        { ...PLANS[1], authorId: ME },
      ],
    })

    fireEvent.press(screen.getByTestId('plans-card-expense'))
    await waitFor(() => expect(screen.getByTestId('plans-row-plan-netflix')).toBeTruthy())
    expect(screen.getByTestId('plans-row-plan-netflix-author')).toHaveTextContent('Жена')
    expect(screen.queryByTestId('plans-row-plan-insurance-author')).toBeNull()

    // A single-member household renders no markers at all.
    mockMembers = mockMembers?.slice(0, 1) ?? null
    renderPlans({
      plans: [{ ...PLANS[0], authorId: SIBLING }],
    })
    fireEvent.press(screen.getByTestId('plans-card-expense'))
    await waitFor(() => expect(screen.getByTestId('plans-row-plan-netflix')).toBeTruthy())
    expect(screen.queryByTestId('plans-row-plan-netflix-author')).toBeNull()
  })
})
