import { apiClient } from '@/shared/api'
import type { components } from '@/shared/api'

// Typed wrappers over the generated client for the push surface (web-push
// change, ADR-0007). Subscriptions are server-side per-device records -
// these calls are plain online API requests (like the session API), not
// local-data repositories.

type ApiPushSubscription = components['schemas']['PushSubscription']
type ApiPushConfig = components['schemas']['PushConfig']

/** The browser PushSubscription JSON plus the device's IANA timezone. */
export interface PushSubscriptionInput {
  endpoint: string
  keys: { p256dh: string; auth: string }
  timeZone: string
}

export const pushApi = {
  async upsertSubscription(input: PushSubscriptionInput): Promise<ApiPushSubscription> {
    const { data } = await apiClient.POST('/api/push/subscriptions', {
      body: {
        endpoint: input.endpoint,
        keys: input.keys,
        timeZone: input.timeZone,
      },
    })
    if (data === undefined) throw new Error('Expected a response body but received none')
    return data
  },

  async deleteSubscription(id: string): Promise<void> {
    await apiClient.DELETE('/api/push/subscriptions/{id}', { params: { path: { id } } })
  },

  async getConfig(): Promise<ApiPushConfig> {
    const { data } = await apiClient.GET('/api/config/push')
    if (data === undefined) throw new Error('Expected a response body but received none')
    return data
  },
}
