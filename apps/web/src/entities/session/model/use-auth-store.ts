import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { useQueryCache } from '@pinia/colada'
import { sessionApi } from '../api/session-api'
import type { AuthResult, AuthStatus, PendingOwnershipGate, RestoreOutcome, User } from '../model/types'
import { getLocalDbApi } from '@/shared/lib/local-db'
import { ownershipGateDecision } from '@expense-tracker/local-data'
import { UnauthorizedError } from '@expense-tracker/api'

/**
 * Auth state with the mobile status machine (design D5):
 * `restoring` -> `anonymous` <-> `authenticated`. Offline-first means the
 * session restore is network-tolerant - a 401 (not signed in) AND a
 * network/backend failure both land in the anonymous shell, never an error
 * screen. Login/register/restored sessions all pass the ownership gate over
 * the local database's owner binding; logout keeps every byte of local data
 * (the outbox waits for the next authentication).
 */
export const useAuthStore = defineStore('auth', () => {
  const queryCache = useQueryCache()

  const user = ref<User | null>(null)
  const status = ref<AuthStatus>('restoring')
  /** Why the restore ended without a session (see RestoreOutcome). */
  const restoreOutcome = ref<RestoreOutcome>('unknown')
  /** Set while the ownership dialog awaits the user's choice (design D5). */
  const pendingGate = ref<PendingOwnershipGate | null>(null)

  /**
   * Whether local data is bound to some owner: loaded lazily when a restore
   * fails by network, so the shell can tell "offline, sign-in pending"
   * (owner exists) from a true guest device.
   */
  const hasLocalOwner = ref(false)
  function loadOwnerFlag(): void {
    void getLocalDbApi()
      .then((db) => db.meta.getOwnerUserId())
      .then((owner) => {
        hasLocalOwner.value = owner !== null
      })
      .catch(() => undefined)
  }

  const isAuthenticated = computed(() => status.value === 'authenticated' && user.value !== null)

  /** Offline indicator state: restore failed by network on an owned device (design D4). */
  const isOfflineMode = computed(
    () => status.value === 'anonymous' && restoreOutcome.value === 'offline' && hasLocalOwner.value,
  )

  /** Binds an unowned database to its first authenticated user, then flips to `authenticated`. */
  async function completeAuthentication(authenticated: User): Promise<void> {
    const db = await getLocalDbApi()
    // adoptUnowned: bind only if the db is currently unowned (first login / same owner).
    if (!(await db.meta.getOwnerUserId())) {
      await db.meta.setOwnerUserId(authenticated.id)
    }
    user.value = authenticated
    status.value = 'authenticated'
  }

  /**
   * The ownership gate: unowned or same-owner passes straight through; a
   * different owner parks the decision in `pendingGate` for the globally
   * mounted dialog - wipe the data (destructive) or cancel (server-side
   * logout, local data untouched).
   */
  async function passOwnershipGate(authenticated: User): Promise<AuthResult> {
    const db = await getLocalDbApi()
    const owner = await db.meta.getOwnerUserId()
    const decision = ownershipGateDecision(owner, authenticated.id)
    if (decision.kind === 'pass') {
      await completeAuthentication(authenticated)
      return { ok: true }
    }
    return new Promise<AuthResult>((resolve) => {
      pendingGate.value = { user: authenticated, resolve }
    })
  }

  /** The dialog's destructive choice: wipe local data, rebind, authenticate. */
  async function confirmOwnershipGateDelete(): Promise<void> {
    const pending = pendingGate.value
    if (!pending) return
    pendingGate.value = null

    const db = await getLocalDbApi()
    // rebindOwner: wipe ALL local data and set the new owner atomically.
    await db.sync.rebindOwner(pending.user.id)
    // Everything cached belonged to the wiped dataset.
    await queryCache.invalidateQueries()
    await completeAuthentication(pending.user)
    pending.resolve({ ok: true })
  }

  /**
   * The dialog's cancel choice: sign the just-authenticated session back out
   * server-side and stay anonymous with the owner's local data intact.
   */
  function cancelOwnershipGate(): void {
    const pending = pendingGate.value
    if (!pending) return
    pendingGate.value = null
    void sessionApi.logout().catch(() => undefined)
    status.value = 'anonymous'
    pending.resolve({ ok: false, blockedByOwner: true })
  }

  let restorePromise: Promise<void> | null = null

  /**
   * Restores the session once per app run. A 401 means "not signed in" and
   * lands in a terminal anonymous shell; a network failure (timeout, no
   * connectivity) also means the anonymous shell - never an error screen -
   * but is recoverable: `restoreOutcome` records which one happened so the
   * app layer can retry (`retryRestoreIfOffline`) when connectivity returns.
   * A restored session for a different user than the local owner goes
   * through the same ownership gate as login.
   */
  function ensureRestored(): Promise<void> {
    restorePromise ??= sessionApi
      .getCurrentUser()
      .then((restored) => passOwnershipGate(restored).then(() => undefined))
      .catch((error: unknown) => {
        // Not signed in (401) or the backend is unreachable: offline-first
        // means the anonymous shell, not a blocking error screen.
        status.value = 'anonymous'
        if (error instanceof UnauthorizedError) {
          restoreOutcome.value = 'signed-out'
        } else {
          restoreOutcome.value = 'offline'
          loadOwnerFlag()
        }
      })
    return restorePromise
  }

  /**
   * Retries the session restore while the last attempt failed by network
   * (airplane mode off, app foregrounded). A 401 outcome is terminal and a
   * no-op here. Re-entrancy is safe: an in-flight retry caches its promise
   * through `ensureRestored`, so concurrent triggers join the same attempt.
   */
  function retryRestoreIfOffline(): Promise<void> {
    if (restoreOutcome.value !== 'offline') return restorePromise ?? Promise.resolve()
    restoreOutcome.value = 'unknown'
    restorePromise = null
    return ensureRestored()
  }

  async function register(email: string, password: string): Promise<AuthResult> {
    const created = await sessionApi.register(email, password)
    return passOwnershipGate(created)
  }

  async function login(email: string, password: string): Promise<AuthResult> {
    const authenticated = await sessionApi.login(email, password)
    return passOwnershipGate(authenticated)
  }

  /** Logout keeps all local data; queued sync operations wait for the next authentication. */
  async function logout(): Promise<void> {
    await sessionApi.logout().catch(() => undefined)
    user.value = null
    status.value = 'anonymous'
    restoreOutcome.value = 'signed-out'
  }

  /** Re-reads the current user (e.g. after email verification flips emailVerified). */
  async function refreshUser(): Promise<void> {
    try {
      user.value = await sessionApi.getCurrentUser()
    } catch {
      // Keep the previous state; the 401 interceptor handles expired sessions.
    }
  }

  /** Drop local auth state without calling the backend (used by the 401 hook). */
  function clearSession(): void {
    user.value = null
    status.value = 'anonymous'
    restoreOutcome.value = 'signed-out'
  }

  return {
    user,
    status,
    restoreOutcome,
    hasLocalOwner,
    isOfflineMode,
    pendingGate,
    isAuthenticated,
    ensureRestored,
    retryRestoreIfOffline,
    register,
    login,
    logout,
    refreshUser,
    clearSession,
    confirmOwnershipGateDelete,
    cancelOwnershipGate,
  }
})
