import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { usePushReminders } from './use-push-reminders'
import { pushApi } from '../api/push-api'

// Visibility rules and the standalone gate of the device opt-in
// (web-push change, ADR-0007). The browser surface (serviceWorker,
// PushManager, Notification, matchMedia) is stubbed on the jsdom navigator.

type PushManagerStub = {
  getSubscription: ReturnType<typeof vi.fn>
  subscribe: ReturnType<typeof vi.fn>
}
type RegistrationStub = { pushManager: PushManagerStub }

function stubPushSurface({
  permission = 'default',
  standalone = false,
}: { permission?: NotificationPermission; standalone?: boolean } = {}) {
  const registration: RegistrationStub = {
    pushManager: {
      getSubscription: vi.fn<() => Promise<unknown>>().mockResolvedValue(null),
      subscribe: vi.fn<() => Promise<unknown>>().mockResolvedValue({
        toJSON: () => ({
          endpoint: 'https://push.example.com/dev1',
          keys: { p256dh: 'key', auth: 'auth' },
        }),
      }),
    },
  }
  vi.stubGlobal('navigator', {
    ...window.navigator,
    serviceWorker: {
      getRegistration: vi.fn<() => Promise<unknown>>().mockResolvedValue(registration),
      ready: Promise.resolve(registration),
    },
  })
  vi.stubGlobal('Notification', { permission })
  vi.stubGlobal('PushManager', class PushManager {})
  vi.stubGlobal(
    'matchMedia',
    vi
      .fn<(query: string) => MediaQueryList>()
      .mockReturnValue({ matches: standalone } as MediaQueryList),
  )
  return registration
}

describe('usePushReminders', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows the opt-in when the server channel is on and the device is unsubscribed', async () => {
    stubPushSurface({ permission: 'default' })
    vi.spyOn(pushApi, 'getConfig').mockResolvedValue({
      enabled: true,
      vapidPublicKey: 'BBrU5E0NVwmY0xL1ZLXI2f',
    })

    const push = usePushReminders()
    await push.refreshServerState()
    await push.refreshBrowserState()

    expect(push.showOptIn.value).toBe(true)
  })

  it('hides the opt-in when the server has no VAPID keys', async () => {
    stubPushSurface({ permission: 'default' })
    vi.spyOn(pushApi, 'getConfig').mockResolvedValue({ enabled: false, vapidPublicKey: '' })

    const push = usePushReminders()
    await push.refreshServerState()
    await push.refreshBrowserState()

    expect(push.showOptIn.value).toBe(false)
  })

  it('hides the opt-in once the device holds a granted subscription', async () => {
    const registration = stubPushSurface({ permission: 'granted' })
    registration.pushManager.getSubscription.mockResolvedValue({
      toJSON: () => ({
        endpoint: 'https://push.example.com/dev1',
        keys: { p256dh: 'key', auth: 'auth' },
      }),
    })
    vi.spyOn(pushApi, 'getConfig').mockResolvedValue({
      enabled: true,
      vapidPublicKey: 'BBrU5E0NVwmY0xL1ZLXI2f',
    })
    vi.spyOn(pushApi, 'upsertSubscription').mockResolvedValue({
      id: '00000000-0000-4000-8000-000000000001',
      endpoint: 'https://push.example.com/dev1',
      keys: { p256dh: 'key', auth: 'auth' },
      timeZone: 'UTC',
      createdAt: '2026-09-06T00:00:00Z',
    })

    const push = usePushReminders()
    await push.refreshServerState()
    await push.refreshBrowserState()
    await push.ensureRegistered()

    expect(push.subscribed.value).toBe(true)
    expect(push.showOptIn.value).toBe(false)
  })

  it('re-registration never prompts and tolerates an absent subscription', async () => {
    const registration = stubPushSurface({ permission: 'granted' })
    registration.pushManager.getSubscription.mockResolvedValue(null)
    const upsert = vi
      .spyOn(pushApi, 'upsertSubscription')
      .mockResolvedValue({} as Awaited<ReturnType<typeof pushApi.upsertSubscription>>)

    const push = usePushReminders()
    await push.ensureRegistered()

    expect(upsert).not.toHaveBeenCalled()
  })

  it('enable() subscribes and upserts with the device timezone in a standalone PWA', async () => {
    stubPushSurface({ permission: 'default', standalone: true })
    vi.spyOn(pushApi, 'getConfig').mockResolvedValue({
      enabled: true,
      vapidPublicKey: 'BBrU5E0NVwmY0xL1ZLXI2f',
    })
    const upsert = vi
      .spyOn(pushApi, 'upsertSubscription')
      .mockResolvedValue({} as Awaited<ReturnType<typeof pushApi.upsertSubscription>>)
    const requestPermission = vi
      .fn<() => Promise<NotificationPermission>>()
      .mockResolvedValue('granted')
    vi.stubGlobal('Notification', { permission: 'default', requestPermission })
    const dateTimeFormat = vi
      .spyOn(Intl, 'DateTimeFormat')
      .mockReturnValue({ resolvedOptions: () => ({ timeZone: 'Europe/Moscow' }) } as never)

    const push = usePushReminders()
    const enabled = await push.enable()

    expect(enabled).toBe(true)
    expect(requestPermission).toHaveBeenCalledOnce()
    expect(dateTimeFormat).toHaveBeenCalled()
    expect(upsert).toHaveBeenCalledWith({
      endpoint: 'https://push.example.com/dev1',
      keys: { p256dh: 'key', auth: 'auth' },
      timeZone: 'Europe/Moscow',
    })
  })

  it('reports state for a device without push support (UI stays hidden)', () => {
    // jsdom navigator without the serviceWorker stub: the default surface.
    const push = usePushReminders()

    expect(push.state.value.supported).toBe(false)
    expect(push.showOptIn.value).toBe(false)
  })
})
