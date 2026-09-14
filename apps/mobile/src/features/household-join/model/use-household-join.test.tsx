// The shared join data-choice wiring (household-join design D6): carry →
// rebase + forced sync; clean → wipe + owner re-bind + last_household +
// forced sync; the choice dialog is non-cancelable with carry first. The
// rebase/wipe boundaries are mocked (their behavior is covered by package
// tests); the meta writes run against a real test database.

import { describe, expect, it, beforeEach, jest } from '@jest/globals'
import { act, renderHook, waitFor } from '@testing-library/react-native'
import { Alert } from 'react-native'
import { QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { Household } from '@trata/api'
import { createTestDatabase } from '@trata/local-data/testing'
import { getLastHousehold, getOwnerUserId, setLastHousehold } from '@trata/local-data'
import { DatabaseProvider } from '@/shared/lib/db/database-context'
import type { LocalDatabase } from '@/shared/lib/db/database'
import { createQueryClient } from '@/shared/lib/query/query-client'
import { useEnsureCurrentHousehold, useHouseholdJoin } from './use-household-join'

const USER_ID = '11111111-1111-4111-8111-111111111111'

const HOUSEHOLD: Household = {
  id: 'hh-new',
  currency: 'RUB',
  createdAt: '2026-08-01T00:00:00.000Z',
  name: 'Семья',
  members: [
    {
      userId: USER_ID,
      email: 'user@example.com',
      displayName: null,
      role: 'member',
      joinedAt: '2026-08-01T00:00:00.000Z',
    },
  ],
}

jest.mock('@trata/local-data', () => ({
  ...(jest.requireActual('@trata/local-data') as Record<string, unknown>),
  rebaseLocalDataForHousehold: jest.fn(),
  wipeLocalData: jest.fn(),
}))

jest.mock('@/entities/session', () => ({
  useAuth: () => ({ user: { id: USER_ID, email: 'user@example.com' } }),
}))

jest.mock('@/entities/household', () => ({
  householdApi: { getHousehold: jest.fn() },
}))

const mockController = { runNow: jest.fn() }

jest.mock('@/shared/lib/sync/sync-context', () => ({
  useSyncController: () => mockController,
}))

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { rebaseLocalDataForHousehold: rebaseMock, wipeLocalData: wipeMock } =
  require('@trata/local-data') as {
    rebaseLocalDataForHousehold: ReturnType<typeof jest.fn>
    wipeLocalData: ReturnType<typeof jest.fn>
  }

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { householdApi } = require('@/entities/household') as {
  householdApi: { getHousehold: ReturnType<typeof jest.fn> }
}

let db: LocalDatabase
let alertButtons: { text: string; onPress?: () => void; style?: string }[]
let cancelableOption: { cancelable?: boolean } | undefined

beforeEach(async () => {
  jest.clearAllMocks()
  db = await createTestDatabase()
  alertButtons = []
  cancelableOption = undefined
  jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons, options) => {
    alertButtons = (buttons ?? []) as typeof alertButtons
    cancelableOption = options
    return
  })
})

function renderJoinHook() {
  const queryClient = createQueryClient()
  const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries')
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <DatabaseProvider database={db}>{children}</DatabaseProvider>
    </QueryClientProvider>
  )
  const hook = renderHook(() => useHouseholdJoin(), { wrapper })
  return { hook, invalidateSpy }
}

describe('useHouseholdJoin', () => {
  it('carry rebases for the new household, invalidates caches and forces a run', async () => {
    const { hook, invalidateSpy } = renderJoinHook()

    await act(() => hook.result.current.performHouseholdJoin(HOUSEHOLD, 'carry'))

    expect(rebaseMock).toHaveBeenCalledWith(db, 'hh-new')
    expect(wipeMock).not.toHaveBeenCalled()
    expect(invalidateSpy).toHaveBeenCalled()
    expect(mockController.runNow).toHaveBeenCalledTimes(1)
  })

  it('clean wipes, re-binds the owner, stamps last_household and forces a run', async () => {
    const { hook, invalidateSpy } = renderJoinHook()

    await act(() => hook.result.current.performHouseholdJoin(HOUSEHOLD, 'clean'))

    expect(wipeMock).toHaveBeenCalledWith(db)
    expect(rebaseMock).not.toHaveBeenCalled()
    expect(getLastHousehold(db)).toBe('hh-new')
    expect(getOwnerUserId(db)).toBe(USER_ID)
    expect(invalidateSpy).toHaveBeenCalled()
    expect(mockController.runNow).toHaveBeenCalledTimes(1)
  })

  it('chooseHouseholdData asks through a non-cancelable alert with carry first', async () => {
    const { hook } = renderJoinHook()
    rebaseMock.mockImplementation(() => setLastHousehold(db, 'hh-new'))

    let settled = false
    await act(async () => {
      void hook.result.current.chooseHouseholdData(HOUSEHOLD).then(() => void (settled = true))
      await Promise.resolve()
    })

    expect(Alert.alert).toHaveBeenCalledWith(
      'Новое домохозяйство',
      'Домохозяйство изменилось. Что сделать с данными на этом устройстве?',
      expect.any(Array),
      { cancelable: false },
    )
    expect(cancelableOption).toEqual({ cancelable: false })
    // The choice is still pending until a button answers.
    expect(settled).toBe(false)

    const carry = alertButtons[0]
    const clean = alertButtons[1]
    expect(carry?.text).toBe('Перенести данные')
    expect(carry?.style).toBeUndefined()
    expect(clean?.text).toBe('Начать с чистого листа')
    expect(clean?.style).toBe('destructive')

    await act(async () => {
      carry?.onPress?.()
    })
    await waitFor(() => expect(settled).toBe(true))
    expect(rebaseMock).toHaveBeenCalledWith(db, 'hh-new')
    expect(mockController.runNow).toHaveBeenCalledTimes(1)
  })

  it('chooseHouseholdData applies clean when the destructive button answers', async () => {
    const { hook } = renderJoinHook()

    let settled = false
    await act(async () => {
      void hook.result.current.chooseHouseholdData(HOUSEHOLD).then(() => void (settled = true))
      await Promise.resolve()
    })

    const clean = alertButtons[1]
    await act(async () => {
      clean?.onPress?.()
    })
    await waitFor(() => expect(settled).toBe(true))

    expect(wipeMock).toHaveBeenCalledWith(db)
    expect(getOwnerUserId(db)).toBe(USER_ID)
    expect(getLastHousehold(db)).toBe('hh-new')
    expect(mockController.runNow).toHaveBeenCalledTimes(1)
  })
})

describe('useEnsureCurrentHousehold (the run-policy household gate, design D7)', () => {
  function renderGateHook() {
    const queryClient = createQueryClient()
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <DatabaseProvider database={db}>{children}</DatabaseProvider>
      </QueryClientProvider>
    )
    return renderHook(() => useEnsureCurrentHousehold(), { wrapper })
  }

  it('holds for the carry/clean choice on a stale marker and applies carry without runNow', async () => {
    setLastHousehold(db, 'hh-old')
    householdApi.getHousehold.mockResolvedValue(HOUSEHOLD)
    rebaseMock.mockImplementation(() => setLastHousehold(db, 'hh-new'))
    const gate = renderGateHook()

    let settled = false
    await act(async () => {
      void gate.result.current().then(() => void (settled = true))
      await Promise.resolve()
    })
    // A mismatch parks the resolver behind the non-cancelable choice.
    expect(settled).toBe(false)
    expect(Alert.alert).toHaveBeenCalledTimes(1)

    await act(async () => {
      alertButtons[0]?.onPress?.()
    })
    await waitFor(() => expect(settled).toBe(true))
    // The parked gated run continues after the resolver - no runNow here.
    expect(getLastHousehold(db)).toBe('hh-new')
    expect(mockController.runNow).not.toHaveBeenCalled()
  })

  it('applies the clean choice when the destructive button answers', async () => {
    setLastHousehold(db, 'hh-old')
    householdApi.getHousehold.mockResolvedValue(HOUSEHOLD)
    const gate = renderGateHook()

    let settled = false
    await act(async () => {
      void gate.result.current().then(() => void (settled = true))
      await Promise.resolve()
    })
    await act(async () => {
      alertButtons[1]?.onPress?.()
    })
    await waitFor(() => expect(settled).toBe(true))

    expect(wipeMock).toHaveBeenCalledWith(db)
    expect(getLastHousehold(db)).toBe('hh-new')
    expect(getOwnerUserId(db)).toBe(USER_ID)
  })

  it('records the household silently on first run (null marker)', async () => {
    householdApi.getHousehold.mockResolvedValue(HOUSEHOLD)
    const gate = renderGateHook()

    await act(() => gate.result.current())

    expect(Alert.alert).not.toHaveBeenCalled()
    expect(getLastHousehold(db)).toBe('hh-new')
  })

  it('does nothing when the marker already matches', async () => {
    setLastHousehold(db, 'hh-new')
    householdApi.getHousehold.mockResolvedValue(HOUSEHOLD)
    const gate = renderGateHook()

    await act(() => gate.result.current())

    expect(Alert.alert).not.toHaveBeenCalled()
    expect(getLastHousehold(db)).toBe('hh-new')
  })

  it('rejects when the household cannot be fetched (offline) - the run-policy skips the run', async () => {
    householdApi.getHousehold.mockRejectedValue(new Error('offline'))
    const gate = renderGateHook()

    await expect(act(() => gate.result.current())).rejects.toThrow('offline')
    expect(Alert.alert).not.toHaveBeenCalled()
    expect(getLastHousehold(db)).toBeNull()
  })
})
