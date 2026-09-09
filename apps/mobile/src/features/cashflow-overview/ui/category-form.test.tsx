// Category form behavior: submit-driven name validation, payload with the
// picked type/icon and the icon-paired color, server errors at the root slot
// with the name preserved, reset after a successful create, and pending
// blocking duplicates. The edit mode prefills from the record and writes
// through `update` with the record's version. The form renders standalone -
// under jest the @gorhom mock degrades BottomSheetInput to a plain input (no
// sheet context needed).

import { describe, expect, it, beforeEach, jest } from '@jest/globals'
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import { QueryClientProvider } from '@tanstack/react-query'
import { AlreadyExistsError, type Category } from '@trata/api'
import { ThemeProvider } from '@/shared/config/theme'
import { createQueryClient } from '@/shared/lib/query/query-client'
import { CategoryRepositoryProvider } from '@/entities/category'
import { createMockCategoryRepository } from '@/shared/lib/testing/mock-category-repository'
import { CategoryForm } from './category-form'

type MockRepository = ReturnType<typeof createMockCategoryRepository>

function renderForm(
  repository?: MockRepository,
  category?: Category,
  props: { defaultType?: 'income' | 'expense' } = {},
) {
  const repo = repository ?? createMockCategoryRepository([])
  render(
    <QueryClientProvider client={createQueryClient()}>
      <CategoryRepositoryProvider repository={repo}>
        <ThemeProvider>
          <CategoryForm category={category} {...props} />
        </ThemeProvider>
      </CategoryRepositoryProvider>
    </QueryClientProvider>,
  )
  return repo
}

function fillValid() {
  fireEvent.changeText(screen.getByTestId('home-new-category-name'), 'Транспорт')
  fireEvent.press(screen.getByTestId('home-new-category-type-income'))
  fireEvent.press(screen.getByTestId('home-new-category-icon-💼'))
}

const existingCategory: Category = {
  id: 'cat-1',
  name: 'Кафе',
  type: 'expense',
  // Legacy Ionicons glyph stored before the unified emoji set: it renders
  // (through the legacy map) but is not offered by the picker.
  icon: 'restaurant',
  color: '#f97316',
  archivedAt: null,
  version: 3,
}

describe('CategoryForm (create)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('blocks an empty submit with the name error and no create call', async () => {
    const repository = renderForm()

    fireEvent.press(screen.getByTestId('home-new-category-submit'))

    expect(await screen.findByTestId('home-new-category-name-error')).toHaveTextContent(
      'Введите название категории',
    )
    expect(repository.snapshot()).toHaveLength(0)
  })

  it('submits the name with the picked type, icon, and the icon-paired color', async () => {
    const repository = renderForm()

    fillValid()
    fireEvent.press(screen.getByTestId('home-new-category-submit'))

    await waitFor(() => expect(repository.snapshot()).toHaveLength(1))
    expect(repository.snapshot()[0]).toMatchObject({
      name: 'Транспорт',
      type: 'income',
      icon: '💼',
      color: '#6d28d9',
    })
  })

  it('filters the icon list by the selected type', async () => {
    renderForm()

    // Expense set by default: an income-only icon is absent, an expense one is offered.
    expect(screen.queryByTestId('home-new-category-icon-💼')).toBeNull()
    expect(screen.getByTestId('home-new-category-icon-🛒')).toBeTruthy()

    fireEvent.press(screen.getByTestId('home-new-category-type-income'))
    expect(screen.getByTestId('home-new-category-icon-💼')).toBeTruthy()
    expect(screen.queryByTestId('home-new-category-icon-🛒')).toBeNull()
  })

  it('falls back to the type default icon when the type switch drops the picked one', async () => {
    const repository = renderForm()

    // The shared 🎁 survives a type switch (offered for both types)...
    fireEvent.press(screen.getByTestId('home-new-category-icon-🎁'))
    fireEvent.press(screen.getByTestId('home-new-category-type-income'))
    expect(screen.getByTestId('home-new-category-icon-🎁').props.accessibilityState.selected).toBe(
      true,
    )

    // ...but an income-exclusive icon does not: switching back to expense
    // falls back to the expense default 🛒.
    fireEvent.press(screen.getByTestId('home-new-category-icon-💼'))
    fireEvent.press(screen.getByTestId('home-new-category-type-expense'))
    expect(screen.getByTestId('home-new-category-icon-🛒').props.accessibilityState.selected).toBe(
      true,
    )

    fireEvent.changeText(screen.getByTestId('home-new-category-name'), 'Подарки')
    fireEvent.press(screen.getByTestId('home-new-category-submit'))
    await waitFor(() => expect(repository.snapshot()).toHaveLength(1))
    expect(repository.snapshot()[0]).toMatchObject({
      name: 'Подарки',
      type: 'expense',
      icon: '🛒',
      color: '#16a34a',
    })
  })

  it('defaults the create flow to defaultType without touching the toggle', async () => {
    const repository = renderForm(undefined, undefined, { defaultType: 'income' })

    fireEvent.changeText(screen.getByTestId('home-new-category-name'), 'Фриланс')
    fireEvent.press(screen.getByTestId('home-new-category-submit'))

    await waitFor(() => expect(repository.snapshot()).toHaveLength(1))
    expect(repository.snapshot()[0]).toMatchObject({ name: 'Фриланс', type: 'income' })
  })

  it('surfaces a repository error at the root slot and keeps the name', async () => {
    const repository = {
      ...createMockCategoryRepository([]),
      create: () => Promise.reject(new AlreadyExistsError('Category exists')),
    }
    renderForm(repository)

    fireEvent.changeText(screen.getByTestId('home-new-category-name'), 'Транспорт')
    fireEvent.press(screen.getByTestId('home-new-category-submit'))

    await waitFor(() =>
      expect(screen.getByTestId('home-new-category-error')).toHaveTextContent('Уже существует'),
    )
    expect(screen.getByTestId('home-new-category-name').props.value).toBe('Транспорт')
  })

  it('resets the fields after a successful submit', async () => {
    const repository = renderForm()

    fillValid()
    fireEvent.press(screen.getByTestId('home-new-category-submit'))
    await waitFor(() => expect(repository.snapshot()).toHaveLength(1))

    expect(screen.getByTestId('home-new-category-name').props.value).toBe('')
    // The pickers returned to their defaults: a second submit without
    // touching them creates an expense category with the default look.
    fireEvent.changeText(screen.getByTestId('home-new-category-name'), 'Другая')
    fireEvent.press(screen.getByTestId('home-new-category-submit'))

    await waitFor(() => expect(repository.snapshot()).toHaveLength(2))
    expect(repository.snapshot()[1]).toMatchObject({
      name: 'Другая',
      type: 'expense',
      icon: '🛒',
      color: '#16a34a',
    })
  })

  it('blocks a double submit while the create is pending', async () => {
    let resolveCreate: (category: Category) => void = () => {}
    const create = jest.fn(() => new Promise<Category>((resolve) => void (resolveCreate = resolve)))
    const repository = { ...createMockCategoryRepository([]), create }
    renderForm(repository)

    fillValid()
    fireEvent.press(screen.getByTestId('home-new-category-submit'))

    await waitFor(() =>
      expect(screen.getByTestId('home-new-category-submit').props.accessibilityState.disabled).toBe(
        true,
      ),
    )
    fireEvent.press(screen.getByTestId('home-new-category-submit'))
    expect(create).toHaveBeenCalledTimes(1)

    resolveCreate({
      id: 'cat-new',
      name: 'Транспорт',
      type: 'income',
      icon: '💼',
      color: '#6d28d9',
      archivedAt: null,
      version: 1,
    })
  })
})

describe('CategoryForm (edit)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('prefills the fields from the category and updates through the repository', async () => {
    const repository = renderForm(
      createMockCategoryRepository([existingCategory]),
      existingCategory,
    )

    expect(screen.getByTestId('category-edit-name').props.value).toBe('Кафе')
    expect(screen.getByTestId('category-edit-submit')).toHaveTextContent('Сохранить')

    fireEvent.changeText(screen.getByTestId('category-edit-name'), 'Кафе и десерты')
    fireEvent.press(screen.getByTestId('category-edit-submit'))

    await waitFor(() => expect(repository.calls.update).toBe(1))
    // The legacy icon survives the save (no tile selected, value untouched);
    // the color re-derives through the nearest-free walk, which for an
    // out-of-set icon anchors at the palette head.
    expect(repository.snapshot()[0]).toMatchObject({
      id: 'cat-1',
      name: 'Кафе и десерты',
      type: 'expense',
      icon: 'restaurant',
      color: '#16a34a',
      archivedAt: null,
      version: 4,
    })
    expect(repository.calls.create).toBe(0)
  })

  it('keeps the entered name when the version conflicts', async () => {
    const repository = createMockCategoryRepository([existingCategory])
    // Simulate a concurrent edit: the stored version moves past the form's.
    await repository.update('cat-1', { name: 'Кафе', version: 3 })
    renderForm(repository, existingCategory)

    fireEvent.changeText(screen.getByTestId('category-edit-name'), 'Кафе и десерты')
    fireEvent.press(screen.getByTestId('category-edit-submit'))

    await waitFor(() =>
      expect(screen.getByTestId('category-edit-error')).toHaveTextContent(
        'Изменено другим действием. Обновите и повторите',
      ),
    )
    expect(screen.getByTestId('category-edit-name').props.value).toBe('Кафе и десерты')
  })
})
