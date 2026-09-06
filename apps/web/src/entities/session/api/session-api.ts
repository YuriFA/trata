import { apiClient } from '@/shared/api'
import { AUTH_REQUEST_TIMEOUT_MS } from '@/shared/api/client'
import type { components } from '@/shared/api'
import type { Session, User } from '../model/types'

type ApiUser = components['schemas']['User']
type ApiSession = components['schemas']['SessionResponse']

function toUser(value: ApiUser): User {
  return {
    id: value.id,
    email: value.email,
    emailVerified: value.emailVerified,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  }
}

function toSession(value: ApiSession): Session {
  return {
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    expiresAt: value.expiresAt,
    isCurrent: value.isCurrent,
  }
}

// The error middleware throws on every non-2xx response, so a resolved call
// always carries a body. This asserts that invariant for the type system.
function requireData<T>(data: T | undefined): T {
  if (data === undefined) {
    throw new Error('Expected a response body but received none')
  }
  return data
}

/**
 * Typed wrappers over the auth/session surface. The session is an HttpOnly
 * cookie set by the backend; these calls rely on `credentials: 'include'`
 * (configured on the client) to send/refresh it.
 *
 * Every call carries a tight 5s bound (on top of the client's 10s default): a
 * hanging backend must degrade the session restore into the offline state
 * quickly, not stall the login entry point for the browser's TCP timeout
 * (web-offline-resilience design D1).
 */
const authSignal = () => AbortSignal.timeout(AUTH_REQUEST_TIMEOUT_MS)

export const sessionApi = {
  async register(email: string, password: string): Promise<User> {
    const { data } = await apiClient.POST('/api/auth/register', {
    body: { email, password },
    signal: authSignal(),
  })
    return toUser(requireData(data))
  },
  async login(email: string, password: string): Promise<User> {
    const { data } = await apiClient.POST('/api/auth/login', {
    body: { email, password },
    signal: authSignal(),
  })
    return toUser(requireData(data))
  },
  async logout(): Promise<void> {
    await apiClient.POST('/api/auth/logout', { signal: authSignal() })
  },
  async getCurrentUser(): Promise<User> {
    const { data } = await apiClient.GET('/api/auth/me', { signal: authSignal() })
    return toUser(requireData(data))
  },
  async listSessions(): Promise<Session[]> {
    const { data } = await apiClient.GET('/api/auth/sessions', { signal: authSignal() })
    return requireData(data).map(toSession)
  },
  async deleteAllSessions(): Promise<void> {
    await apiClient.DELETE('/api/auth/sessions', { signal: authSignal() })
  },
  async verifyEmail(code: string): Promise<void> {
    await apiClient.POST('/api/auth/verify-email', { body: { code }, signal: authSignal() })
  },
  async resendVerification(): Promise<void> {
    await apiClient.POST('/api/auth/verify-email/resend', { signal: authSignal() })
  },
  async requestPasswordReset(email: string): Promise<void> {
    await apiClient.POST('/api/auth/password-reset/request', {
      body: { email },
      signal: authSignal(),
    })
  },
  async confirmPasswordReset(token: string, newPassword: string): Promise<void> {
    await apiClient.POST('/api/auth/password-reset/confirm', {
      body: { token, newPassword },
      signal: authSignal(),
    })
  },
}
