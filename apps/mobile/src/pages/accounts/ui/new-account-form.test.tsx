// Create-account form behavior: submit-driven per-field validation (the
// opening-balance field gains the error affordance), the ruble-only payload
// (currency always RUB with no picker rendered), major->minor money
// conversion through the payload mapper, server errors at the root slot
// with values preserved, reset after success, and pending blocking
// duplicates. The form renders standalone - under jest the @gorhom mock
// degrades BottomSheetInput to a plain input (no sheet context needed).

import { describe, expect, it, beforeEach, jest } from '@jest/globals'
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import { QueryClientProvider } from '@tanstack/react-query'
import { AlreadyExistsError, type AccountRepository, type AccountWithBalance } from '@trata/api'
import { ThemeProvider } from '@/shared/config/theme'
import { createQueryClient } from '@/shared/lib/query/query-client'
import { AccountRepositoryProvider } from '@/entities/account'
import { createMockAccountRepository } from '@/shared/lib/testing/mock-account-repository'
import { NewAccountForm } from './new-account-form'

// Anonymous fresh device: no household base and no stored preference, so the
// display-currency chain resolves to the RUB default without touching the db.
jest.mock('@/entities/household', () => ({
  ...(jest.requireActual('@/entities/household') as Record<string, unknown>),
  useHousehold: () => ({ data: undefined }),
  useDisplayCurrency: (householdCurrency?: string) => householdCurrency ?? 'RUB',
}))
type MockRepository = ReturnType<typeof createMockAccountRepository>

const onSuccess = jest.fn()

function renderForm(repository?: MockRepository) {
  const repo = repository ?? createMockAccountRepository([])
  render(
    <QueryClientProvider client={createQueryClient()}>
      <AccountRepositoryProvider repository={repo}>
        <ThemeProvider>
          <NewAccountForm onSuccess={onSuccess} />
        </ThemeProvider>
      </AccountRepositoryProvider>
    </QueryClientProvider>,
  )
  return repo
}

function fillValid() {
  fireEvent.changeText(screen.getByTestId('accounts-create-name'), 'Наличные')
  fireEvent.changeText(screen.getByTestId('accounts-create-opening-balance'), '100,50')
}

describe('NewAccountForm', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('offers no currency choice and always submits RUB', async () => {
    const repository = renderForm()

    expect(screen.queryByTestId('accounts-create-currencies')).toBeNull()

    fillValid()
    fireEvent.press(screen.getByTestId('accounts-create-submit'))

    await waitFor(() => expect(repository.snapshot()).toHaveLength(1))
    expect(repository.snapshot()[0].currency).toBe('RUB')
  })

  it('blocks an empty submit with both field errors and no create call', async () => {
    const repository = renderForm()

    fireEvent.press(screen.getByTestId('accounts-create-submit'))

    expect(await screen.findByTestId('accounts-create-name-error')).toHaveTextContent(
      'Введите название счёта',
    )
    expect(await screen.findByTestId('accounts-create-opening-balance-error')).toHaveTextContent(
      'Некорректная сумма',
    )
    expect(repository.snapshot()).toHaveLength(0)
  })

  it('blocks an unparseable balance with the field error', async () => {
    const repository = renderForm()

    fireEvent.changeText(screen.getByTestId('accounts-create-name'), 'Наличные')
    fireEvent.changeText(screen.getByTestId('accounts-create-opening-balance'), 'abc')
    fireEvent.press(screen.getByTestId('accounts-create-submit'))

    expect(await screen.findByTestId('accounts-create-opening-balance-error')).toHaveTextContent(
      'Некорректная сумма',
    )
    expect(repository.snapshot()).toHaveLength(0)
  })

  it('submits 100,50 major units as 10050 minor units', async () => {
    const repository = renderForm()

    fillValid()
    fireEvent.press(screen.getByTestId('accounts-create-submit'))

    await waitFor(() => expect(repository.snapshot()).toHaveLength(1))
    expect(repository.snapshot()[0]).toMatchObject({
      name: 'Наличные',
      currency: 'RUB',
      openingBalance: 10_050,
    })
    expect(onSuccess).toHaveBeenCalledTimes(1)
  })

  it('accepts a zero opening balance', async () => {
    const repository = renderForm()

    fireEvent.changeText(screen.getByTestId('accounts-create-name'), 'Наличные')
    fireEvent.changeText(screen.getByTestId('accounts-create-opening-balance'), '0')
    fireEvent.press(screen.getByTestId('accounts-create-submit'))

    await waitFor(() => expect(repository.snapshot()).toHaveLength(1))
    expect(repository.snapshot()[0].openingBalance).toBe(0)
  })

  it('surfaces a repository error at the root slot and keeps the values', async () => {
    const repository: AccountRepository = {
      ...createMockAccountRepository([]),
      create: () => Promise.reject(new AlreadyExistsError('Account exists')),
    }
    renderForm(repository as MockRepository)

    fillValid()
    fireEvent.press(screen.getByTestId('accounts-create-submit'))

    await waitFor(() =>
      expect(screen.getByTestId('accounts-create-error')).toHaveTextContent('Уже существует'),
    )
    expect(screen.getByTestId('accounts-create-name').props.value).toBe('Наличные')
    expect(screen.getByTestId('accounts-create-opening-balance').props.value).toBe('100,50')
    expect(onSuccess).not.toHaveBeenCalled()
  })

  it('resets the fields after a successful submit', async () => {
    renderForm()

    fillValid()
    fireEvent.press(screen.getByTestId('accounts-create-submit'))

    await waitFor(() => expect(screen.getByTestId('accounts-create-name').props.value).toBe(''))
    expect(screen.getByTestId('accounts-create-opening-balance').props.value).toBe('')
  })

  it('blocks a double submit while the create is pending', async () => {
    let resolveCreate: (account: AccountWithBalance) => void = () => {}
    const create = jest.fn(
      () => new Promise<AccountWithBalance>((resolve) => void (resolveCreate = resolve)),
    )
    const repository = { ...createMockAccountRepository([]), create }
    renderForm(repository)

    fillValid()
    fireEvent.press(screen.getByTestId('accounts-create-submit'))

    await waitFor(() =>
      expect(screen.getByTestId('accounts-create-submit').props.accessibilityState.disabled).toBe(
        true,
      ),
    )
    fireEvent.press(screen.getByTestId('accounts-create-submit'))
    expect(create).toHaveBeenCalledTimes(1)

    resolveCreate({
      id: 'acc-new',
      name: 'Наличные',
      currency: 'RUB',
      openingBalance: 10_050,
      balance: 10_050,
      version: 1,
    })
  })
})
