import { describe, it, expect, vi, beforeEach } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import {
  calendarDayKey,
  currentPeriod,
  monthLabel,
  periodToUtcDayRange,
  shiftPeriod,
} from '@trata/dates'
import DashboardPage from './DashboardPage.vue'
import { formatMoneyCompact } from '@/shared/lib/money'
import type { PlannedPayment } from '@/entities/planned-payment'
import {
  createMockAccountRepository,
  createMockPlannedPaymentRepository,
  createMockCategoryRepository,
  createMockDebtorRepository,
  createMockDebtOperationRepository,
  createMockTransactionRepository,
} from '@/__tests__/helpers/mock-repositories'
import { mountWithProviders } from '@/__tests__/helpers/mount-with-providers'

const currentRange = () => periodToUtcDayRange(currentPeriod('month'))
const previousRange = () => periodToUtcDayRange(shiftPeriod(currentPeriod('month'), -1))
const previousCaption = () => {
  const cursor = shiftPeriod(currentPeriod('month'), -1)
  // Component tests run under the 'en' locale (see src/__tests__/setup.ts).
  return `${monthLabel(cursor.start.getFullYear(), cursor.start.getMonth(), 'en')} ${cursor.start.getFullYear()}`
}

const mountPage = () => {
  const transactionsRepo = createMockTransactionRepository()
  transactionsRepo.query.mockResolvedValue([])
  const wrapper = mountWithProviders(DashboardPage, {
    repositories: {
      transactions: transactionsRepo,
      accounts: createMockAccountRepository(),
      categories: createMockCategoryRepository(),
      debtors: createMockDebtorRepository(),
      debtOperations: createMockDebtOperationRepository(),
    },
  })
  return { wrapper, transactionsRepo }
}

const breakdownText = (wrapper: ReturnType<typeof mountPage>['wrapper']) =>
  wrapper.find('[data-testid="dashboard-category-breakdown"]').text()

const statLinks = (wrapper: ReturnType<typeof mountPage>['wrapper']) =>
  wrapper
    .find('[data-testid="dashboard-stats"]')
    .findAll('a')
    .map((a) => a.attributes('href') ?? '')

// Mirrors the deep-link bounds: local calendar-day first/last day of the month.
const monthQueryBounds = (cursor: ReturnType<typeof currentPeriod>) => {
  const end = new Date(cursor.start.getFullYear(), cursor.start.getMonth() + 1, 0)
  return { from: calendarDayKey(cursor.start), to: calendarDayKey(end) }
}

describe('DashboardPage month navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('starts on the current month with the forward step disabled', async () => {
    const { wrapper, transactionsRepo } = mountPage()
    await flushPromises()
    const expected = currentRange()
    expect(transactionsRepo.query).toHaveBeenCalledWith(
      expect.objectContaining({ fromDate: expected.fromDate, toDate: expected.toDate }),
    )
    expect(wrapper.find('[data-testid="period-nav-next"]').attributes('disabled')).toBeDefined()
  })

  it('re-scopes month-bound queries when stepping to the previous month', async () => {
    const { wrapper, transactionsRepo } = mountPage()
    await flushPromises()
    vi.clearAllMocks()
    transactionsRepo.query.mockResolvedValue([])

    await wrapper.find('[data-testid="period-nav-prev"]').trigger('click')
    await flushPromises()

    const expected = previousRange()
    expect(transactionsRepo.query).toHaveBeenCalledWith(
      expect.objectContaining({ fromDate: expected.fromDate, toDate: expected.toDate }),
    )
    expect(wrapper.find('[data-testid="period-nav-label"]').text()).toBe(previousCaption())
    // Forward stepping unlocks once the cursor left the current month.
    expect(wrapper.find('[data-testid="period-nav-next"]').attributes('disabled')).toBeUndefined()
  })

  it('re-scopes the category breakdown with the month', async () => {
    const transactionsRepo = createMockTransactionRepository()
    // The mock returns the same current-month expense for every query; only
    // the attribution cursor decides whether the breakdown shows it.
    const currentMonthExpense = {
      id: 't1',
      type: 'expense',
      amount: 4250,
      description: '',
      occurredAt: new Date().toISOString(),
      accountId: 'a1',
      categoryId: 'cfood',
    } as never
    transactionsRepo.query.mockResolvedValue([currentMonthExpense])
    const categoriesRepo = createMockCategoryRepository()
    categoriesRepo.getAll.mockResolvedValue([
      {
        version: 1,
        id: 'cfood',
        name: 'Food',
        type: 'expense',
        icon: '🍔',
        color: '#FF0000',
        archivedAt: null,
        slug: 'food',
      },
    ])
    const wrapper = mountWithProviders(DashboardPage, {
      repositories: {
        transactions: transactionsRepo,
        accounts: createMockAccountRepository(),
        categories: categoriesRepo,
        debtors: createMockDebtorRepository(),
        debtOperations: createMockDebtOperationRepository(),
      },
    })
    await flushPromises()

    expect(breakdownText(wrapper)).toContain('Food')

    vi.clearAllMocks()
    transactionsRepo.query.mockResolvedValue([currentMonthExpense])
    await wrapper.find('[data-testid="period-nav-prev"]').trigger('click')
    await flushPromises()

    expect(breakdownText(wrapper)).not.toContain('Food')

    await wrapper.find('[data-testid="period-nav-next"]').trigger('click')
    await flushPromises()

    expect(breakdownText(wrapper)).toContain('Food')
  })
})

describe('DashboardPage stat card links', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('links each stat card to its screen, carrying the selected month for income/expenses', async () => {
    const { wrapper } = mountPage()
    await flushPromises()

    const hrefs = statLinks(wrapper)
    const bounds = monthQueryBounds(currentPeriod('month'))

    expect(hrefs.some((h) => h === '/accounts')).toBe(true)
    expect(hrefs.some((h) => h === '/debts')).toBe(true)
    for (const type of ['income', 'expense']) {
      expect(
        hrefs.some(
          (h) =>
            h.startsWith(`/transactions?`) &&
            h.includes(`type=${type}`) &&
            h.includes(`from=${bounds.from}`) &&
            h.includes(`to=${bounds.to}`),
        ),
      ).toBe(true)
    }
    // Snapshot cards carry no date filter.
    expect(hrefs.filter((h) => h.includes('from=')).length).toBe(2)
  })

  it('re-scopes the income/expense link bounds when stepping to the previous month', async () => {
    const { wrapper } = mountPage()
    await flushPromises()

    await wrapper.find('[data-testid="period-nav-prev"]').trigger('click')
    await flushPromises()

    const hrefs = statLinks(wrapper)
    const bounds = monthQueryBounds(shiftPeriod(currentPeriod('month'), -1))

    expect(
      hrefs.some(
        (h) =>
          h.includes('type=income') &&
          h.includes(`from=${bounds.from}`) &&
          h.includes(`to=${bounds.to}`),
      ),
    ).toBe(true)
    expect(
      hrefs.some(
        (h) =>
          h.includes('type=expense') &&
          h.includes(`from=${bounds.from}`) &&
          h.includes(`to=${bounds.to}`),
      ),
    ).toBe(true)
  })

  it('renders dashboard-scale figures compacted so they fit the tile', async () => {
    // The screenshot overflow case: a debt of 1 000 100,00 must abbreviate,
    // not paint over the neighbouring card at half mobile width.
    const debtorsRepo = createMockDebtorRepository()
    debtorsRepo.getAll.mockResolvedValue([{ id: 'd1', name: 'Анна', currency: 'RUB', version: 1 }])
    const debtOperationsRepo = createMockDebtOperationRepository()
    debtOperationsRepo.query.mockResolvedValue([
      {
        id: 'op1',
        debtorId: 'd1',
        direction: 'receivable',
        kind: 'debt',
        amount: 100_010_000,
        occurredAt: new Date().toISOString(),
        version: 1,
      },
    ])
    const wrapper = mountWithProviders(DashboardPage, {
      repositories: {
        transactions: createMockTransactionRepository(),
        accounts: createMockAccountRepository(),
        categories: createMockCategoryRepository(),
        debtors: debtorsRepo,
        debtOperations: debtOperationsRepo,
      },
    })
    await flushPromises()

    // Component tests run under 'en' (see src/__tests__/setup.ts), so the
    // compact million suffix is the latin "M".
    const debtsLink = wrapper
      .find('[data-testid="dashboard-stats"]')
      .findAll('a')
      .find((a) => (a.attributes('href') ?? '').startsWith('/debts'))
    expect(debtsLink?.text()).toContain('1M')
  })
})

// The income/expense tiles must each sum their own direction's query result.
// Regression: the expenses tile computed from the income query's data and
// rendered 0 no matter what expenses the month held.
describe('DashboardPage stat amounts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sums current-month expenses into the expenses tile and incomes into the income tile', async () => {
    const occurredAt = new Date().toISOString()
    const expenses = [
      {
        id: 'e1',
        type: 'expense',
        amount: 4250,
        description: '',
        occurredAt,
        accountId: 'a1',
        categoryId: 'c1',
      },
      {
        id: 'e2',
        type: 'expense',
        amount: 10_000,
        description: '',
        occurredAt,
        accountId: 'a1',
        categoryId: 'c1',
      },
    ]
    const incomes = [
      {
        id: 'i1',
        type: 'income',
        amount: 90_000,
        description: '',
        occurredAt,
        accountId: 'a1',
        categoryId: null,
      },
    ]
    const transactionsRepo = createMockTransactionRepository()
    transactionsRepo.query.mockImplementation(((options: { type?: string }) =>
      options.type === 'expense' ? expenses : options.type === 'income' ? incomes : []) as never)
    const accountsRepo = createMockAccountRepository()
    accountsRepo.getAll.mockResolvedValue([
      { id: 'a1', name: 'Card', currency: 'RUB', openingBalance: 0, balance: 0, version: 1 },
    ])
    const wrapper = mountWithProviders(DashboardPage, {
      repositories: {
        transactions: transactionsRepo,
        accounts: accountsRepo,
        categories: createMockCategoryRepository(),
        debtors: createMockDebtorRepository(),
        debtOperations: createMockDebtOperationRepository(),
      },
    })
    await flushPromises()

    const tileAmount = (type: 'income' | 'expense') =>
      wrapper
        .find('[data-testid="dashboard-stats"]')
        .findAll('a')
        .find((a) => (a.attributes('href') ?? '').includes(`type=${type}`))
        ?.find('[data-testid="stat-card-amount"]')
        .text()

    // Single-currency (RUB) month: exact per-currency figures, no «≈» mark.
    expect(tileAmount('expense')).toBe(formatMoneyCompact(14_250, 'RUB', 'en'))
    expect(tileAmount('income')).toBe(formatMoneyCompact(90_000, 'RUB', 'en'))
  })
})

// Attention card (web-push change, ADR-0007): overdue + due today/tomorrow
// plans with one-tap confirm; hidden when nothing is due; period-independent.
describe('DashboardPage attention card', () => {
  const dayKey = (offsetDays: number) => {
    const date = new Date()
    date.setDate(date.getDate() + offsetDays)
    return date.toISOString().slice(0, 10)
  }

  const mountWithPlans = (plans: PlannedPayment[]) => {
    const plannedPaymentsRepo = createMockPlannedPaymentRepository()
    plannedPaymentsRepo.query.mockResolvedValue(plans)
    const wrapper = mountWithProviders(DashboardPage, {
      repositories: {
        transactions: (() => {
          const repo = createMockTransactionRepository()
          repo.query.mockResolvedValue([])
          return repo
        })(),
        accounts: createMockAccountRepository(),
        categories: createMockCategoryRepository(),
        debtors: createMockDebtorRepository(),
        debtOperations: createMockDebtOperationRepository(),
        plannedPayments: plannedPaymentsRepo,
      },
    })
    return wrapper
  }

  it('lists overdue and imminent plans with confirm actions, overdue first', async () => {
    const wrapper = mountWithPlans([
      {
        id: 'p-future',
        type: 'expense',
        amount: 59900,
        name: 'Netflix',
        accountId: 'a1',
        categoryId: 'c1',
        nextDue: dayKey(5),
        anchorDate: dayKey(5),
        regularity: 'monthly',
        confirmMode: 'manual',
        reminder: 'off',
        note: '',
        version: 1,
      },
      {
        id: 'p-tomorrow',
        type: 'expense',
        amount: 240000,
        name: 'Квартплата',
        accountId: 'a1',
        categoryId: 'c1',
        nextDue: dayKey(1),
        anchorDate: dayKey(1),
        regularity: 'monthly',
        confirmMode: 'manual',
        reminder: 'day_before',
        note: '',
        version: 1,
      },
      {
        id: 'p-overdue',
        type: 'expense',
        amount: 1200,
        name: '',
        accountId: 'a1',
        categoryId: 'c1',
        nextDue: dayKey(-3),
        anchorDate: dayKey(-3),
        regularity: 'weekly',
        confirmMode: 'manual',
        reminder: 'on_day',
        note: '',
        version: 1,
      },
    ])
    await flushPromises()

    const card = wrapper.find('[data-testid="dashboard-attention-card"]')
    expect(card.exists()).toBe(true)
    const rowIds = card.findAll('li').map((li) => li.attributes('data-testid'))
    expect(rowIds).toEqual(['attention-plan-p-overdue', 'attention-plan-p-tomorrow'])
    expect(card.find('[data-testid="attention-plan-p-overdue-overdue"]').exists()).toBe(true)
    expect(card.find('[data-testid="attention-plan-p-tomorrow-confirm"]').exists()).toBe(true)
  })

  it('is hidden entirely when nothing is overdue or due within the window', async () => {
    const wrapper = mountWithPlans([
      {
        id: 'p-future',
        type: 'expense',
        amount: 59900,
        name: 'Netflix',
        accountId: 'a1',
        categoryId: 'c1',
        nextDue: dayKey(3),
        anchorDate: dayKey(3),
        regularity: 'monthly',
        confirmMode: 'manual',
        reminder: 'off',
        note: '',
        version: 1,
      },
    ])
    await flushPromises()

    expect(wrapper.find('[data-testid="dashboard-attention-card"]').exists()).toBe(false)
  })

  it('ignores the dashboard period cursor (a past month does not change the card)', async () => {
    const wrapper = mountWithPlans([
      {
        id: 'p-overdue',
        type: 'expense',
        amount: 1200,
        name: '',
        accountId: 'a1',
        categoryId: 'c1',
        nextDue: dayKey(-3),
        anchorDate: dayKey(-3),
        regularity: 'weekly',
        confirmMode: 'manual',
        reminder: 'on_day',
        note: '',
        version: 1,
      },
    ])
    await flushPromises()

    await wrapper.find('[data-testid="period-nav-prev"]').trigger('click')
    await flushPromises()

    const card = wrapper.find('[data-testid="dashboard-attention-card"]')
    expect(card.exists()).toBe(true)
    expect(card.find('[data-testid="attention-plan-p-overdue"]').exists()).toBe(true)
  })
})
