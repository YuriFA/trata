import { describe, it, expect } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import DebtsCard from './DebtsCard.vue'
import type { DebtOperation } from '@trata/api'
import {
  createMockDebtOperationRepository,
  createMockDebtorRepository,
} from '@/__tests__/helpers/mock-repositories'
import { mountWithProviders } from '@/__tests__/helpers/mount-with-providers'

function operation(overrides: Partial<DebtOperation>): DebtOperation {
  return {
    id: 'op',
    debtorId: 'd1',
    direction: 'receivable',
    kind: 'debt',
    amount: 1000,
    occurredAt: '2026-08-01T12:00:00Z',
    note: '',
    version: 1,
    ...overrides,
  } as DebtOperation
}

const debtors = [
  { id: 'd1', name: 'Анна Петровна', note: '', version: 1 },
  { id: 'd2', name: 'Пётр', note: '', version: 1 },
]

function mountCard(operations: DebtOperation[]) {
  const debtorRepo = createMockDebtorRepository()
  debtorRepo.getAll.mockResolvedValue(debtors)
  const operationsRepo = createMockDebtOperationRepository()
  operationsRepo.query.mockResolvedValue(operations)
  return mountWithProviders(DebtsCard, {
    repositories: { debtors: debtorRepo, debtOperations: operationsRepo },
  })
}

describe('DebtsCard', () => {
  it('renders one row per debtor and direction', async () => {
    const wrapper = mountCard([
      operation({
        id: 'op1',
        debtorId: 'd1',
        direction: 'receivable',
        kind: 'debt',
        amount: 700_000,
      }),
      operation({ id: 'op2', debtorId: 'd2', direction: 'payable', kind: 'debt', amount: 200_000 }),
    ])
    await flushPromises()
    expect(wrapper.find('[data-testid="debts-card-debtor-d1-receivable"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="debts-card-debtor-d2-payable"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('+₽7,000.00')
    expect(wrapper.text()).toContain('−₽2,000.00')
    expect(wrapper.text()).toContain('Owed to me')
    expect(wrapper.text()).toContain('I owe')
    // Initials avatar from the debtor name.
    expect(wrapper.text()).toContain('АП')
  })

  it('subtracts repayments inside a direction', async () => {
    const wrapper = mountCard([
      operation({
        id: 'op1',
        debtorId: 'd1',
        direction: 'receivable',
        kind: 'debt',
        amount: 700_000,
      }),
      operation({
        id: 'op2',
        debtorId: 'd1',
        direction: 'receivable',
        kind: 'repayment',
        amount: 500_000,
      }),
    ])
    await flushPromises()
    expect(wrapper.find('[data-testid="debts-card-debtor-d1-receivable"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('+₽2,000.00')
    // Zero directions stay hidden instead of rendering a 0 row.
    expect(wrapper.find('[data-testid="debts-card-debtor-d2-payable"]').exists()).toBe(false)
  })

  it('never nets a debtor active in both directions', async () => {
    const wrapper = mountCard([
      operation({
        id: 'op1',
        debtorId: 'd1',
        direction: 'receivable',
        kind: 'debt',
        amount: 500_000,
      }),
      operation({ id: 'op2', debtorId: 'd1', direction: 'payable', kind: 'debt', amount: 200_000 }),
    ])
    await flushPromises()
    expect(wrapper.find('[data-testid="debts-card-debtor-d1-receivable"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="debts-card-debtor-d1-payable"]').exists()).toBe(true)
  })

  it('renders the empty state when there are no operations', async () => {
    const wrapper = mountCard([])
    await flushPromises()
    expect(wrapper.text()).toContain('No debts')
    expect(wrapper.find('[data-testid^="debts-card-debtor-"]').exists()).toBe(false)
  })
})
