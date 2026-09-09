// Plan form behavior (add + edit, reference row layout): amount-input
// validation gating the submit, the monthly/manual/off defaults shown on
// the option rows, the currency chip beside the amount, account/category
// picker rows with the type-filtered category list, the reminder option
// sheet with its permission request, a past next-due date accepted by the
// calendar, the create/update payloads (CAS version on edit), and
// repository errors surfaced at the root slot while entered values are kept.

import { describe, expect, it, beforeEach, jest } from '@jest/globals'
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { QueryClientProvider } from '@tanstack/react-query'
import { calendarDayKey } from '@trata/dates'
import type { Account, Category, PlannedPayment } from '@trata/api'
import * as Notifications from 'expo-notifications'
import { ThemeProvider } from '@/shared/config/theme'
import { createQueryClient } from '@/shared/lib/query/query-client'
import { AccountRepositoryProvider } from '@/entities/account'
import { CategoryRepositoryProvider } from '@/entities/category'
import { PlannedPaymentRepositoryProvider } from '@/entities/planned-payment'
import { createMockAccountRepository } from '@/shared/lib/testing/mock-account-repository'
import { createMockCategoryRepository } from '@/shared/lib/testing/mock-category-repository'
import {
  createMockPlannedPaymentRepository,
  type MockPlannedPaymentRepository,
} from '@/shared/lib/testing/mock-planned-payment-repository'
import { BottomSheetProvider } from '@/shared/ui/bottom-sheet/bottom-sheet-provider'
import { PlanFormSheet, type PlanFormSheetProps } from './plan-form-sheet'

// expo-notifications is a native boundary: an in-memory stand-in records
// permission requests (a first non-off reminder pick triggers one, D9).
jest.mock('expo-notifications', () => {
  const requests = { count: 0 }
  return {
    __esModule: true,
    SchedulableTriggerInputTypes: { DATE: 'date' },
    _requests: requests,
    getAllScheduledNotificationsAsync: async () => [],
    cancelScheduledNotificationAsync: async () => {},
    scheduleNotificationAsync: async () => 'test',
    getPermissionsAsync: async () => ({ granted: false }),
    requestPermissionsAsync: async () => {
      requests.count += 1
      return { granted: false }
    },
  }
})

const mockedNotifications = Notifications as unknown as { _requests: { count: number } }

const ZERO_INSETS = { top: 0, right: 0, bottom: 0, left: 0 }

const ACCOUNTS: Account[] = [
  {
    id: 'acc-main',
    name: 'Основной',
    currency: 'RUB',
    openingBalance: 0,
    version: 1,
  },
  {
    id: 'acc-savings',
    name: 'Накопления',
    currency: 'RUB',
    openingBalance: 0,
    version: 1,
  },
]

const CATEGORIES: Category[] = [
  {
    id: 'cat-fun',
    name: 'Развлечения',
    type: 'expense',
    icon: 'film',
    color: '#7c5cff',
    archivedAt: null,
    version: 1,
  },
  {
    id: 'cat-salary',
    name: 'Зарплата',
    type: 'income',
    icon: 'cash',
    color: '#22c55e',
    archivedAt: null,
    version: 1,
  },
]

const PLAN: PlannedPayment = {
  id: 'plan-1',
  type: 'expense',
  amount: 240_000,
  name: 'Коммуналка',
  accountId: 'acc-main',
  categoryId: 'cat-fun',
  nextDue: '2026-09-05',
  anchorDate: '2026-09-05',
  regularity: 'monthly',
  confirmMode: 'manual',
  reminder: 'off',
  note: 'старая заметка',
  version: 3,
}

function renderForm(
  props: PlanFormSheetProps,
  planRepository: MockPlannedPaymentRepository = createMockPlannedPaymentRepository(
    props.plan ? [props.plan] : [],
  ),
) {
  render(
    <SafeAreaProvider
      initialMetrics={{ frame: { x: 0, y: 0, width: 0, height: 0 }, insets: ZERO_INSETS }}
    >
      <ThemeProvider>
        <QueryClientProvider client={createQueryClient()}>
          <AccountRepositoryProvider repository={createMockAccountRepository(ACCOUNTS)}>
            <CategoryRepositoryProvider repository={createMockCategoryRepository(CATEGORIES)}>
              <PlannedPaymentRepositoryProvider repository={planRepository}>
                <BottomSheetProvider>
                  <PlanFormSheet {...props} />
                </BottomSheetProvider>
              </PlannedPaymentRepositoryProvider>
            </CategoryRepositoryProvider>
          </AccountRepositoryProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </SafeAreaProvider>,
  )
  return { planRepository }
}

/** The amount is typed into the decimal-pad input (sanitized on change). */
function typeAmount(value: string) {
  fireEvent.changeText(screen.getByTestId('plans-form-amount'), value)
}

/** Selects through the stacked picker sheet (options settle a tick later). */
async function selectAccount(id: string) {
  fireEvent.press(screen.getByTestId('plans-form-account'))
  fireEvent.press(await screen.findByTestId(`plans-form-account-option-${id}`))
}

async function selectCategory(id: string) {
  fireEvent.press(screen.getByTestId('plans-form-category'))
  fireEvent.press(await screen.findByTestId(`new-transaction-category-option-${id}`))
}

describe('PlanFormSheet (create)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockedNotifications._requests.count = 0
  })

  it('defaults to monthly / manual / off and gates the submit on the required fields', async () => {
    const { planRepository } = renderForm({ type: 'expense' })

    // The option rows carry their default values (monthly / manual / off).
    expect(screen.getByTestId('plans-form-regularity')).toHaveTextContent(/Каждый месяц/)
    expect(screen.getByTestId('plans-form-confirm-mode')).toHaveTextContent(/Ручное/)
    expect(screen.getByTestId('plans-form-reminder')).toHaveTextContent(/Выкл/)
    expect(screen.getByText('Счёт списания')).toBeTruthy()
    // The amount carries the currency chip (₽ fallback before an account).
    expect(screen.getByTestId('plans-form-currency')).toHaveTextContent('₽')

    expect(screen.getByTestId('plans-form-submit')).toBeDisabled()

    // Amount alone is not enough — the account and category are required too.
    typeAmount('599')
    expect(screen.getByTestId('plans-form-submit')).toBeDisabled()
    await selectAccount('acc-main')
    expect(screen.getByTestId('plans-form-submit')).toBeDisabled()
    await selectCategory('cat-fun')

    await waitFor(() => expect(screen.getByTestId('plans-form-submit')).toBeEnabled())
    expect(planRepository.calls.create).toBe(0)
  })

  it('rejects a zero amount with the shared validation message', async () => {
    renderForm({ type: 'expense' })
    await selectAccount('acc-main')
    await selectCategory('cat-fun')

    typeAmount('0')
    await waitFor(() =>
      expect(screen.getByTestId('plans-form-amount-error')).toHaveTextContent('Некорректная сумма'),
    )
    expect(screen.getByTestId('plans-form-submit')).toBeDisabled()
  })

  it('creates a plan with the typed amount, picked refs, and the defaults', async () => {
    const { planRepository } = renderForm({ type: 'expense' })

    typeAmount('59999')
    await selectAccount('acc-savings')
    await selectCategory('cat-fun')
    await waitFor(() => expect(screen.getByTestId('plans-form-submit')).toBeEnabled())
    fireEvent.press(screen.getByTestId('plans-form-submit'))

    await waitFor(() => expect(planRepository.calls.create).toBe(1))
    expect(planRepository.snapshot().at(-1)).toMatchObject({
      type: 'expense',
      amount: 5_999_900,
      accountId: 'acc-savings',
      categoryId: 'cat-fun',
      regularity: 'monthly',
      confirmMode: 'manual',
      reminder: 'off',
      nextDue: calendarDayKey(new Date()),
    })
  })

  it('accepts a past next-due date picked from the calendar', async () => {
    const { planRepository } = renderForm({ type: 'expense' })
    typeAmount('100')
    await selectAccount('acc-main')
    await selectCategory('cat-fun')

    // Step the calendar back one month and pick the 15th — strictly past.
    fireEvent.press(screen.getByTestId('plans-form-date'))
    fireEvent.press(await screen.findByTestId('new-transaction-calendar-prev'))
    const previous = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 15)
    fireEvent.press(
      await screen.findByTestId(`new-transaction-calendar-day-${calendarDayKey(previous)}`),
    )

    fireEvent.press(screen.getByTestId('plans-form-submit'))

    await waitFor(() => expect(planRepository.calls.create).toBe(1))
    expect(planRepository.snapshot().at(-1)).toMatchObject({
      nextDue: calendarDayKey(previous),
      anchorDate: calendarDayKey(previous),
    })
  })

  it('offers only the income categories for an income plan', async () => {
    renderForm({ type: 'income' })

    expect(screen.getByText('Счёт зачисления')).toBeTruthy()
    fireEvent.press(screen.getByTestId('plans-form-category'))

    expect(await screen.findByTestId('new-transaction-category-option-cat-salary')).toBeTruthy()
    // The expense category is filtered out by the plan's fixed type.
    expect(screen.queryByTestId('new-transaction-category-option-cat-fun')).toBeNull()
  })

  it('switches the reminder through its option sheet and requests permission once', async () => {
    renderForm({ type: 'expense' })

    fireEvent.press(screen.getByTestId('plans-form-reminder'))
    fireEvent.press(await screen.findByTestId('plans-form-reminder-option-on_day'))

    expect(screen.getByTestId('plans-form-reminder')).toHaveTextContent(/В день/)
    expect(mockedNotifications._requests.count).toBe(1)
  })
})

describe('PlanFormSheet (edit)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('prefills from the plan and submits an update with the CAS version', async () => {
    const { planRepository } = renderForm({ plan: PLAN })

    await waitFor(() => expect(screen.getByDisplayValue('2\u202F400')).toBeTruthy())
    expect(screen.getByDisplayValue('Коммуналка')).toBeTruthy()
    expect(screen.getByTestId('plans-form-delete')).toBeTruthy()

    // 2400 → 2650: the spec's adjusted-utilities example.
    typeAmount('2650')
    fireEvent.press(screen.getByTestId('plans-form-submit'))

    await waitFor(() => expect(planRepository.calls.update).toBe(1))
    expect(planRepository.snapshot()[0]).toMatchObject({
      amount: 265_000,
      version: 4,
      name: 'Коммуналка',
      note: 'старая заметка',
    })
  })

  it('maps a repository error to the root slot and keeps the entered values', async () => {
    // The plan is NOT in the repository: the update lands as not-found.
    const { planRepository } = renderForm({ plan: PLAN }, createMockPlannedPaymentRepository([]))

    await waitFor(() => expect(screen.getByTestId('plans-form-submit')).toBeEnabled())
    fireEvent.press(screen.getByTestId('plans-form-submit'))

    await waitFor(() =>
      expect(screen.getByTestId('plans-form-error')).toHaveTextContent('Не найдено'),
    )
    expect(planRepository.calls.update).toBe(1)
    // Values survive the failure so the user can retry.
    expect(screen.getByDisplayValue('2\u202F400')).toBeTruthy()
  })
})
