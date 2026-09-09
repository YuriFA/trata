import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import CategoryBreakdownCard from './CategoryBreakdownCard.vue'
import { CategoryCashflowDialog } from '@/widgets/category-cashflow-dialog'
import type { CashflowTransaction } from '@/entities/transaction'
import type { Category } from '@trata/api'
import { currentPeriod, periodToUtcDayRange, shiftPeriod, type PeriodCursor } from '@trata/dates'
import {
  createMockAccountRepository,
  createMockCategoryRepository,
  createMockTransactionRepository,
} from '@/__tests__/helpers/mock-repositories'
import { mountWithProviders } from '@/__tests__/helpers/mount-with-providers'

const categories: Category[] = [
  {
    id: 'c1',
    name: 'Продукты',
    type: 'expense',
    icon: 'food',
    color: '#22c55e',
    archivedAt: null,
    version: 1,
  },
  {
    id: 'c2',
    name: 'Такси',
    type: 'expense',
    icon: 'car',
    color: '#7c5cff',
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

describe('CategoryBreakdownCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })
  afterEach(() => {
    document.body.innerHTML = ''
  })

  function mountCard(transactions: CashflowTransaction[], cursor: PeriodCursor) {
    const transactionsRepo = createMockTransactionRepository()
    transactionsRepo.query.mockResolvedValue(transactions)
    const categoriesRepo = createMockCategoryRepository()
    categoriesRepo.getAll.mockResolvedValue(categories)
    const accountsRepo = createMockAccountRepository()
    accountsRepo.getAll.mockResolvedValue([])

    const wrapper = mountWithProviders(CategoryBreakdownCard, {
      props: { cursor },
      repositories: {
        transactions: transactionsRepo,
        categories: categoriesRepo,
        accounts: accountsRepo,
      },
    })
    return { wrapper, transactionsRepo }
  }

  // The overlay teleports to body; assert on the document, not the wrapper.
  const dialogEl = () => document.querySelector('[data-testid="category-cashflow-dialog"]')

  it('activating a row opens the drill-down scoped to the category and the selected month', async () => {
    const cursor = currentPeriod('month')
    const { wrapper, transactionsRepo } = mountCard(
      [
        nowTx({ id: 't1', amount: 20113, categoryId: 'c1' }),
        nowTx({ id: 't2', amount: 10212, categoryId: 'c2' }),
      ],
      cursor,
    )
    await flushPromises()

    await wrapper.find('[data-testid="dashboard-category-row-c1"]').trigger('click')
    await flushPromises()

    const dialog = dialogEl()
    expect(dialog).not.toBeNull()
    expect(dialog?.textContent).toContain('Продукты')
    expect(dialog?.textContent).toContain('₽201.13')

    const range = periodToUtcDayRange(cursor)
    expect(transactionsRepo.query).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'expense',
        categoryId: 'c1',
        fromDate: range.fromDate,
        toDate: range.toDate,
      }),
    )
  })

  it('switching the dashboard month and activating again rescopes the drill-down', async () => {
    const cursor = currentPeriod('month')
    const prevMonth = shiftPeriod(cursor, -1)
    // Local midday on the 15th: inside prevMonth under any UTC offset.
    const prevMonthTx = nowTx({
      id: 't0',
      amount: 5000,
      categoryId: 'c1',
      occurredAt: new Date(
        prevMonth.start.getFullYear(),
        prevMonth.start.getMonth(),
        15,
        12,
      ).toISOString(),
    })
    const { wrapper, transactionsRepo } = mountCard(
      [nowTx({ id: 't1', amount: 20113, categoryId: 'c1' }), prevMonthTx],
      cursor,
    )
    await flushPromises()

    await wrapper.find('[data-testid="dashboard-category-row-c1"]').trigger('click')
    await flushPromises()
    expect(dialogEl()).not.toBeNull()

    // Closing clears the active category, so the next activation remounts
    // and snapshots the then-current cursor.
    wrapper.findComponent(CategoryCashflowDialog).vm.$emit('update:open', false)
    await flushPromises()
    expect(dialogEl()).toBeNull()

    await wrapper.setProps({ cursor: prevMonth })
    await flushPromises()
    await wrapper.find('[data-testid="dashboard-category-row-c1"]').trigger('click')
    await flushPromises()

    const range = periodToUtcDayRange(prevMonth)
    expect(transactionsRepo.query).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: 'expense',
        categoryId: 'c1',
        fromDate: range.fromDate,
        toDate: range.toDate,
      }),
    )
  })
})
