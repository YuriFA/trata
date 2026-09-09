// Typed wrappers over the generated client for the auth/session surface -
// the mobile twin of apps/web's session-api. The session is a stateful cookie
// set by the backend; RN's shared cookie store sends it with every request
// (`credentials: 'include'` on the client), so these calls carry no tokens.

import type { components } from '@trata/api'
import { apiClient } from '@/shared/api/client'
import type { User } from '../model/types'

type ApiUser = components['schemas']['User']

function toUser(value: ApiUser): User {
  return {
    id: value.id,
    email: value.email,
    emailVerified: value.emailVerified,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
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

export const sessionApi = {
  /**
   * Registration deliberately leaves `seedCategories` off: the mobile product
   * starts with an empty category list (seeding is opt-in per the spec).
   */
  async register(email: string, password: string): Promise<User> {
    const { data } = await apiClient.POST('/api/auth/register', { body: { email, password } })
    return toUser(requireData(data))
  },

  async login(email: string, password: string): Promise<User> {
    const { data } = await apiClient.POST('/api/auth/login', { body: { email, password } })
    return toUser(requireData(data))
  },

  async logout(): Promise<void> {
    await apiClient.POST('/api/auth/logout')
  },

  async getCurrentUser(): Promise<User> {
    const { data } = await apiClient.GET('/api/auth/me')
    return toUser(requireData(data))
  },
}
