// Edit-transaction form behavior over the EditTransactionSheet harness:
// the record's type drives the header title and the field set (cash flows
// carry a category, transfers carry two account rows), the amount round-trips
// through the grouped input, Save writes through `update` with the record's
// version, a version conflict keeps the entered values, and Delete goes
// through the native-alert confirmation.

import { createRef } from 'react'
import { describe, expect, it, jest, beforeEach } from '@jest/globals'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { QueryClientProvider } from '@tanstack/react-query'
import { Alert } from 'react-native'
import { VersionConflictError, type Account, type Category, type Transaction } from '@trata/api'
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
import { EditTransactionSheet } from './edit-transaction-sheet'

// Authorship markers (household-ux 2.4) resolve against the household cache;
// the defaults are anonymous with no members (no marker renders), and the
// marker tests flip these to a multi-member household.
let mockAuth: { status: 'authenticated' | 'anonymous'; user: { id: string } | null } = {
  status: 'anonymous',
  user: null,
}
let mockMembers: readonly import('@trata/api').HouseholdMember[] | null = null

jest.mock('@/entities/session', () => ({
  ...(jest.requireActual('@/entities/session') as Record<string, unknown>),
  useAuth: () => mockAuth,
}))

jest.mock('@/entities/household', () => ({
  ...(jest.requireActual('@/entities/household') as Record<string, unknown>),
  useHousehold: () => ({ data: mockMembers ? { members: mockMembers } : undefined }),
}))

beforeEach(() => {
  mockAuth = { status: 'anonymous', user: null }
  mockMembers = null
})
const ZERO_INSETS = { top: 0, right: 0, left: 0, bottom: 0 }

const ACCOUNTS: Account[] = [
  {
    id: 'acc-card',
    name: 'Карта',
    currency: 'RUB',
    openingBalance: 0,
    version: 1,
  },
  {
    id: 'acc-cash',
    name: 'Наличные',
    currency: 'RUB',
    openingBalance: 0,
    version: 1,
  },
]

const CATEGORIES: Category[] = [
  {
    id: 'cat-taxi',
    name: 'Такси',
    type: 'expense',
    icon: 'car',
    color: '#7c5cff',
    archivedAt: null,
    version: 1,
  },
  {
    id: 'cat-gift',
    name: 'Подарки',
    type: 'income',
    icon: 'gift',
    color: '#16a34a',
    archivedAt: null,
    version: 1,
  },
]

const EXPENSE: Transaction = {
  id: 'tx-expense',
  type: 'expense',
  amount: 1_931_300,
  description: 'Поездка в центр',
  occurredAt: '2026-08-02T09:00:00.000Z',
  version: 3,
  accountId: 'acc-card',
  categoryId: 'cat-taxi',
}

const INCOME: Transaction = {
  id: 'tx-income',
  type: 'income',
  amount: 1_500_000,
  description: 'Аванс',
  occurredAt: '2026-08-05T09:00:00.000Z',
  version: 1,
  accountId: 'acc-cash',
  categoryId: 'cat-gift',
}

const TRANSFER: Transaction = {
  id: 'tx-transfer',
  type: 'transfer',
  amount: 454_500,
  description: 'На наличные',
  occurredAt: '2026-08-06T09:00:00.000Z',
  version: 2,
  fromAccountId: 'acc-card',
  toAccountId: 'acc-cash',
}

function renderSheet(transaction: Transaction) {
  const base = createMockTransactionRepository([transaction])
  const update = jest.fn(base.update.bind(base))
  const repository = { ...base, update }
  const sheetRef = createRef<BottomSheetRef>()

  render(
    <SafeAreaProvider
      initialMetrics={{ insets: ZERO_INSETS, frame: { x: 0, y: 0, width: 375, height: 812 } }}
    >
      <QueryClientProvider client={createQueryClient()}>
        <AccountRepositoryProvider repository={createMockAccountRepository(ACCOUNTS)}>
          <CategoryRepositoryProvider repository={createMockCategoryRepository(CATEGORIES)}>
            <TransactionRepositoryProvider repository={repository}>
              <ThemeProvider>
                <BottomSheetProvider>
                  <EditTransactionSheet ref={sheetRef} transactionId={transaction.id} />
                </BottomSheetProvider>
              </ThemeProvider>
            </TransactionRepositoryProvider>
          </CategoryRepositoryProvider>
        </AccountRepositoryProvider>
      </QueryClientProvider>
    </SafeAreaProvider>,
  )

  act(() => sheetRef.current?.present())
  return { repository, update, dismiss: () => act(() => sheetRef.current?.dismiss()) }
}

async function openLoaded(transaction: Transaction) {
  const harness = renderSheet(transaction)
  await waitFor(() => expect(screen.getByTestId('edit-transaction-save')).toBeTruthy())
  return harness
}

describe('EditTransactionForm · field set per type', () => {
  it('prefills the expense form: grouped amount, account, category, currency chip', async () => {
    await openLoaded(EXPENSE)

    expect(screen.getByText('Расход')).toBeTruthy()
    // 1_931_300 minor -> "19313" canonical, displayed grouped.
    expect(screen.getByTestId('edit-transaction-amount')).toHaveDisplayValue('19\u202F313')
    expect(screen.getByTestId('edit-transaction-currency')).toHaveTextContent('₽')
    expect(screen.getByText('Счёт списания')).toBeTruthy()
    expect(screen.getByText('Карта')).toBeTruthy()
    expect(screen.getByText('Категория')).toBeTruthy()
    expect(screen.getByText('Такси')).toBeTruthy()
    expect(screen.getByText('Дата')).toBeTruthy()
    expect(screen.getByDisplayValue('Поездка в центр')).toBeTruthy()
    expect(screen.queryByText('Счёт пополнения')).toBeNull()
  })

  it('prefills the transfer form with two account rows and no category', async () => {
    await openLoaded(TRANSFER)

    expect(screen.getByText('Перевод')).toBeTruthy()
    expect(screen.getByTestId('edit-transaction-amount')).toHaveDisplayValue('4\u202F545')
    expect(screen.getByTestId('edit-transaction-from')).toBeTruthy()
    expect(screen.getByTestId('edit-transaction-to')).toBeTruthy()
    expect(screen.queryByTestId('edit-transaction-category')).toBeNull()
  })

  it('renders the income wording', async () => {
    await openLoaded(INCOME)

    expect(screen.getByText('Доход')).toBeTruthy()
    expect(screen.getByText('Счёт пополнения')).toBeTruthy()
    expect(screen.getByText('Наличные')).toBeTruthy()
  })
})

describe('EditTransactionForm · amount input', () => {
  it('sanitizes typed text and displays it grouped', async () => {
    await openLoaded(EXPENSE)

    fireEvent.changeText(screen.getByTestId('edit-transaction-amount'), '31 343.5')

    expect(screen.getByTestId('edit-transaction-amount')).toHaveDisplayValue('31\u202F343,5')
  })

  it('keeps Save disabled until the amount parses to a positive value', async () => {
    await openLoaded(EXPENSE)
    await waitFor(() => expect(screen.getByTestId('edit-transaction-save')).toBeEnabled())

    fireEvent.changeText(screen.getByTestId('edit-transaction-amount'), '')

    await waitFor(() => expect(screen.getByTestId('edit-transaction-save')).toBeDisabled())
  })
})

describe('EditTransactionForm · save', () => {
  it('sends the editable fields with the record version through update', async () => {
    const { update } = await openLoaded(EXPENSE)

    fireEvent.press(screen.getByTestId('edit-transaction-save'))

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    expect(update).toHaveBeenCalledWith('tx-expense', {
      amount: 1_931_300,
      description: 'Поездка в центр',
      occurredAt: EXPENSE.occurredAt,
      accountId: 'acc-card',
      categoryId: 'cat-taxi',
      version: 3,
    })
  })

  it('sends the transfer variant without a category', async () => {
    const { update } = await openLoaded(TRANSFER)

    fireEvent.press(screen.getByTestId('edit-transaction-save'))

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    expect(update).toHaveBeenCalledWith('tx-transfer', {
      amount: 454_500,
      description: 'На наличные',
      occurredAt: TRANSFER.occurredAt,
      fromAccountId: 'acc-card',
      toAccountId: 'acc-cash',
      version: 2,
    })
  })

  it('converts an edited amount exactly once at the submit seam', async () => {
    const { update } = await openLoaded(EXPENSE)

    fireEvent.changeText(screen.getByTestId('edit-transaction-amount'), '31343,5')
    fireEvent.press(screen.getByTestId('edit-transaction-save'))

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    const [, payload] = update.mock.calls[0] as unknown as [string, { amount: number }]
    expect(payload.amount).toBe(3_134_350)
  })

  it('surfaces a version conflict and keeps the entered values', async () => {
    const harness = await openLoaded(EXPENSE)
    harness.update.mockImplementation(() => {
      throw new VersionConflictError('Transaction was modified concurrently', {
        apiCode: 'TRANSACTION_VERSION_CONFLICT',
      })
    })

    fireEvent.changeText(screen.getByTestId('edit-transaction-amount'), '9 999')
    fireEvent.press(screen.getByTestId('edit-transaction-save'))

    await waitFor(() =>
      expect(screen.getByTestId('edit-transaction-error')).toHaveTextContent(
        'Изменено другим действием. Обновите и повторите',
      ),
    )
    expect(screen.getByTestId('edit-transaction-amount')).toHaveDisplayValue('9\u202F999')
  })
})

describe('EditTransactionForm · delete', () => {
  const alertSpy = jest.spyOn(Alert, 'alert')

  it('does nothing when the native alert is cancelled', async () => {
    alertSpy.mockImplementation((_title, _message, buttons) => {
      buttons?.find((button) => button.style === 'cancel')?.onPress?.()
    })
    const { repository } = await openLoaded(EXPENSE)

    fireEvent.press(screen.getByTestId('edit-transaction-delete'))

    expect(alertSpy).toHaveBeenCalledWith('Удалить транзакцию?', undefined, expect.anything())
    expect(repository.calls.remove).toBe(0)
  })

  it('removes the transaction through the repository on confirmation', async () => {
    alertSpy.mockImplementation((_title, _message, buttons) => {
      buttons?.find((button) => button.style === 'destructive')?.onPress?.()
    })
    const { repository } = await openLoaded(EXPENSE)

    fireEvent.press(screen.getByTestId('edit-transaction-delete'))

    await waitFor(() => expect(repository.calls.remove).toBe(1))
  })
})

describe('EditTransactionForm · authorship detail line', () => {
  const ME = 'u-me'
  const SIBLING = 'u-sibling'

  function membersOf(...ids: string[]) {
    return ids.map((userId) => ({
      userId,
      email: `${userId}@example.com`,
      displayName: userId === SIBLING ? 'Жена' : null,
      role: 'owner' as const,
      joinedAt: '2026-08-01T00:00:00.000Z',
    }))
  }

  it('shows the sibling author in the detail', async () => {
    mockAuth = { status: 'authenticated', user: { id: ME } }
    mockMembers = membersOf(ME, SIBLING)
    await openLoaded({ ...EXPENSE, authorId: SIBLING } as Transaction)

    expect(screen.getByTestId('edit-transaction-author-tx-expense')).toHaveTextContent(
      'Кем записано: Жена',
    )
  })

  it('shows own provenance as «вами» even in a single-member household', async () => {
    mockAuth = { status: 'authenticated', user: { id: ME } }
    mockMembers = membersOf(ME)
    await openLoaded({ ...EXPENSE, authorId: ME } as Transaction)

    expect(screen.getByTestId('edit-transaction-author-tx-expense')).toHaveTextContent(
      'Кем записано: вами',
    )
  })

  it('renders no line for unknown authors or anonymous mode', async () => {
    mockAuth = { status: 'authenticated', user: { id: ME } }
    mockMembers = membersOf(ME, SIBLING)
    await openLoaded({ ...EXPENSE, authorId: 'u-departed' } as Transaction)
    expect(screen.queryByTestId('edit-transaction-author-tx-expense')).toBeNull()
  })
})
