import { describe, expect, it, jest } from '@jest/globals'
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { QueryClientProvider } from '@tanstack/react-query'
import { formatMoney } from '@trata/money'
import { ReferentialIntegrityError, type AccountRepository } from '@trata/api'
import { ThemeProvider } from '@/shared/config/theme'
import { createQueryClient } from '@/shared/lib/query/query-client'
import { AccountRepositoryProvider } from '@/entities/account'
import { createMockAccountRepository } from '@/shared/lib/testing/mock-account-repository'
import { BottomSheetProvider } from '@/shared/ui/bottom-sheet/bottom-sheet-provider'
import { AccountsScreen } from './accounts-screen'

// ScreenHeader's default back goes through the router.
jest.mock('expo-router', () => ({ useRouter: () => ({ back: jest.fn() }) }))

const ZERO_INSETS = { top: 0, right: 0, bottom: 0, left: 0 }

const ACCOUNTS = [
  {
    id: 'acc-1',
    name: 'Карта',
    currency: 'RUB' as const,
    openingBalance: 150_000,
    version: 1,
  },
  {
    id: 'acc-2',
    name: 'Cash',
    currency: 'USD' as const,
    openingBalance: 6_000,
    version: 1,
  },
]

function renderAccounts(repositoryInput?: AccountRepository) {
  const repository = (repositoryInput ??
    createMockAccountRepository(ACCOUNTS)) as AccountRepository & {
    snapshot: () => typeof ACCOUNTS
  }
  render(
    <SafeAreaProvider
      initialMetrics={{ insets: ZERO_INSETS, frame: { x: 0, y: 0, width: 375, height: 812 } }}
    >
      <QueryClientProvider client={createQueryClient()}>
        <AccountRepositoryProvider repository={repository}>
          <ThemeProvider>
            <BottomSheetProvider>
              <AccountsScreen />
            </BottomSheetProvider>
          </ThemeProvider>
        </AccountRepositoryProvider>
      </QueryClientProvider>
    </SafeAreaProvider>,
  )
  return repository
}

describe('AccountsScreen', () => {
  it('lists accounts with computed balances', async () => {
    renderAccounts()

    await waitFor(() => expect(screen.getByText('Карта')).toBeTruthy())
    expect(screen.getByText('Cash')).toBeTruthy()
    expect(screen.getByText(formatMoney(150_000, 'RUB', 'ru'))).toBeTruthy()
    expect(screen.getByText(formatMoney(6_000, 'USD', 'ru'))).toBeTruthy()
  })

  it('creates an account from the form (major units -> minor)', async () => {
    const repository = renderAccounts()

    fireEvent.press(screen.getByTestId('accounts-add'))
    fireEvent.changeText(screen.getByTestId('accounts-create-name'), 'Наличные')
    fireEvent.changeText(screen.getByTestId('accounts-create-opening-balance'), '100,50')
    fireEvent.press(screen.getByTestId('accounts-create-submit'))

    await waitFor(() => expect(repository.snapshot()).toHaveLength(3))
    expect(repository.snapshot().at(-1)).toMatchObject({
      name: 'Наличные',
      currency: 'RUB',
      openingBalance: 10_050,
    })
  })

  it('surfaces the in-use guard message on delete', async () => {
    const base = createMockAccountRepository(ACCOUNTS)
    const repository = {
      ...base,
      remove: (_id: string) =>
        Promise.reject(
          new ReferentialIntegrityError('Account has referencing transactions', {
            apiCode: 'ACCOUNT_IN_USE',
          }),
        ).then(() => undefined) as Promise<void>,
    }
    renderAccounts(repository)

    await waitFor(() => expect(screen.getByText('Карта')).toBeTruthy())
    fireEvent.press(screen.getByTestId('accounts-delete-acc-1'))

    await waitFor(() =>
      expect(
        screen.getByText('Невозможно удалить, так как есть связанные транзакции'),
      ).toBeTruthy(),
    )
  })
})
