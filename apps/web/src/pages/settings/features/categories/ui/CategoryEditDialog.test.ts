import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import type { Category } from '@trata/api'
import { categoryIconsForType } from '@/entities/category'
import { createMockCategoryRepository } from '@/__tests__/helpers/mock-repositories'
import { mountWithProviders } from '@/__tests__/helpers/mount-with-providers'
import CategoryEditDialog from './CategoryEditDialog.vue'

const category: Category = {
  id: 'c-food',
  name: 'Food',
  type: 'expense',
  icon: '🛒',
  color: '#16a34a',
  archivedAt: null,
  version: 3,
}

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

function mountDialog() {
  const categoriesRepo = createMockCategoryRepository()
  categoriesRepo.getAllIncludingArchived.mockResolvedValue([category])
  const wrapper = mountWithProviders(CategoryEditDialog, {
    props: { category, open: true },
    repositories: { categories: categoriesRepo },
  })
  return { wrapper, categoriesRepo }
}

describe('CategoryEditDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('seeds the form and shows the immutable type', async () => {
    mountDialog()
    await flushPromises()

    expect(q<HTMLInputElement>('[data-testid="edit-category-name"]')!.value).toBe('Food')
    expect(q('[data-testid="edit-category-type"]')?.textContent).toContain('Expense')
  })

  it('submits name + the picked icon with its paired color and the version', async () => {
    const { categoriesRepo } = mountDialog()
    await flushPromises()

    // Pick a different preset: 🍽️ with its own paired color.
    const expenseOptions = categoryIconsForType('expense')
    const restaurant = expenseOptions.find((option) => option.icon === '🍽️')!
    q(`[data-testid="edit-category-icon-${expenseOptions.indexOf(restaurant)}"]`)!.click()
    await flushPromises()

    const submit = q<HTMLButtonElement>('[data-testid="edit-category-submit"]')!
    submit.click()
    await flushPromises()

    expect(categoriesRepo.update).toHaveBeenCalledWith('c-food', {
      name: 'Food',
      icon: '🍽️',
      color: restaurant.color,
      version: 3,
    })
  })

  it('keeps the submit disabled for an empty name', async () => {
    mountDialog()
    await flushPromises()

    const input = q<HTMLInputElement>('[data-testid="edit-category-name"]')!
    input.value = '   '
    input.dispatchEvent(new Event('input'))
    await flushPromises()

    expect(
      q<HTMLButtonElement>('[data-testid="edit-category-submit"]')!.hasAttribute('disabled'),
    ).toBe(true)
  })
})

describe('CategoryEditDialog (create mode)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  function mountCreateDialog() {
    const categoriesRepo = createMockCategoryRepository()
    categoriesRepo.getAllIncludingArchived.mockResolvedValue([category])
    const wrapper = mountWithProviders(CategoryEditDialog, {
      props: { category: null, open: true },
      repositories: { categories: categoriesRepo },
    })
    return { wrapper, categoriesRepo }
  }

  it('offers the type as a segmented control with expense preselected', async () => {
    mountCreateDialog()
    await flushPromises()

    const expense = q<HTMLButtonElement>('[data-testid="create-category-type-expense"]')!
    const income = q<HTMLButtonElement>('[data-testid="create-category-type-income"]')!
    expect(expense.getAttribute('aria-pressed')).toBe('true')
    expect(income.getAttribute('aria-pressed')).toBe('false')
    expect(document.body.textContent).not.toContain('The category type cannot be changed')

    income.click()
    await flushPromises()
    expect(income.getAttribute('aria-pressed')).toBe('true')
  })

  it('creates a category of the chosen type with the paired color of the picked icon', async () => {
    const { categoriesRepo } = mountCreateDialog()
    await flushPromises()

    const incomeOptions = categoryIconsForType('income')
    const freelance = incomeOptions.find((option) => option.icon === '🖥️')!
    await click('[data-testid="create-category-type-income"]')
    await typeInto('[data-testid="create-category-name"]', 'Salary')
    await click(`[data-testid="create-category-icon-${incomeOptions.indexOf(freelance)}"]`)
    await click('[data-testid="create-category-submit"]')

    expect(categoriesRepo.create).toHaveBeenCalledWith({
      name: 'Salary',
      icon: '🖥️',
      color: freelance.color,
      type: 'income',
    })
    expect(categoriesRepo.update).not.toHaveBeenCalled()
  })

  it('replaces the picked icon with the type default when the type switch drops it', async () => {
    const { categoriesRepo } = mountCreateDialog()
    await flushPromises()

    // Default flow: expense default 🛒 selected; switching to income must
    // fall back to the income default 💼 (🛒 is not offered for income).
    await click('[data-testid="create-category-type-income"]')
    await typeInto('[data-testid="create-category-name"]', 'Бонус')
    await click('[data-testid="create-category-submit"]')

    expect(categoriesRepo.create).toHaveBeenCalledWith({
      name: 'Бонус',
      icon: '💼',
      color: '#6d28d9',
      type: 'income',
    })
  })
})
