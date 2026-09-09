import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { useQueryCache } from '@pinia/colada'
import DebtsPage from './DebtsPage.vue'
import {
  createMockDebtorRepository,
  createMockDebtOperationRepository,
} from '@/__tests__/helpers/mock-repositories'
import { mountWithProviders } from '@/__tests__/helpers/mount-with-providers'
import type { DebtOperation } from '@trata/api'

const debtors = [
  { id: 'd1', name: 'Анна', note: '', version: 1 },
  { id: 'd2', name: 'Борис', note: '', version: 1 },
]

const operations: DebtOperation[] = [
  {
    id: 'o1',
    debtorId: 'd1',
    direction: 'receivable',
    kind: 'debt',
    amount: 500000,
    note: 'Займ',
    occurredAt: '2026-08-20T12:00:00.000Z',
    version: 1,
  },
  {
    id: 'o2',
    debtorId: 'd1',
    direction: 'receivable',
    kind: 'repayment',
    amount: 150000,
    note: '',
    occurredAt: '2026-08-21T12:00:00.000Z',
    version: 1,
  },
  {
    id: 'o3',
    debtorId: 'd2',
    direction: 'payable',
    kind: 'debt',
    amount: 200000,
    note: '',
    occurredAt: '2026-08-22T12:00:00.000Z',
    version: 1,
  },
]

describe('DebtsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })
  afterEach(() => {
    // Teleported dialog content lands in document.body.
    document.body.innerHTML = ''
  })

  function mountPage(debtorsData: typeof debtors, operationsData: typeof operations) {
    const debtorsRepo = createMockDebtorRepository()
    debtorsRepo.getAll.mockResolvedValue(debtorsData)
    const operationsRepo = createMockDebtOperationRepository()
    operationsRepo.query.mockResolvedValue(operationsData)

    const wrapper = mountWithProviders(DebtsPage, {
      repositories: { debtors: debtorsRepo, debtOperations: operationsRepo },
    })
    return { wrapper, debtorsRepo, operationsRepo }
  }

  it('renders both direction sections with derived totals and per-debtor balances', async () => {
    const { wrapper } = mountPage(debtors, operations)
    await flushPromises()

    // Direction totals are independent (no netting).
    expect(wrapper.find('[data-testid="debts-total-receivable"]').text()).toBe('₽3,500.00')
    expect(wrapper.find('[data-testid="debts-total-payable"]').text()).toBe('₽2,000.00')

    // Debtor rows with derived balances in their direction's section.
    const receivable = wrapper
      .find('[data-testid="debts-section-add-receivable"]')
      .element.closest('section')!
    expect(receivable.textContent).toContain('Анна')
    expect(receivable.textContent).toContain('₽3,500.00')
    expect(wrapper.find('[data-testid="debts-debtor-d2"]').text()).toContain('Борис')

    // The payable direction has its own add action.
    expect(wrapper.find('[data-testid="debts-section-add-payable"]').exists()).toBe(true)
  })

  it('renders each section empty-state copy when a direction has no operations', async () => {
    const { wrapper } = mountPage(debtors, [])
    await flushPromises()

    expect(wrapper.text()).toContain('Nobody owes you')
    expect(wrapper.text()).toContain("You don't owe anyone")
  })

  it('keeps rendered rows during a background refetch (no skeleton flicker)', async () => {
    // The sync cycle / mutation invalidations refetch queries in the
    // background; skeletons are reserved for "no data yet" (isPending), so
    // an in-flight refetch must never blank the rendered content.
    const pinia = createPinia()
    const debtorsRepo = createMockDebtorRepository()
    debtorsRepo.getAll.mockResolvedValue(debtors)
    const operationsRepo = createMockDebtOperationRepository()
    operationsRepo.query.mockResolvedValue(operations)

    const wrapper = mountWithProviders(DebtsPage, {
      pinia,
      repositories: { debtors: debtorsRepo, debtOperations: operationsRepo },
    })
    await flushPromises()
    expect(wrapper.find('[data-testid="debts-debtor-d2"]').exists()).toBe(true)

    // A slow refetch: the repositories never settle again, exactly like a
    // worker round-trip still in flight when the re-render happens.
    debtorsRepo.getAll.mockImplementation(() => new Promise(() => {}))
    operationsRepo.query.mockImplementation(() => new Promise(() => {}))
    const queryCache = useQueryCache(pinia)
    // Not awaited: the invalidation promise resolves only when the (never
    // settling) refetches finish - the assertion targets the in-flight state.
    void queryCache.invalidateQueries()
    await flushPromises()

    expect(wrapper.find('[data-slot="skeleton"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="debts-debtor-d2"]').exists()).toBe(true)
  })

  it('opens the debtor history dialog from a row, showing balance and day-grouped ops', async () => {
    const { wrapper } = mountPage(debtors, operations)
    await flushPromises()

    await wrapper.find('[data-testid="debts-debtor-d1"]').trigger('click')
    await flushPromises()

    const history = document.querySelector('[data-testid="debts-history-dialog"]')
    expect(history).not.toBeNull()
    expect(document.querySelector('[data-testid="debts-history-balance"]')!.textContent).toBe(
      '₽3,500.00',
    )
    expect(history!.textContent).toContain('Займ')
    // The repayment's amount renders signed.
    expect(history!.textContent).toContain('−')
    expect(document.querySelector('[data-testid="debts-new-operation"]')).not.toBeNull()
  })

  it('settled debtors hide behind the reveal toggle', async () => {
    const settledOps: DebtOperation[] = [
      {
        id: 'o1',
        debtorId: 'd1',
        direction: 'receivable',
        kind: 'debt',
        amount: 100,
        note: '',
        occurredAt: '2026-08-20T12:00:00.000Z',
        version: 1,
      },
      {
        id: 'o2',
        debtorId: 'd1',
        direction: 'receivable',
        kind: 'repayment',
        amount: 100,
        note: '',
        occurredAt: '2026-08-21T12:00:00.000Z',
        version: 1,
      },
    ]
    const { wrapper } = mountPage(debtors, settledOps)
    await flushPromises()

    expect(wrapper.find('[data-testid="debts-debtor-d1"]').exists()).toBe(false)
    const reveal = wrapper.find('[data-testid="debts-settled-reveal-receivable"]')
    expect(reveal.text()).toContain('Show settled (1)')

    await reveal.trigger('click')
    expect(wrapper.find('[data-testid="debts-debtor-d1"]').exists()).toBe(true)
  })
})
