// Auth state provider - the mobile twin of the web auth store, plus the
// offline-first ownership gate (design D9): local data belongs to its owner
// (`sync_meta.owner_user_id`). Logging in as the SAME user (or the first
// login on unowned data) binds and starts the initial sync; a DIFFERENT user
// must explicitly choose between clearing the local data and cancelling.
// Logout keeps every byte of local data (anonymous offline mode resumes).

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Alert } from 'react-native'
import { setUnauthorizedHandler, UnauthorizedError } from '@trata/api'
import { sessionApi } from '../api/session-api'
import type { AuthResult, AuthStatus, User } from './types'
import { useLocalDatabase } from '@/shared/lib/db/database-context'
import { adoptUnowned, getOwnerUserId, ownershipGateDecision, rebindOwner } from '@trata/local-data'

export interface AuthController {
  status: AuthStatus
  user: User | null
  isAuthenticated: boolean
  login(email: string, password: string): Promise<AuthResult>
  register(email: string, password: string): Promise<AuthResult>
  logout(): Promise<void>
  /** Drops local auth state without calling the backend (the 401 hook). */
  clearSession(): void
}

const AuthContext = createContext<AuthController | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const db = useLocalDatabase()
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<AuthStatus>('restoring')
  const [user, setUser] = useState<User | null>(null)
  const statusRef = useRef(status)
  statusRef.current = status

  // Register the shared 401 interceptor: expired sessions clear auth state
  // (the sync engine pauses itself on UnauthorizedError and resumes after the
  // next successful login).
  const clearSession = useCallback(() => {
    setUser(null)
    setStatus('anonymous')
  }, [])
  useEffect(() => {
    setUnauthorizedHandler(clearSession)
    return () => setUnauthorizedHandler(null)
  }, [clearSession])

  /** Binds the owner (first login) and flips to authenticated. */
  const completeAuthentication = useCallback(
    (authenticatedUser: User) => {
      adoptUnowned(db, authenticatedUser.id)
      setUser(authenticatedUser)
      setStatus('authenticated')
    },
    [db],
  )

  /**
   * The ownership gate: unowned or same-owner passes straight through; a
   * different owner must pick "clear local data" (destructive) or cancel
   * (logs the just-created session back out, local data untouched).
   */
  const passOwnershipGate = useCallback(
    (authenticatedUser: User): Promise<AuthResult> =>
      new Promise((resolve) => {
        const owner = ownershipGateDecision(getOwnerUserId(db), authenticatedUser.id)
        if (owner.kind === 'pass') {
          completeAuthentication(authenticatedUser)
          resolve({ ok: true })
          return
        }

        Alert.alert(
          'Локальные данные другого пользователя',
          'На этом устройстве есть несинхронизированные данные другого аккаунта. ' +
            'Войти можно только после их удаления.',
          [
            {
              text: 'Отмена',
              style: 'cancel',
              onPress: () => {
                void sessionApi.logout().catch(() => undefined)
                resolve({ ok: false, blockedByOwner: true })
              },
            },
            {
              text: 'Удалить данные',
              style: 'destructive',
              onPress: () => {
                rebindOwner(db, authenticatedUser.id)
                void queryClient.invalidateQueries()
                completeAuthentication(authenticatedUser)
                resolve({ ok: true })
              },
            },
          ],
          { cancelable: false },
        )
      }),
    [completeAuthentication, db, queryClient],
  )

  // Restore the session from RN's cookie store once per app run. A 401 means
  // "not signed in" and lands us in anonymous mode - the app stays fully
  // usable on local data. A restored session for a DIFFERENT user than the
  // local owner goes through the same ownership gate as login: the
  // interrupted clear-or-cancel choice must be answered before the app (and
  // with it the sync engine) may act as that user.
  useEffect(() => {
    let cancelled = false
    sessionApi
      .getCurrentUser()
      .then((restored) => {
        if (cancelled) return
        const decision = ownershipGateDecision(getOwnerUserId(db), restored.id)
        if (decision.kind === 'pass') {
          completeAuthentication(restored)
          return
        }
        void passOwnershipGate(restored).then((result) => {
          // Cancelled: the gate already logged the foreign session out; the
          // app continues anonymously with the owner's local data intact.
          if (!result.ok) setStatus('anonymous')
        })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        if (error instanceof UnauthorizedError) {
          setStatus('anonymous')
          return
        }
        // Network/backend unavailable at startup: offline-first means the
        // anonymous shell, not a blocking error screen.
        setStatus('anonymous')
      })
    return () => {
      cancelled = true
    }
  }, [completeAuthentication, db, passOwnershipGate])

  const login = useCallback(
    async (email: string, password: string): Promise<AuthResult> => {
      const authenticated = await sessionApi.login(email, password)
      return passOwnershipGate(authenticated)
    },
    [passOwnershipGate],
  )

  const register = useCallback(
    async (email: string, password: string): Promise<AuthResult> => {
      const created = await sessionApi.register(email, password)
      return passOwnershipGate(created)
    },
    [passOwnershipGate],
  )

  const logout = useCallback(async () => {
    await sessionApi.logout().catch(() => undefined)
    setUser(null)
    setStatus('anonymous')
  }, [])

  const value = useMemo<AuthController>(
    () => ({
      status,
      user,
      isAuthenticated: status === 'authenticated' && user !== null,
      login,
      register,
      logout,
      clearSession,
    }),
    [clearSession, login, logout, register, status, user],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

/** Injects the auth controller; throws when the provider is missing. */
export function useAuth(): AuthController {
  const controller = useContext(AuthContext)
  if (!controller) {
    throw new Error('useAuth requires <AuthProvider> in the tree')
  }
  return controller
}
