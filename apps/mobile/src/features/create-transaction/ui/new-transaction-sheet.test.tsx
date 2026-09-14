// Create-transaction sheet + form behavior. The sheet-level harness exercises
// the composite through the presented sheet (picker stacking, keypad-driven
// amount, live submit validity, payloads, errors). The full-reset assertion
// renders the form standalone: on success the container dismisses the sheet,
// which unmounts the form under the jest @gorhom mock, so post-submit field
// state is only observable below the container.

import { act } from 'react'
import { describe, expect, it, beforeEach, jest } from '@jest/globals'
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { QueryClientProvider } from '@tanstack/react-query'
import { UnknownReferencesError, type Transaction } from '@trata/api'
import { ThemeProvider } from '@/shared/config/theme'
import { createQueryClient } from '@/shared/lib/query/query-client'
import { AccountRepositoryProvider } from '@/entities/account'
import { createMockAccountRepository } from '@/shared/lib/testing/mock-account-repository'
import { CategoryRepositoryProvider } from '@/entities/category'
import { createMockCategoryRepository } from '@/shared/lib/testing/mock-category-repository'
import { TransactionRepositoryProvider } from '@/entities/transaction'
import { createMockTransactionRepository } from '@/shared/lib/testing/mock-transaction-repository'
import { BottomSheetProvider } from '@/shared/ui/bottom-sheet/bottom-sheet-provider'
import type { BottomSheetRef } from '@/shared/ui/bottom-sheet'
import { NewTransactionForm } from './new-transaction-form'
import { NewTransactionSheet } from './new-transaction-sheet'

// These suites run on a fresh anonymous device: no stored display-currency
// preference, so the resolution chain falls through to the household base
// (undefined here) and then the RUB default.
jest.mock('@/shared/lib/db/app-settings', () => ({
  ...(jest.requireActual('@/shared/lib/db/app-settings') as Record<string, unknown>),
  useDisplayCurrencySetting: () => ({ data: null, setDisplayCurrency: jest.fn() }),
}))
// No cached rates on a fresh device: aggregates render exact native figures.
jest.mock('@/shared/lib/db/rates', () => ({
  ...(jest.requireActual('@/shared/lib/db/rates') as Record<string, unknown>),
  useRates: () => ({ data: null }),
}))

const ZERO_INSETS = { top: 0, right: 0, bottom: 0, left: 0 }

const ACCOUNTS = [
  {
    id: 'acc-rub-1',
    name: 'Карта',
    currency: 'RUB' as const,
    openingBalance: 0,
    manualAdjustment: 0,
    version: 1,
  },
  {
    id: 'acc-rub-2',
    name: 'Наличные',
    currency: 'RUB' as const,
    openingBalance: 0,
    manualAdjustment: 0,
    version: 1,
  },
  {
    id: 'acc-usd',
    name: 'Dollar',
    currency: 'USD' as const,
    openingBalance: 0,
    manualAdjustment: 0,
    version: 1,
  },
]

const CATEGORIES = [
  {
    id: 'cat-cafe',
    name: 'Кафе',
    type: 'expense' as const,
    icon: 'cafe',
    color: '#a78bfa',
    archivedAt: null,
    version: 1,
  },
  {
    id: 'cat-salary',
    name: 'Зарплата',
    type: 'income' as const,
    icon: 'cash',
    color: '#16a34a',
    archivedAt: null,
    version: 1,
  },
]

function providers(
  client: ReturnType<typeof createQueryClient>,
  transactionRepository: ReturnType<typeof createMockTransactionRepository>,
  children: React.ReactNode,
) {
  return (
    <SafeAreaProvider
      initialMetrics={{ insets: ZERO_INSETS, frame: { x: 0, y: 0, width: 375, height: 812 } }}
    >
      <QueryClientProvider client={client}>
        <AccountRepositoryProvider repository={createMockAccountRepository(ACCOUNTS)}>
          <CategoryRepositoryProvider repository={createMockCategoryRepository(CATEGORIES)}>
            <TransactionRepositoryProvider repository={transactionRepository}>
              <ThemeProvider>
                <BottomSheetProvider>{children}</BottomSheetProvider>
              </ThemeProvider>
            </TransactionRepositoryProvider>
          </CategoryRepositoryProvider>
        </AccountRepositoryProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  )
}

async function renderSheet(
  kind: 'expense' | 'income' | 'transfer',
  transactionRepository = createMockTransactionRepository(),
) {
  const sheetRef = { current: null as BottomSheetRef | null }
  const queryClient = createQueryClient()
  const tree = (k: 'expense' | 'income' | 'transfer') => (
    <QueryClientProvider client={queryClient}>
      <AccountRepositoryProvider repository={createMockAccountRepository(ACCOUNTS)}>
        <CategoryRepositoryProvider repository={createMockCategoryRepository(CATEGORIES)}>
          <TransactionRepositoryProvider repository={transactionRepository}>
            <ThemeProvider>
              <BottomSheetProvider>
                <NewTransactionSheet ref={sheetRef} kind={k} />
              </BottomSheetProvider>
            </ThemeProvider>
          </TransactionRepositoryProvider>
        </CategoryRepositoryProvider>
      </AccountRepositoryProvider>
    </QueryClientProvider>
  )
  const view = render(
    <SafeAreaProvider
      initialMetrics={{ insets: ZERO_INSETS, frame: { x: 0, y: 0, width: 375, height: 812 } }}
    >
      {tree(kind)}
    </SafeAreaProvider>,
  )
  await act(async () => {
    sheetRef.current?.present()
  })
  return {
    transactionRepository,
    rerenderKind: async (k: 'expense' | 'income' | 'transfer') => {
      await act(async () => {
        view.rerender(
          <SafeAreaProvider
            initialMetrics={{
              insets: ZERO_INSETS,
              frame: { x: 0, y: 0, width: 375, height: 812 },
            }}
          >
            {tree(k)}
          </SafeAreaProvider>,
        )
      })
    },
  }
}

/** Standalone form harness (see the file comment for why reset is tested here). */
function renderForm(kind: 'expense' | 'income' | 'transfer') {
  const transactionRepository = createMockTransactionRepository()
  render(
    providers(
      createQueryClient(),
      transactionRepository,
      <NewTransactionForm kind={kind} onSuccess={jest.fn()} />,
    ),
  )
  return transactionRepository
}

/** The amount is entered through keypad key presses - never a text input. */
function typeAmount(keys: string[]) {
  for (const key of keys) {
    fireEvent.press(screen.getByTestId(`new-transaction-key-${key}`))
  }
}

/** Selects the account through the stacked picker sheet. */
async function selectAccount(prefix: string, accountId: string) {
  fireEvent.press(screen.getByTestId(prefix))
  fireEvent.press(await screen.findByTestId(`${prefix}-option-${accountId}`))
}

/** The account/category queries settle one tick after the sheet presents. */
async function fillExpenseValid() {
  typeAmount(['1', '2', 'separator', '5'])
  await selectAccount('new-transaction-account', 'acc-rub-1')
  fireEvent.press(await screen.findByTestId('new-transaction-category-cat-cafe'))
}

const submitDisabled = () =>
  screen.getByTestId('new-transaction-submit').props.accessibilityState.disabled as boolean

/** zodResolver validation is async - wait for the live validity to settle. */
async function expectSubmitEnabled() {
  await waitFor(() => expect(submitDisabled()).toBe(false))
}

describe('NewTransactionSheet', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('opens with a zero amount, no system-keyboard input, and a disabled submit', async () => {
    await renderSheet('expense')

    expect(screen.getByTestId('new-transaction-amount')).toHaveTextContent('0\u00A0₽')
    expect(screen.queryByTestId('new-transaction-note-input')).toBeNull()
    expect(screen.queryByTestId('new-transaction-quick-dates')).toBeNull()
    expect(submitDisabled()).toBe(true)
  })

  it('creates an expense with a decimal keypad amount, account, and category', async () => {
    const { transactionRepository: repository } = await renderSheet('expense')

    await fillExpenseValid()
    expect(screen.getByTestId('new-transaction-amount')).toHaveTextContent('12,5\u00A0₽')
    await expectSubmitEnabled()

    fireEvent.press(screen.getByTestId('new-transaction-submit'))

    await waitFor(() => expect(repository.snapshot()).toHaveLength(1))
    const [created] = repository.snapshot()
    expect(created).toMatchObject({
      type: 'expense',
      amount: 1_250,
      accountId: 'acc-rub-1',
      categoryId: 'cat-cafe',
      description: '',
    })
    expect(typeof created.occurredAt).toBe('string')
  })

  it('keeps the submit disabled until every required field is set', async () => {
    const { transactionRepository: repository } = await renderSheet('expense')

    // Amount alone is not enough.
    typeAmount(['2', '5', '0'])
    expect(submitDisabled()).toBe(true)

    // Still missing the category.
    await selectAccount('new-transaction-account', 'acc-rub-1')
    expect(submitDisabled()).toBe(true)

    // A zero amount never unlocks the submit even with everything else set.
    fireEvent.press(await screen.findByTestId('new-transaction-category-cat-cafe'))
    typeAmount(['backspace', 'backspace', 'backspace', 'backspace', '0'])
    await waitFor(() => expect(submitDisabled()).toBe(true))
    expect(screen.getByTestId('new-transaction-amount')).toHaveTextContent('0\u00A0₽')

    typeAmount(['backspace', '2', '5', '0'])
    await expectSubmitEnabled()
    expect(repository.snapshot()).toHaveLength(0)
  })

  it('selects transfer accounts through pickers: every other account is a destination', async () => {
    const { transactionRepository: repository } = await renderSheet('transfer')

    // The destination stays disabled until the source is picked.
    expect(screen.getByTestId('new-transaction-to').props.accessibilityState.disabled).toBe(true)

    await selectAccount('new-transaction-from', 'acc-rub-1')

    // The destination picker offers every other account regardless of
    // currency; only the source itself is excluded.
    expect(screen.getByTestId('new-transaction-to').props.accessibilityState.disabled).toBe(false)
    fireEvent.press(screen.getByTestId('new-transaction-to'))
    expect(await screen.findByTestId('new-transaction-to-option-acc-usd')).toBeTruthy()
    expect(screen.queryByTestId('new-transaction-to-option-acc-rub-1')).toBeNull()

    fireEvent.press(screen.getByTestId('new-transaction-to-option-acc-rub-2'))
    typeAmount(['1', '0', '0'])
    await expectSubmitEnabled()
    fireEvent.press(screen.getByTestId('new-transaction-submit'))

    await waitFor(() => expect(repository.snapshot()).toHaveLength(1))
    const [created] = repository.snapshot()
    // Same-currency transfer: no destination amount is ever sent.
    expect(created).toMatchObject({
      type: 'transfer',
      amount: 10_000,
      fromAccountId: 'acc-rub-1',
      toAccountId: 'acc-rub-2',
    })
    expect(created).not.toHaveProperty('destinationAmount')
  })

  it('re-initializes the form when the flow kind changes', async () => {
    const { rerenderKind } = await renderSheet('expense')

    typeAmount(['1', '2', '3'])
    await selectAccount('new-transaction-account', 'acc-rub-1')

    await rerenderKind('transfer')

    expect(screen.getByTestId('new-transaction-amount')).toHaveTextContent('0\u00A0₽')
    expect(screen.getByTestId('new-transaction-from')).toBeTruthy()
    expect(screen.queryByTestId('new-transaction-account')).toBeNull()
    // Both transfer rows show the placeholder after the re-initialization.
    expect(screen.getAllByText('Выберите счёт')).toHaveLength(2)
  })

  it('keeps a note across hide/reopen and sends it with the transaction', async () => {
    const { transactionRepository: repository } = await renderSheet('expense')

    fireEvent.press(screen.getByTestId('new-transaction-note-button'))
    fireEvent.changeText(screen.getByTestId('new-transaction-note-input'), 'Кофе с коллегами')

    // Hiding collapses the input but keeps the text in form state.
    fireEvent.press(screen.getByTestId('new-transaction-note-button'))
    expect(screen.queryByTestId('new-transaction-note-input')).toBeNull()
    fireEvent.press(screen.getByTestId('new-transaction-note-button'))
    expect(screen.getByTestId('new-transaction-note-input').props.value).toBe('Кофе с коллегами')

    await fillExpenseValid()
    await expectSubmitEnabled()
    fireEvent.press(screen.getByTestId('new-transaction-submit'))

    await waitFor(() => expect(repository.snapshot()).toHaveLength(1))
    expect(repository.snapshot()[0]).toMatchObject({ description: 'Кофе с коллегами' })
  })

  it('shifts the date through the quick chips', async () => {
    const { transactionRepository: repository } = await renderSheet('expense')

    fireEvent.press(screen.getByTestId('new-transaction-date-button'))
    fireEvent.press(screen.getByTestId('new-transaction-quick-date-1'))

    // The chip is selected and (after collapsing the row) the date control
    // shows the shifted label - "Вчера" also exists as a chip, so collapse
    // first to make the label the only match.
    expect(
      screen.getByTestId('new-transaction-quick-date-1').props.accessibilityState.selected,
    ).toBe(true)
    fireEvent.press(screen.getByTestId('new-transaction-date-button'))
    expect(screen.getByText('Вчера')).toBeTruthy()

    await fillExpenseValid()
    await expectSubmitEnabled()
    fireEvent.press(screen.getByTestId('new-transaction-submit'))

    await waitFor(() => expect(repository.snapshot()).toHaveLength(1))
    const occurredAt = new Date(repository.snapshot()[0].occurredAt)
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    expect(occurredAt.getDate()).toBe(yesterday.getDate())
  })

  it('picks a custom date from the calendar sheet', async () => {
    await renderSheet('expense')

    fireEvent.press(screen.getByTestId('new-transaction-date-button'))
    fireEvent.press(screen.getByTestId('new-transaction-quick-date-other'))

    // Today's cell keeps the "Сегодня" label; collapse the quick row so the
    // label is the only "Сегодня" match.
    const now = new Date()
    const pad = (value: number) => String(value).padStart(2, '0')
    const todayKey = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
    fireEvent.press(screen.getByTestId(`new-transaction-calendar-day-${todayKey}`))

    fireEvent.press(screen.getByTestId('new-transaction-date-button'))
    expect(screen.getByText('Сегодня')).toBeTruthy()
  })

  it('surfaces a repository error at the root slot and keeps the values', async () => {
    const repository = {
      ...createMockTransactionRepository(),
      create: () => Promise.reject(new UnknownReferencesError('Unknown account')),
    }
    await renderSheet('expense', repository)

    await fillExpenseValid()
    await expectSubmitEnabled()
    fireEvent.press(screen.getByTestId('new-transaction-submit'))

    await waitFor(() =>
      expect(screen.getByTestId('new-transaction-error')).toHaveTextContent(
        'Указан неизвестный счёт или категория',
      ),
    )
    expect(screen.getByTestId('new-transaction-amount')).toHaveTextContent('12,5\u00A0₽')
  })

  it('blocks a double submit while the create is pending', async () => {
    let resolveCreate: (transaction: Transaction) => void = () => {}
    const create = jest.fn(
      () => new Promise<Transaction>((resolve) => void (resolveCreate = resolve)),
    )
    const repository = { ...createMockTransactionRepository(), create }
    await renderSheet('expense', repository)

    await fillExpenseValid()
    await expectSubmitEnabled()
    fireEvent.press(screen.getByTestId('new-transaction-submit'))

    await waitFor(() => expect(submitDisabled()).toBe(true))
    fireEvent.press(screen.getByTestId('new-transaction-submit'))
    expect(create).toHaveBeenCalledTimes(1)

    resolveCreate({
      id: 'tx-new',
      type: 'expense',
      amount: 1_250,
      description: '',
      occurredAt: new Date().toISOString(),
      version: 1,
      accountId: 'acc-rub-1',
      categoryId: 'cat-cafe',
    })
  })
})

describe('NewTransactionForm', () => {
  it('fully resets after a successful submit - selections do not survive', async () => {
    const repository = renderForm('expense')

    await fillExpenseValid()
    await expectSubmitEnabled()
    fireEvent.press(screen.getByTestId('new-transaction-submit'))

    await waitFor(() => expect(repository.snapshot()).toHaveLength(1))
    expect(screen.getByTestId('new-transaction-amount')).toHaveTextContent('0\u00A0₽')
    expect(screen.getByText('Выберите счёт')).toBeTruthy()
    await waitFor(() => expect(submitDisabled()).toBe(true))
  })
})
