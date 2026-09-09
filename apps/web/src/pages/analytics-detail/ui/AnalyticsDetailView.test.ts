import { describe, it, expect, beforeEach, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import AnalyticsDetailView from './AnalyticsDetailView.vue'
import type { CashflowTransaction } from '@/entities/transaction'
import type { Category } from '@trata/api'
import {
  createMockAccountRepository,
  createMockCategoryRepository,
  createMockTransactionRepository,
} from '@/__tests__/helpers/mock-repositories'
import { mountWithProviders } from '@/__tests__/helpers/mount-with-providers'

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
    name: 'Еда',
    type: 'expense',
    icon: 'food',
    color: '#22c55e',
    archivedAt: null,
    version: 1,
  },
  {
    id: 'i1',
    name: 'Зарплата',
    type: 'income',
    icon: 'cash',
    color: '#3b82f6',
    archivedAt: null,
    version: 1,
  },
]

function nowTx(overrides: Partial<CashflowTransaction>): CashflowTransaction {
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

describe('AnalyticsDetailView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function mountView(
    transactions: CashflowTransaction[],
    direction: 'expense' | 'income' = 'expense',
  ) {
    const transactionsRepo = createMockTransactionRepository()
    transactionsRepo.query.mockResolvedValue(transactions)
    const categoriesRepo = createMockCategoryRepository()
    categoriesRepo.getAll.mockResolvedValue(categories)
    const accountsRepo = createMockAccountRepository()
    accountsRepo.getAll.mockResolvedValue([])

    const wrapper = mountWithProviders(AnalyticsDetailView, {
      props: { direction },
      repositories: {
        transactions: transactionsRepo,
        categories: categoriesRepo,
        accounts: accountsRepo,
      },
    })
    return { wrapper, transactionsRepo }
  }

  it('defaults to the current month with the summary row and every direction category listed', async () => {
    const { wrapper } = mountView([
      nowTx({ id: 't1', amount: 20113, categoryId: 'c1' }),
      nowTx({ id: 't2', amount: 10212, categoryId: 'c2' }),
    ])
    await flushPromises()

    expect(wrapper.find('[data-testid="analytics-period-month"]').attributes('aria-pressed')).toBe(
      'true',
    )
    expect(wrapper.find('[data-testid="analytics-detail-total"]').text()).toBe('₽303.25')

    // The summary row carries the full total and 100%; rows show percentages
    // against the FULL total, rounded to whole percents
    // (spec scenario: 20 113 of 30 325 = 66%).
    expect(wrapper.find('[data-testid="analytics-total-amount"]').text()).toBe('₽303.25')
    const list = wrapper.find('[data-testid="analytics-category-list"]')
    expect(list.text()).toContain('66%')
    expect(list.text()).toContain('34%')
  })

  it('switching the period kind selects the current period of the new kind and re-queries', async () => {
    const { wrapper, transactionsRepo } = mountView([])
    await flushPromises()
    expect(transactionsRepo.query).toHaveBeenCalledTimes(1)

    await wrapper.find('[data-testid="analytics-period-week"]').trigger('click')
    expect(wrapper.find('[data-testid="analytics-period-week"]').attributes('aria-pressed')).toBe(
      'true',
    )
    expect(transactionsRepo.query).toHaveBeenCalledTimes(2)
    const lastOptions = transactionsRepo.query.mock.lastCall![0] as {
      fromDate: string
      toDate: string
    }
    // A week range spans at most 8 UTC days (superset of the local week).
    const days =
      (new Date(`${lastOptions.toDate}T00:00:00Z`).getTime() -
        new Date(`${lastOptions.fromDate}T00:00:00Z`).getTime()) /
      (24 * 60 * 60 * 1000)
    expect(days).toBeLessThanOrEqual(7)
  })

  it('prev/next step one period and never block at the current period', async () => {
    const { wrapper, transactionsRepo } = mountView([])
    await flushPromises()
    const firstFromDate = (transactionsRepo.query.mock.lastCall![0] as { fromDate: string })
      .fromDate

    await wrapper.find('[data-testid="analytics-period-next"]').trigger('click')
    await flushPromises()
    const nextFromDate = (transactionsRepo.query.mock.lastCall![0] as { fromDate: string }).fromDate
    expect(new Date(nextFromDate).getTime()).toBeGreaterThan(new Date(firstFromDate).getTime())
    expect(
      wrapper.find('[data-testid="analytics-period-next"]').attributes('disabled'),
    ).toBeUndefined()
  })

  it('renders the zeroed full layout (neutral ring, all rows at 0) for an empty period', async () => {
    const { wrapper } = mountView([])
    await flushPromises()

    expect(wrapper.text()).toContain('₽0.00')
    expect(wrapper.find('[data-testid="analytics-total-amount"]').text()).toBe('₽0.00')
    // Both expense categories keep their rows at 0 / 0%.
    expect(wrapper.find('[data-testid="analytics-category-check-c1"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="analytics-category-check-c2"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('0%')
    // Nothing chartable: the neutral ring replaces segments.
    expect(wrapper.findAll('[data-testid="donut-segment"]')).toHaveLength(0)
  })

  it('excluding categories renormalizes the donut while rows keep full-total figures', async () => {
    const { wrapper } = mountView([
      nowTx({ id: 't1', amount: 6000, categoryId: 'c1' }),
      nowTx({ id: 't2', amount: 3000, categoryId: 'c2' }),
    ])
    await flushPromises()
    expect(wrapper.findAll('[data-testid="donut-segment"]')).toHaveLength(2)

    await wrapper.find('[data-testid="analytics-category-check-c2"]').setValue(false)
    // Only c1 remains charted; c2's row still shows the FULL-total amount
    // and dims (unchecked = off the chart).
    const segments = wrapper.findAll('[data-testid="donut-segment"]')
    expect(segments).toHaveLength(1)
    expect(wrapper.text()).toContain('₽30.00')
    const rows = wrapper.findAll('li')
    expect(rows[1]!.classes()).toContain('opacity-50')
  })

  it('the master checkbox excludes/restores every category', async () => {
    const { wrapper } = mountView([
      nowTx({ id: 't1', amount: 6000, categoryId: 'c1' }),
      nowTx({ id: 't2', amount: 3000, categoryId: 'c2' }),
    ])
    await flushPromises()

    await wrapper.find('[data-testid="analytics-total-check"]').setValue(false)
    expect(wrapper.findAll('[data-testid="donut-segment"]')).toHaveLength(0)

    await wrapper.find('[data-testid="analytics-total-check"]').setValue(true)
    expect(wrapper.findAll('[data-testid="donut-segment"]')).toHaveLength(2)
  })

  it('selecting a donut segment emphasizes the category and moves its row to the top', async () => {
    const { wrapper } = mountView([
      nowTx({ id: 't1', amount: 6000, categoryId: 'c1' }),
      nowTx({ id: 't2', amount: 3000, categoryId: 'c2' }),
    ])
    await flushPromises()

    await wrapper.findAll('[data-testid="donut-segment"]')[1]!.trigger('click')
    const rowIds = wrapper
      .findAll('[data-testid^="analytics-category-row-"]')
      .map((row) => row.attributes('data-testid'))
    // The selected category (c2) floats to the top below the summary row
    // and gets the warm wash; dimming is reserved for excluded categories.
    expect(rowIds[0]).toBe('analytics-category-row-c2')
    expect(wrapper.find('li').classes()).toContain('bg-muted/50')
    expect(wrapper.findAll('li.opacity-50')).toHaveLength(0)
  })
})
