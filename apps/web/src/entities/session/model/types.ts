// Mirrors the backend `User` and `SessionResponse` schemas (see schema.ts).
// Auth is session-based (cookie); the client never holds a token.

export interface User {
  id: string
  email: string
  emailVerified: boolean
  createdAt: string
  updatedAt: string
}

export interface Session {
  createdAt: string
  updatedAt: string
  expiresAt: string
  isCurrent: boolean
}

export type AuthStatus = 'restoring' | 'anonymous' | 'authenticated'

/**
 * Why the session restore ended without a session (web-offline-resilience
 * design D2): `signed-out` is server-confirmed (401 / explicit logout) and
 * terminal for the run; `offline` means the network failed (timeout, no
 * connectivity) and the restore is retried when connectivity returns.
 */
export type RestoreOutcome = 'unknown' | 'signed-out' | 'offline'

/** Outcome of a login/register attempt after the ownership gate ran. */
export interface AuthResult {
  ok: boolean
  /** Present when a different user's data blocks the login (user cancelled). */
  blockedByOwner?: boolean
}

/**
 * A different owner signed in over owned local data: the user must choose
 * between wiping it (destructive) and cancelling the login. The auth store
 * parks the authenticated user here until the globally mounted ownership
 * dialog resolves it.
 */
export interface PendingOwnershipGate {
  user: User
  resolve: (result: AuthResult) => void
}
