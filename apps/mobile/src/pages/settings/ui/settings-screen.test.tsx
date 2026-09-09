// Settings screen sections: the anonymous vs authenticated account card
// (logout success and the mapped error alert), the sync card hiding while
// anonymous and showing the seeded pending/conflict counts, and the dev
// offline gate toggling with a manual run on re-enable.

import { describe, expect, it, beforeEach, jest } from '@jest/globals'
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import { Alert } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { QueryClientProvider } from '@tanstack/react-query'
import { RepositoryError } from '@trata/api'
import { createTestDatabase } from '@trata/local-data/testing'
import { DatabaseProvider } from '@/shared/lib/db/database-context'
import type { LocalDatabase } from '@/shared/lib/db/database'
import { createQueryClient } from '@/shared/lib/query/query-client'
import { enqueueOperation, recordConflict } from '@trata/local-data'
import { SettingsScreen } from './settings-screen'

const mockUseAuth: {
  status: 'authenticated' | 'anonymous'
  user: { email: string } | null
  logout: ReturnType<typeof jest.fn>
} = {
  status: 'authenticated',
  user: { email: 'user@example.com' },
  logout: jest.fn(),
}

const mockController: { runNow: ReturnType<typeof jest.fn> } = {
  runNow: jest.fn(),
}

jest.mock('@/entities/session', () => ({
  useAuth: () => mockUseAuth,
}))

// The household section (household-ux) reads the household query and the
// dissolve-count repositories; this suite focuses on the account/sync/dev
// cards, so both resolve empty.
jest.mock('@/entities/household', () => ({
  ...(jest.requireActual('@/entities/household') as Record<string, unknown>),
  useHousehold: () => ({ data: undefined }),
}))

jest.mock('@/entities/transaction/api/repository', () => ({
  useTransactionRepository: () => ({
    query: jest.fn<() => Promise<import('@trata/api').Transaction[]>>().mockResolvedValue([]),
  }),
}))

jest.mock('@/entities/debt/api/repository', () => ({
  useDebtOperationRepository: () => ({
    getAll: jest.fn<() => Promise<import('@trata/api').DebtOperation[]>>().mockResolvedValue([]),
  }),
}))

jest.mock('@/entities/planned-payment/api/repository', () => ({
  usePlannedPaymentRepository: () => ({
    query: jest.fn<() => Promise<import('@trata/api').PlannedPayment[]>>().mockResolvedValue([]),
  }),
}))

jest.mock('@/shared/lib/sync/sync-context', () => ({
  useSyncController: () => mockController,
}))

jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
}))

let db: LocalDatabase

const ZERO_INSETS = { top: 0, right: 0, bottom: 0, left: 0 }

beforeEach(async () => {
  jest.clearAllMocks()
  mockUseAuth.status = 'authenticated'
  mockUseAuth.user = { email: 'user@example.com' }
  mockUseAuth.logout.mockResolvedValue(undefined)
  db = await createTestDatabase()
})

function renderScreen() {
  return render(
    <SafeAreaProvider
      initialMetrics={{ frame: { x: 0, y: 0, width: 0, height: 0 }, insets: ZERO_INSETS }}
    >
      <QueryClientProvider client={createQueryClient()}>
        <DatabaseProvider database={db}>
          <SettingsScreen />
        </DatabaseProvider>
      </QueryClientProvider>
    </SafeAreaProvider>,
  )
}

describe('SettingsScreen', () => {
  it('shows the local-data notice and hides the sync card while anonymous', () => {
    mockUseAuth.status = 'anonymous'
    mockUseAuth.user = null
    renderScreen()

    expect(screen.getByTestId('settings-account-section')).toBeTruthy()
    expect(screen.getByTestId('settings-login-button')).toBeTruthy()
    expect(screen.queryByTestId('settings-logout-button')).toBeNull()
    expect(screen.queryByTestId('settings-sync-section')).toBeNull()
  })

  it('shows the email and logs out from the account card', async () => {
    renderScreen()

    expect(screen.getByTestId('settings-user-email')).toHaveTextContent('user@example.com')
    fireEvent.press(screen.getByTestId('settings-logout-button'))
    await waitFor(() => expect(mockUseAuth.logout).toHaveBeenCalledTimes(1))
  })

  it('alerts the mapped repository error when logout fails', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined)
    mockUseAuth.logout.mockRejectedValue(new RepositoryError(' throttled', 'rate-limited'))
    renderScreen()

    fireEvent.press(screen.getByTestId('settings-logout-button'))
    await waitFor(() => expect(alertSpy).toHaveBeenCalledTimes(1))
    expect(alertSpy).toHaveBeenCalledWith(
      'Не удалось выйти',
      'Слишком много попыток. Попробуйте позже',
    )
  })

  it('shows the never-synced line and the seeded pending/conflict counts', async () => {
    db.transaction((tx) => {
      enqueueOperation(tx, {
        entity: 'category',
        entityId: 'c1',
        op: 'upsert',
        payload: {},
        baseVersion: 0,
      })
      recordConflict(tx, {
        entity: 'category',
        entityId: 'c1',
        opId: null,
        kind: 'version',
        baseVersion: 1,
        serverVersion: 2,
        localState: null,
        serverState: { version: 2, deleted: false },
      })
    })
    renderScreen()

    expect(await screen.findByTestId('settings-sync-section')).toBeTruthy()
    expect(screen.getByTestId('settings-sync-last')).toHaveTextContent(
      'Последняя синхронизация: ещё не выполнялась',
    )
    expect(await screen.findByText('Ожидают отправки: 1')).toBeTruthy()
    expect(screen.getByText('Неразрешённых конфликтов: 1')).toBeTruthy()
  })

  it('toggles the dev offline gate and runs sync when re-enabled', () => {
    renderScreen()

    const toggle = screen.getByTestId('settings-dev-offline-toggle')
    expect(toggle).toHaveTextContent('Офлайн-режим: выкл')
    fireEvent.press(toggle)
    expect(screen.getByTestId('settings-dev-offline-toggle')).toHaveTextContent('Офлайн-режим: вкл')
    expect(mockController.runNow).not.toHaveBeenCalled()
    fireEvent.press(screen.getByTestId('settings-dev-offline-toggle'))
    expect(screen.getByTestId('settings-dev-offline-toggle')).toHaveTextContent(
      'Офлайн-режим: выкл',
    )
    expect(mockController.runNow).toHaveBeenCalledTimes(1)
  })
})
