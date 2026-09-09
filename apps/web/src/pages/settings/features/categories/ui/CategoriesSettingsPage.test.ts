import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import type { AccountWithBalance, Category, PlannedPayment, Transaction } from '@trata/api'
import { CategoriesSettingsPage } from '../'
import {
  createMockAccountRepository,
  createMockCategoryRepository,
  createMockPlannedPaymentRepository,
  createMockTransactionRepository,
} from '@/__tests__/helpers/mock-repositories'
import { mountWithProviders } from '@/__tests__/helpers/mount-with-providers'

const accounts: AccountWithBalance[] = [
  { id: 'a1', name: 'Card', currency: 'RUB', openingBalance: 0, version: 1, balance: 0 },
]

const categories: Category[] = [
  {
    id: 'c-food',
    name: 'Food',
    type: 'expense',
    icon: '🛒',
    color: '#16a34a',
    archivedAt: null,
    version: 2,
  },
  {
    id: 'c-taxi',
    name: 'Taxi',
    type: 'expense',
    icon: '🚗',
    color: '#64748b',
    archivedAt: null,
    version: 1,
  },
  {
    id: 'c-salary',
    name: 'Salary',
    type: 'income',
    icon: '💼',
    color: '#c026d3',
    archivedAt: null,
    version: 1,
  },
  {
    id: 'c-subs',
    name: 'Subscriptions',
    type: 'expense',
    icon: '🔁',
    color: '#0d9488',
    archivedAt: '2026-08-01T00:00:00.000Z',
    version: 4,
  },
]

const transactions = (overrides: Partial<Transaction>[] = []): Transaction[] =>
  [
    {
      id: 't1',
      type: 'expense',
      amount: 1000,
      description: '',
      occurredAt: '2026-08-14T10:00:00Z',
      version: 1,
      accountId: 'a1',
      categoryId: 'c-food',
    },
    {
      id: 't2',
      type: 'expense',
      amount: 2500,
      description: '',
      occurredAt: '2026-08-15T10:00:00Z',
      version: 1,
      accountId: 'a1',
      categoryId: 'c-food',
    },
    {
      id: 't3',
      type: 'income',
      amount: 80000,
      description: '',
      occurredAt: '2026-08-20T10:00:00Z',
      version: 1,
      accountId: 'a1',
      categoryId: 'c-salary',
    },
    {
      id: 't4',
      type: 'expense',
      amount: 599,
      description: '',
      occurredAt: '2026-07-01T10:00:00Z',
      version: 1,
      accountId: 'a1',
      categoryId: 'c-subs',
    },
    ...overrides,
  ] as Transaction[]

const planOn = (categoryId: string): PlannedPayment => ({
  id: 'p1',
  type: 'expense',
  amount: 59900,
  name: 'Netflix',
  accountId: 'a1',
  categoryId,
  nextDue: '2026-09-01',
  anchorDate: '2026-08-01',
  regularity: 'monthly',
  confirmMode: 'manual',
  reminder: 'off',
  note: '',
  version: 1,
})

interface MountOptions {
  categoryList?: Category[]
  transactionList?: Transaction[]
  plans?: PlannedPayment[]
}

function mountPage(options: MountOptions = {}) {
  const categoriesRepo = createMockCategoryRepository()
  categoriesRepo.getAllIncludingArchived.mockResolvedValue(options.categoryList ?? categories)
  categoriesRepo.getAll.mockResolvedValue(
    (options.categoryList ?? categories).filter((category) => category.archivedAt === null),
  )
  const transactionsRepo = createMockTransactionRepository()
  transactionsRepo.query.mockResolvedValue(options.transactionList ?? transactions())
  const plannedPaymentsRepo = createMockPlannedPaymentRepository()
  plannedPaymentsRepo.query.mockResolvedValue(options.plans ?? [])
  const accountsRepo = createMockAccountRepository()
  accountsRepo.getAll.mockResolvedValue(accounts)

  const wrapper = mountWithProviders(CategoriesSettingsPage, {
    repositories: {
      categories: categoriesRepo,
      transactions: transactionsRepo,
      plannedPayments: plannedPaymentsRepo,
      accounts: accountsRepo,
    },
  })
  mounted.push(wrapper)
  return {
    wrapper,
    categoriesRepo,
    transactionsRepo,
    plannedPaymentsRepo,
  }
}

// Dialogs teleport to document.body - reach them through the DOM.
const q = <T extends HTMLElement = HTMLElement>(selector: string): T | null =>
  document.querySelector<T>(selector)

async function click(selector: string): Promise<void> {
  q<HTMLButtonElement>(selector)!.click()
  await flushPromises()
}

async function typeInto(selector: string, value: string): Promise<void> {
  const input = q<HTMLInputElement>(selector)!
  input.value = value
  input.dispatchEvent(new Event('input'))
  await flushPromises()
}

const mounted: ReturnType<typeof mountWithProviders>[] = []

// Teleported dialogs outlive their wrappers - unmount to keep the shared
// document clean between tests.
afterEach(() => {
  while (mounted.length) mounted.pop()?.unmount()
  document.body.innerHTML = ''
})

describe('CategoriesSettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('lists active categories grouped by type with local counts', async () => {
    const { wrapper } = mountPage()
    await flushPromises()

    const expense = wrapper.find('[data-testid="categories-expense"]')
    expect(expense.text()).toContain('Food')
    expect(expense.text()).toContain('Taxi')
    expect(wrapper.find('[data-testid="category-count-c-food"]').text()).toBe('2 transactions')
    expect(wrapper.find('[data-testid="category-count-c-taxi"]').text()).toBe('no transactions')

    const income = wrapper.find('[data-testid="categories-income"]')
    expect(income.text()).toContain('Salary')
    expect(wrapper.find('[data-testid="category-count-c-salary"]').text()).toBe('1 transaction')
  })

  it('shows archived categories in the archive section only', async () => {
    const { wrapper } = mountPage()
    await flushPromises()

    const archive = wrapper.find('[data-testid="categories-archive"]')
    expect(archive.text()).toContain('Subscriptions')
    expect(archive.text()).toContain('archived since')
    expect(wrapper.find('[data-testid="categories-expense"]').text()).not.toContain('Subscriptions')
  })

  it('archives and unarchives through the update mutation', async () => {
    const { wrapper, categoriesRepo } = mountPage()
    await flushPromises()

    await wrapper.find('[data-testid="category-archive-c-taxi"]').trigger('click')
    await flushPromises()
    expect(categoriesRepo.update).toHaveBeenCalledWith('c-taxi', { version: 1, archived: true })

    await wrapper.find('[data-testid="category-unarchive-c-subs"]').trigger('click')
    await flushPromises()
    expect(categoriesRepo.update).toHaveBeenCalledWith('c-subs', { version: 4, archived: false })
  })

  it('plain-deletes an unreferenced category after a plain confirm', async () => {
    const { wrapper, categoriesRepo } = mountPage()
    await flushPromises()

    await wrapper.find('[data-testid="category-delete-c-taxi"]').trigger('click')
    await flushPromises()

    expect(q('[data-testid="delete-category-dialog"]')?.textContent).toContain(
      'This action cannot be undone.',
    )
    expect(q('[data-testid="delete-category-confirmation"]')).toBeNull()

    await click('[data-testid="delete-category-confirm"]')
    expect(categoriesRepo.remove).toHaveBeenCalledWith('c-taxi', undefined)
  })

  it('offers archive as the default and cascade behind the exact-name gate', async () => {
    const { wrapper, categoriesRepo } = mountPage()
    await flushPromises()

    await wrapper.find('[data-testid="category-delete-c-food"]').trigger('click')
    await flushPromises()

    // Both options render; archive is preselected and is the primary action.
    expect(q('[data-testid="delete-category-option-archive"]')).not.toBeNull()
    expect(q('[data-testid="delete-category-dialog"]')?.textContent).toContain('2 transactions')

    await click('[data-testid="delete-category-confirm"]')
    expect(categoriesRepo.update).toHaveBeenCalledWith('c-food', { version: 2, archived: true })

    // Cascade: the destructive action stays disabled until the exact name.
    categoriesRepo.update.mockClear()
    await wrapper.find('[data-testid="category-delete-c-food"]').trigger('click')
    await flushPromises()
    await click('[data-testid="delete-category-option-cascade"]')
    expect(q('[data-testid="delete-category-confirmation"]')).not.toBeNull()
    const confirm = () => q('[data-testid="delete-category-confirm"]')!
    expect(confirm().hasAttribute('disabled')).toBe(true)

    await typeInto('[data-testid="delete-category-confirmation"]', 'Foo')
    expect(confirm().hasAttribute('disabled')).toBe(true)

    await typeInto('[data-testid="delete-category-confirmation"]', 'Food')
    expect(confirm().hasAttribute('disabled')).toBe(false)

    await click('[data-testid="delete-category-confirm"]')
    expect(categoriesRepo.remove).toHaveBeenCalledWith('c-food', { cascade: true })
  })

  it('shows the balance impact of a cascade', async () => {
    const { wrapper } = mountPage()
    await flushPromises()

    await wrapper.find('[data-testid="category-delete-c-food"]').trigger('click')
    await flushPromises()
    await click('[data-testid="delete-category-option-cascade"]')

    const impact = document.querySelectorAll('[data-testid="delete-category-impact"]')
    expect(impact).toHaveLength(1)
    // Deleting two expenses on the Card account raises its balance by 35.00.
    expect(impact[0]!.textContent).toContain('+₽35')
    expect(impact[0]!.textContent).toContain('Card')
  })

  it('blocks deletion while a live planned payment references the category', async () => {
    const { wrapper, categoriesRepo } = mountPage({ plans: [planOn('c-food')] })
    await flushPromises()

    await wrapper.find('[data-testid="category-delete-c-food"]').trigger('click')
    await flushPromises()

    expect(q('[data-testid="delete-category-blocked"]')).not.toBeNull()
    expect(q('[data-testid="delete-category-dialog"]')?.textContent).toContain('Netflix')
    expect(q('[data-testid="delete-category-confirm"]')).toBeNull()
    expect(categoriesRepo.remove).not.toHaveBeenCalled()
  })

  it('goes straight to the typed cascade for an archived category with transactions', async () => {
    const { wrapper, categoriesRepo } = mountPage()
    await flushPromises()

    await wrapper.find('[data-testid="category-delete-c-subs"]').trigger('click')
    await flushPromises()

    expect(q('[data-testid="delete-category-option-archive"]')).toBeNull()
    expect(q('[data-testid="delete-category-confirmation"]')).not.toBeNull()

    await typeInto('[data-testid="delete-category-confirmation"]', 'Subscriptions')
    await click('[data-testid="delete-category-confirm"]')
    expect(categoriesRepo.remove).toHaveBeenCalledWith('c-subs', { cascade: true })
  })

  it('blocks row-level archiving with the blocking plan names', async () => {
    const { wrapper, categoriesRepo } = mountPage({ plans: [planOn('c-taxi')] })
    await flushPromises()

    await wrapper.find('[data-testid="category-archive-c-taxi"]').trigger('click')
    await flushPromises()
    expect(categoriesRepo.update).not.toHaveBeenCalledWith('c-taxi', expect.anything())
  })

  it('opens the dialog in create mode from the header button', async () => {
    const { wrapper, categoriesRepo } = mountPage()
    await flushPromises()

    expect(wrapper.find('[data-testid="categories-create"]').exists()).toBe(true)
    await wrapper.find('[data-testid="categories-create"]').trigger('click')
    await flushPromises()

    // The dialog is in create mode: type control, not the read-only badge.
    expect(q('[data-testid="create-category-dialog"]')).not.toBeNull()
    expect(q('[data-testid="edit-category-type"]')).toBeNull()

    await typeInto('[data-testid="create-category-name"]', 'Pets')
    await click('[data-testid="create-category-submit"]')
    expect(categoriesRepo.create).toHaveBeenCalledTimes(1)
  })
})
