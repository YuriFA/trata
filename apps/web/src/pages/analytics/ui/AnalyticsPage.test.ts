import { describe, it, expect, beforeEach, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import AnalyticsPage from './AnalyticsPage.vue'
import type { CashflowTransaction } from '@/entities/transaction'
import type { Category } from '@trata/api'
import {
  createMockAccountRepository,
  createMockCategoryRepository,
  createMockTransactionRepository,
} from '@/__tests__/helpers/mock-repositories'
import { mountWithProviders } from '@/__tests__/helpers/mount-with-providers'

function nowMonthTx(overrides: Partial<CashflowTransaction>): CashflowTransaction {
  return {
    id: 't',
    type: 'expense',
    amount: 100,
    description: '',
    occurredAt: new Date().toISOString(),
    accountId: 'a1',
    categoryId: 'c1',
    ...overrides,
  } as CashflowTransaction
}

const categories: Category[] = [
  {
    id: 'c1',
    name: 'Такси',
    type: 'expense',
    icon: 'car',
    color: '#7c5cff',
    archivedAt: null,
    version: 1,
  },
  {
    id: 'c2',
    name: 'Зарплата',
    type: 'income',
    icon: 'cash',
    color: '#3b82f6',
    archivedAt: null,
    version: 1,
  },
]

describe('AnalyticsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function mountPage(queryResults: CashflowTransaction[]) {
    const transactionsRepo = createMockTransactionRepository()
    transactionsRepo.query.mockImplementation(async (options: { type?: string }) =>
      queryResults.filter((tx) => tx.type === options.type),
    )
    const categoriesRepo = createMockCategoryRepository()
    categoriesRepo.getAll.mockResolvedValue(categories)
    const accountsRepo = createMockAccountRepository()
    accountsRepo.getAll.mockResolvedValue([])

    const wrapper = mountWithProviders(AnalyticsPage, {
      repositories: {
        transactions: transactionsRepo,
        categories: categoriesRepo,
        accounts: accountsRepo,
      },
    })
    return { wrapper, transactionsRepo }
  }

  it('renders both direction cards with totals, chart, and legend links to their detail routes', async () => {
    const { wrapper } = mountPage([
      nowMonthTx({ id: 't1', type: 'expense', amount: 30325, categoryId: 'c1' }),
      nowMonthTx({ id: 't2', type: 'income', amount: 50000, categoryId: 'c2' }),
    ])
    await flushPromises()

    const expenseCard = wrapper.find('[data-testid="analytics-card-expenses"]')
    const incomeCard = wrapper.find('[data-testid="analytics-card-income"]')
    expect(expenseCard.exists()).toBe(true)
    expect(incomeCard.exists()).toBe(true)
    expect(expenseCard.attributes('href')).toBe('/analytics/expense')
    expect(incomeCard.attributes('href')).toBe('/analytics/income')

    expect(expenseCard.find('[data-testid="donut-chart"]').exists()).toBe(true)
    expect(expenseCard.text()).toContain('₽303.25')
    expect(incomeCard.text()).toContain('₽500.00')
    expect(expenseCard.find('[data-testid="chart-legend"]').text()).toContain('Такси')
  })

  it('renders the empty direction as a neutral donut with the message in the legend slot, keeping the card selectable', async () => {
    const { wrapper } = mountPage([
      nowMonthTx({ id: 't2', type: 'income', amount: 50000, categoryId: 'c2' }),
    ])
    await flushPromises()

    const expenseCard = wrapper.find('[data-testid="analytics-card-expenses"]')
    expect(expenseCard.text()).toContain('No expenses for this period')
    expect(expenseCard.find('[data-testid="donut-chart"]').exists()).toBe(true)
    expect(expenseCard.find('[data-testid="donut-segment"]').exists()).toBe(false)
    expect(expenseCard.text()).toContain('0.00')
    expect(expenseCard.find('[data-testid="chart-legend"]').exists()).toBe(false)
    expect(expenseCard.attributes('href')).toBe('/analytics/expense')

    const incomeCard = wrapper.find('[data-testid="analytics-card-income"]')
    expect(incomeCard.find('[data-testid="donut-chart"]').exists()).toBe(true)
    expect(incomeCard.find('[data-testid="chart-legend"]').exists()).toBe(true)
  })
})
