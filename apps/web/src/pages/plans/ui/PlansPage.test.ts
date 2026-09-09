import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import { flushPromises } from '@vue/test-utils'
import PlansPage from './PlansPage.vue'
import type { PlannedPayment } from '@/entities/planned-payment'
import {
  createMockAccountRepository,
  createMockCategoryRepository,
  createMockPlannedPaymentRepository,
  createMockTransactionRepository,
} from '@/__tests__/helpers/mock-repositories'
import { mountWithProviders } from '@/__tests__/helpers/mount-with-providers'
import { currentDay } from '@/shared/lib/date'
import { calendarDayKey, fullDayLabel } from '@trata/dates'

const today = new Date()
const todayKey = currentDay()

function dayAfter(key: string): string {
  const next = new Date(`${key}T00:00:00Z`)
  next.setUTCDate(next.getUTCDate() + 1)
  return next.toISOString().slice(0, 10)
}

// The advanced plan's next-due key, derived from the day key itself (UTC
// calendar-day +1) rather than from the run instant: `today + 24h` sliced
// in UTC drifts across timezones/time of day (a late-evening run can land
// on the same day as the local `todayKey`, hanging the overdue waitFor).
const tomorrowKey = dayAfter(todayKey)

function plan(overrides: Partial<PlannedPayment>): PlannedPayment {
  return {
    id: 'p1',
    type: 'expense',
    amount: 59900,
    name: 'Netflix',
    accountId: 'a1',
    categoryId: 'c1',
    nextDue: todayKey,
    anchorDate: todayKey,
    regularity: 'monthly',
    confirmMode: 'manual',
    reminder: 'off',
    note: '',
    version: 1,
    ...overrides,
  }
}

import type { Category } from '@trata/api'

const categories: Category[] = [
  {
    id: 'c1',
    name: 'Развлечения',
    type: 'expense',
    icon: 'tv',
    color: '#7c5cff',
    archivedAt: null,
    version: 1,
  },
]

const mounted: ReturnType<typeof mountWithProviders>[] = []

// File-level hygiene: every test in this file (three describes) mounts full
// pages into document.body via portals; a leftover mounted app from a
// previous test leaks its live DOM into the next test's document.querySelector
// assertions (seen with the deep-link page polluting the refresh test).
beforeEach(() => {
  vi.clearAllMocks()
})
afterEach(async () => {
  for (const wrapper of mounted.splice(0)) {
    wrapper.unmount()
  }
  await flushPromises()
  document.body.innerHTML = ''
})

describe('PlansPage', () => {
  function mountPage(plans: PlannedPayment[]) {
    const plannedPaymentsRepo = createMockPlannedPaymentRepository()
    plannedPaymentsRepo.query.mockResolvedValue(plans)
    const categoriesRepo = createMockCategoryRepository()
    categoriesRepo.getAll.mockResolvedValue(categories)
    const accountsRepo = createMockAccountRepository()
    accountsRepo.getAll.mockResolvedValue([
      { id: 'a1', name: 'Cash', currency: 'USD', openingBalance: 0, balance: 0, version: 1 },
    ])

    const wrapper = mountWithProviders(PlansPage, {
      repositories: {
        plannedPayments: plannedPaymentsRepo,
        categories: categoriesRepo,
        accounts: accountsRepo,
        transactions: createMockTransactionRepository(),
      },
    })
    mounted.push(wrapper)
    return { wrapper, plannedPaymentsRepo, accountsRepo }
  }

  it('renders both type cards with plan counts and normalized monthly totals', async () => {
    const { wrapper } = mountPage([
      plan({ id: 'p1', type: 'expense', amount: 59900 }),
      // 599/mo + 12/day (×365/12 = 365/mo) = 964/mo total for expenses.
      plan({ id: 'p2', type: 'expense', amount: 1200, regularity: 'daily' }),
      plan({ id: 'p3', type: 'income', amount: 500000, regularity: 'monthly' }),
    ])
    await flushPromises()

    const expenseCard = wrapper.find('[data-testid="plans-card-expense"]')
    expect(expenseCard.exists()).toBe(true)
    expect(expenseCard.text()).toContain('2 plans')
    expect(wrapper.find('[data-testid="plans-total-expense"]').text()).toBe('₽964.00/mo')
    expect(wrapper.find('[data-testid="plans-total-income"]').text()).toBe('₽5,000.00/mo')
  })

  it('opens the type list dialog with rows sorted by next due, overdue badge, and manual confirm actions', async () => {
    // Strictly beyond every "today" the dialog can compare against: the
    // overdue predicate uses the LOCAL calendar day (facade currentDay),
    // while seeds like p-due use the UTC day key - the two differ inside
    // the local/UTC midnight window, so base the future date on the later
    // of the two.
    const localTodayKey = calendarDayKey(new Date())
    const future = dayAfter(localTodayKey > todayKey ? localTodayKey : todayKey)
    const { wrapper } = mountPage([
      plan({ id: 'p-future', nextDue: future }),
      plan({ id: 'p-due', nextDue: todayKey }),
    ])
    await flushPromises()

    await wrapper.find('[data-testid="plans-card-expense"]').trigger('click')
    await flushPromises()

    const listDialog = document.querySelector('[data-testid="plans-list-dialog"]')
    expect(listDialog).not.toBeNull()
    const rows = [...document.querySelectorAll('div[data-testid^="plans-row-p-"]')].filter(
      (row) => !row.getAttribute('data-testid')!.endsWith('-overdue'),
    )
    expect(rows.map((row) => row.getAttribute('data-testid'))).toEqual([
      'plans-row-p-due',
      'plans-row-p-future',
    ])
    // Only the due plan carries the overdue badge.
    expect(document.querySelector('[data-testid="plans-row-p-due-overdue"]')).not.toBeNull()
    expect(document.querySelector('[data-testid="plans-row-p-future-overdue"]')).toBeNull()
    expect(document.querySelector('[data-testid="plans-row-p-due-confirm"]')).not.toBeNull()
    expect(document.querySelector('[data-testid="plans-list-add"]')).not.toBeNull()
  })

  it('shows the empty state when a type has no plans', async () => {
    const { wrapper } = mountPage([])
    await flushPromises()

    await wrapper.find('[data-testid="plans-card-expense"]').trigger('click')
    await flushPromises()

    expect(document.querySelector('[data-testid="plans-list-dialog"]')!.textContent).toContain(
      'No plans yet',
    )
  })

  it('confirm generates a transaction and advances the plan', async () => {
    const { wrapper, plannedPaymentsRepo } = mountPage([plan({ nextDue: todayKey })])
    await flushPromises()

    await wrapper.find('[data-testid="plans-card-expense"]').trigger('click')
    await flushPromises()

    ;(document.querySelector('[data-testid="plans-row-p1-confirm"]') as HTMLElement).click()
    await flushPromises()

    const confirmDialog = document.querySelector('[data-testid="plans-confirm-dialog"]')
    expect(confirmDialog).not.toBeNull()
    expect(confirmDialog!.textContent).toContain('Netflix')

    ;(document.querySelector('[data-testid="plans-confirm-submit"]') as HTMLElement).click()
    await flushPromises()

    expect(plannedPaymentsRepo.confirmPlannedPayment).toHaveBeenCalledWith({
      planId: 'p1',
      amount: 59900,
      occurredAt: `${todayKey}T12:00:00.000Z`,
      note: 'Netflix',
    })
  })
})

// Deep-linked confirm (web-push change, ADR-0007): activating a reminder
// notification opens /plans?confirm=<planId>; the page opens that plan's
// list sheet with the confirm dialog pre-armed and clears the query param
// so a reload does not re-trigger it.
describe('PlansPage confirm deep link', () => {
  it('opens the confirm dialog for the linked plan and clears the query', async () => {
    const plansRepo = createMockPlannedPaymentRepository()
    plansRepo.query.mockResolvedValue([
      plan({ id: 'p-1', type: 'expense' }),
      plan({ id: 'p-2', type: 'income' }),
    ])
    const categoriesRepo = createMockCategoryRepository()
    categoriesRepo.getAll.mockResolvedValue(categories)
    const accountsRepo = createMockAccountRepository()
    accountsRepo.getAll.mockResolvedValue([
      { id: 'a1', name: 'Cash', currency: 'USD', openingBalance: 0, balance: 0, version: 1 },
    ])

    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', component: { template: '<div/>' } },
        { path: '/plans', name: 'plans', component: { template: '<div/>' } },
      ],
    })
    await router.push('/plans?confirm=p-1')

    const wrapper = mountWithProviders(PlansPage, {
      router,
      repositories: {
        plannedPayments: plansRepo,
        categories: categoriesRepo,
        accounts: accountsRepo,
        transactions: createMockTransactionRepository(),
      },
    })
    mounted.push(wrapper)
    await flushPromises()

    const confirmDialog = document.querySelector('[data-testid="plans-list-dialog"]')
    expect(confirmDialog).not.toBeNull()
    // The confirm sheet itself is pre-armed for the linked plan.
    expect(document.querySelector('[data-testid="plans-confirm-dialog"]')).not.toBeNull()
    expect(router.currentRoute.value.query.confirm).toBeUndefined()
  })
})

// Regression (user report): after confirming, the plan list must show the
// advanced plan - the invalidation has to reach the query and re-render the
// rows. The mock answers the first query with the original data and the
// post-invalidation refetch with the advanced plan, exactly like the
// worker-backed repository does over the real local DB.
describe('PlansPage confirm refreshes the list', () => {
  it('re-renders the row from the post-confirm refetch', async () => {
    const original = [plan({ id: 'p1', nextDue: todayKey })]
    const advanced = [plan({ id: 'p1', nextDue: tomorrowKey, version: 2 })]

    const plannedPaymentsRepo = createMockPlannedPaymentRepository()
    plannedPaymentsRepo.query.mockResolvedValueOnce(original).mockResolvedValue(advanced)
    plannedPaymentsRepo.confirmPlannedPayment.mockResolvedValue(undefined)
    const categoriesRepo = createMockCategoryRepository()
    categoriesRepo.getAll.mockResolvedValue(categories)
    const accountsRepo = createMockAccountRepository()
    accountsRepo.getAll.mockResolvedValue([
      { id: 'a1', name: 'Cash', currency: 'USD', openingBalance: 0, balance: 0, version: 1 },
    ])

    const wrapper = mountWithProviders(PlansPage, {
      repositories: {
        plannedPayments: plannedPaymentsRepo,
        categories: categoriesRepo,
        accounts: accountsRepo,
        transactions: createMockTransactionRepository(),
      },
    })
    mounted.push(wrapper)
    await flushPromises()

    await wrapper.find('[data-testid="plans-card-expense"]').trigger('click')
    await flushPromises()

    const row = document.querySelector('[data-testid="plans-row-p1"]')
    expect(row).not.toBeNull()
    expect(document.querySelector('[data-testid="plans-row-p1-overdue"]')).not.toBeNull()

    ;(document.querySelector('[data-testid="plans-row-p1-confirm"]') as HTMLElement).click()
    await flushPromises()
    ;(document.querySelector('[data-testid="plans-confirm-submit"]') as HTMLElement).click()
    await flushPromises()

    // The invalidation-triggered refetch re-renders the rows asynchronously;
    // waitFor polls past the mutation's settle chain deterministically.
    await vi.waitFor(() => {
      expect(document.querySelector('[data-testid="plans-row-p1-overdue"]')).toBeNull()
    })
    const updatedRow = document.querySelector('[data-testid="plans-row-p1"]')
    // The label renders the advanced plan's calendar day (e.g. "8 September"
    // for a 2026-09-08 key), not the ISO key: the expectation is computed
    // from the same key construction the row uses, so it holds on any run
    // date instead of the previously baked "7 September".
    expect(updatedRow?.textContent).toContain(
      fullDayLabel(new Date(`${tomorrowKey}T00:00:00`), 'en'),
    )
    expect(updatedRow?.textContent).not.toContain(tomorrowKey)
    expect(plannedPaymentsRepo.query).toHaveBeenCalledTimes(2)
  })
})
