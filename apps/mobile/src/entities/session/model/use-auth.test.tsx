// Auth provider tests: session restore, the offline-first ownership gate
// (same owner / first login / different owner with clear-or-cancel), logout
// keeping local data, and the 401 hook clearing state.

import { describe, expect, it, beforeEach, jest } from '@jest/globals'
import { renderHook, waitFor, act } from '@testing-library/react-native'
import { Alert } from 'react-native'
import { QueryClientProvider } from '@tanstack/react-query'
import { UnauthorizedError } from '@trata/api'
import type { ReactNode } from 'react'
import { createTestDatabase } from '@trata/local-data/testing'
import { DatabaseProvider } from '@/shared/lib/db/database-context'
import type { LocalDatabase } from '@/shared/lib/db/database'
import { createQueryClient } from '@/shared/lib/query/query-client'
import { categories, getOwnerUserId, setOwnerUserId } from '@trata/local-data'
import { AuthProvider, useAuth } from './use-auth'
import type { User } from './types'

jest.mock('../api/session-api', () => ({
  sessionApi: {
    login: jest.fn(),
    register: jest.fn(),
    logout: jest.fn(),
    getCurrentUser: jest.fn(),
  },
}))

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { sessionApi } = require('../api/session-api') as {
  sessionApi: {
    login: ReturnType<typeof jest.fn>
    register: ReturnType<typeof jest.fn>
    logout: ReturnType<typeof jest.fn>
    getCurrentUser: ReturnType<typeof jest.fn>
  }
}

const USER_A: User = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'a@example.com',
  emailVerified: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const USER_B: User = {
  ...USER_A,
  id: '22222222-2222-4222-8222-222222222222',
  email: 'b@example.com',
}

let db: LocalDatabase
let alertButtons: { text: string; onPress?: () => void; style?: string }[]

beforeEach(async () => {
  jest.clearAllMocks()
  db = await createTestDatabase()
  // The mocked api rejects like the real client would on a 401.
  sessionApi.getCurrentUser.mockImplementation(() =>
    Promise.reject(new UnauthorizedError('no session')),
  )
  sessionApi.logout.mockResolvedValue(undefined)
  alertButtons = []
  jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
    alertButtons = (buttons ?? []) as typeof alertButtons
    return
  })
})

function makeWrapper() {
  const queryClient = createQueryClient()
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <DatabaseProvider database={db}>
        <AuthProvider>{children}</AuthProvider>
      </DatabaseProvider>
    </QueryClientProvider>
  )
  return wrapper
}

async function renderAuth() {
  const hook = renderHook(() => useAuth(), { wrapper: makeWrapper() })
  await waitFor(() => expect(hook.result.current.status).not.toBe('restoring'))
  return hook
}

describe('AuthProvider', () => {
  it('restores the session from the cookie store and binds ownership', async () => {
    sessionApi.getCurrentUser.mockResolvedValue(USER_A)
    const hook = await renderAuth()
    expect(hook.result.current.status).toBe('authenticated')
    expect(hook.result.current.user?.email).toBe('a@example.com')
    expect(getOwnerUserId(db)).toBe(USER_A.id)
  })

  it('lands in anonymous mode when there is no session', async () => {
    const hook = await renderAuth()
    expect(hook.result.current.status).toBe('anonymous')
  })

  it('restore of a foreign session goes through the gate, never straight to authenticated', async () => {
    setOwnerUserId(db, USER_A.id)
    await db.insert(categories).values({
      id: 'cat-foreign',
      name: 'Локальная',
      type: 'expense',
      icon: 'car',
      color: '#7c5cff',
      version: 1,
      serverVersion: 0,
      deletedAt: null,
      createdAt: new Date().toISOString(),
    })
    sessionApi.getCurrentUser.mockResolvedValue(USER_B)

    const hook = renderHook(() => useAuth(), { wrapper: makeWrapper() })
    await waitFor(() => expect(Alert.alert).toHaveBeenCalledTimes(1))

    // The interrupted ownership choice must be answered first: B is NOT
    // authenticated, so the sync engine can never push A's data to B.
    expect(hook.result.current.status).toBe('restoring')
    expect(hook.result.current.isAuthenticated).toBe(false)

    const cancel = alertButtons.find((b) => b.text === 'Отмена')
    expect(cancel).toBeDefined()
    await act(async () => {
      cancel?.onPress?.()
    })
    await waitFor(() => expect(hook.result.current.status).toBe('anonymous'))

    expect(sessionApi.logout).toHaveBeenCalled()
    expect(getOwnerUserId(db)).toBe(USER_A.id)
    expect(db.select().from(categories).all()).toHaveLength(1)
  })

  it('restore of a foreign session completes after clearing local data', async () => {
    setOwnerUserId(db, USER_A.id)
    await db.insert(categories).values({
      id: 'cat-wipe',
      name: 'Локальная',
      type: 'expense',
      icon: 'car',
      color: '#7c5cff',
      version: 1,
      serverVersion: 0,
      deletedAt: null,
      createdAt: new Date().toISOString(),
    })
    sessionApi.getCurrentUser.mockResolvedValue(USER_B)

    const hook = renderHook(() => useAuth(), { wrapper: makeWrapper() })
    await waitFor(() => expect(Alert.alert).toHaveBeenCalledTimes(1))

    const clear = alertButtons.find((b) => b.text === 'Удалить данные')
    expect(clear).toBeDefined()
    await act(async () => {
      clear?.onPress?.()
    })
    await waitFor(() => expect(hook.result.current.status).toBe('authenticated'))

    expect(hook.result.current.user?.id).toBe(USER_B.id)
    expect(db.select().from(categories).all()).toHaveLength(0)
    expect(getOwnerUserId(db)).toBe(USER_B.id)
  })

  it('first login on unowned data binds the owner without a dialog', async () => {
    sessionApi.login.mockResolvedValue(USER_A)
    const hook = await renderAuth()

    let result: { ok: boolean } | undefined
    await act(async () => {
      result = await hook.result.current.login('a@example.com', 'password')
    })

    expect(result?.ok).toBe(true)
    expect(Alert.alert).not.toHaveBeenCalled()
    expect(hook.result.current.status).toBe('authenticated')
    expect(getOwnerUserId(db)).toBe(USER_A.id)
  })

  it('same-owner login passes the gate', async () => {
    setOwnerUserId(db, USER_A.id)
    sessionApi.login.mockResolvedValue(USER_A)
    const hook = await renderAuth()

    await act(async () => {
      const r = await hook.result.current.login('a@example.com', 'password')
      expect(r.ok).toBe(true)
    })
    expect(Alert.alert).not.toHaveBeenCalled()
    expect(hook.result.current.status).toBe('authenticated')
  })

  it('different owner blocks: cancel logs the session out and keeps local data', async () => {
    setOwnerUserId(db, USER_A.id)
    await db.insert(categories).values({
      id: 'cat-keep',
      name: 'Локальная',
      type: 'expense',
      icon: 'car',
      color: '#7c5cff',
      version: 1,
      serverVersion: 0,
      deletedAt: null,
      createdAt: new Date().toISOString(),
    })
    sessionApi.login.mockResolvedValue(USER_B)
    const hook = await renderAuth()

    // The login promise stays pending until the gate dialog is answered.
    const outcomes: { ok: boolean; blockedByOwner?: boolean }[] = []
    await act(async () => {
      void hook.result.current.login('b@example.com', 'password').then((r) => outcomes.push(r))
      await Promise.resolve()
    })

    // The gate dialog appeared; nothing was decided yet.
    expect(Alert.alert).toHaveBeenCalledTimes(1)
    expect(hook.result.current.status).toBe('anonymous')

    const cancel = alertButtons.find((b) => b.text === 'Отмена')
    expect(cancel).toBeDefined()
    await act(async () => {
      cancel?.onPress?.()
    })
    await waitFor(() => expect(outcomes).toHaveLength(1))

    expect(outcomes[0]).toEqual({ ok: false, blockedByOwner: true })
    expect(sessionApi.logout).toHaveBeenCalled()
    expect(hook.result.current.status).toBe('anonymous')
    // Local data untouched.
    expect(db.select().from(categories).all()).toHaveLength(1)
    expect(getOwnerUserId(db)).toBe(USER_A.id)
  })

  it('different owner: clearing the data wipes it and completes the login', async () => {
    setOwnerUserId(db, USER_A.id)
    await db.insert(categories).values({
      id: 'cat-gone',
      name: 'Локальная',
      type: 'expense',
      icon: 'car',
      color: '#7c5cff',
      version: 1,
      serverVersion: 0,
      deletedAt: null,
      createdAt: new Date().toISOString(),
    })
    sessionApi.login.mockResolvedValue(USER_B)
    const hook = await renderAuth()

    const outcomes: { ok: boolean }[] = []
    await act(async () => {
      void hook.result.current.login('b@example.com', 'password').then((r) => outcomes.push(r))
      await Promise.resolve()
    })
    expect(Alert.alert).toHaveBeenCalledTimes(1)

    const clear = alertButtons.find((b) => b.text === 'Удалить данные')
    expect(clear).toBeDefined()
    await act(async () => {
      clear?.onPress?.()
    })
    await waitFor(() => expect(outcomes).toHaveLength(1))
    expect(outcomes[0].ok).toBe(true)

    expect(hook.result.current.status).toBe('authenticated')
    expect(db.select().from(categories).all()).toHaveLength(0)
    expect(getOwnerUserId(db)).toBe(USER_B.id)
  })

  it('logout keeps local data and returns to anonymous mode', async () => {
    setOwnerUserId(db, USER_A.id)
    sessionApi.getCurrentUser.mockResolvedValue(USER_A)
    const hook = await renderAuth()
    expect(hook.result.current.status).toBe('authenticated')

    await act(async () => {
      await hook.result.current.logout()
    })
    expect(hook.result.current.status).toBe('anonymous')
    expect(getOwnerUserId(db)).toBe(USER_A.id)
  })
})
