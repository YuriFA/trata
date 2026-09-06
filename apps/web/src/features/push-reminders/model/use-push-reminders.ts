import { computed, ref } from 'vue'
import { pushApi } from '../api/push-api'

// Device-level Web Push opt-in state and flows (web-push change, ADR-0007).
//
// The permission prompt fires ONLY from the explicit opt-in entry (or from
// enabling a reminder in the plan form - it calls the same enable()); app
// open does re-REGISTRATION only, which for an already-granted permission
// is a silent idempotent upsert refreshing keys and the device timezone.

export type PushRemindersState = {
  /** The browser exposes the Push API at all (false: unsupported, UI hidden). */
  supported: boolean
  /** The server has VAPID keys configured (false: opt-in hidden). */
  serverEnabled: boolean
  /** Current notification permission state. */
  permission: NotificationPermission | 'unsupported'
  /** The app runs as an installed (standalone) PWA. */
  standalone: boolean
  /** A browser push subscription exists on this device. */
  hasSubscription: boolean
  /** The last enable() attempt failed (retry affordance). */
  error: boolean
}

function isStandalone(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  const nav = window.navigator as Navigator & { standalone?: boolean }
  return window.matchMedia('(display-mode: standalone)').matches || nav.standalone === true
}

function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

/** VAPID public key is base64 (RFC 8292); subscribe() wants raw bytes. */
function urlBase64ToBytes(key: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (key.length % 4)) % 4)
  const base64 = (key + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const bytes = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return bytes
}

export function usePushReminders() {
  const supported =
    typeof window !== 'undefined' &&
    'serviceWorker' in window.navigator &&
    'PushManager' in window &&
    'Notification' in window

  const permission = ref<NotificationPermission | 'unsupported'>(
    supported ? window.Notification.permission : 'unsupported',
  )
  const standalone = ref(isStandalone())
  const hasSubscription = ref(false)
  const serverEnabled = ref(false)
  const error = ref(false)
  const enabling = ref(false)

  const subscribed = computed(() => permission.value === 'granted' && hasSubscription.value)

  const state = computed<PushRemindersState>(() => ({
    supported,
    serverEnabled: serverEnabled.value,
    permission: permission.value,
    standalone: standalone.value,
    hasSubscription: hasSubscription.value,
    error: error.value,
  }))

  /** The opt-in entry is offered only where it can do something. */
  const showOptIn = computed(
    () => supported && serverEnabled.value && !subscribed.value && permission.value !== 'denied',
  )

  async function refreshBrowserState(): Promise<void> {
    if (!supported) return
    permission.value = window.Notification.permission
    standalone.value = isStandalone()
    try {
      const registration = await window.navigator.serviceWorker.getRegistration()
      const subscription = registration ? await registration.pushManager.getSubscription() : null
      hasSubscription.value = subscription !== null
    } catch {
      hasSubscription.value = false
    }
  }

  async function refreshServerState(): Promise<void> {
    if (!supported) return
    try {
      serverEnabled.value = (await pushApi.getConfig()).enabled
    } catch {
      // Offline or anonymous: the entry stays hidden until the next check.
      serverEnabled.value = false
    }
  }

  /**
   * Idempotent re-registration for app open: with permission already
   * granted and a browser subscription present, upsert it to the server so
   * keys and the timezone stay fresh. Never prompts (nothing here touches
   * permissions) and never throws into the boot path.
   */
  async function ensureRegistered(): Promise<void> {
    if (!supported || permission.value !== 'granted') return
    try {
      const registration = await window.navigator.serviceWorker.getRegistration()
      const subscription = registration ? await registration.pushManager.getSubscription() : null
      if (!subscription) return
      await upsertToServer(subscription)
      hasSubscription.value = true
    } catch {
      // Offline / anonymous: retried on the next open.
    }
  }

  async function upsertToServer(subscription: PushSubscriptionJSON): Promise<void> {
    if (!subscription.endpoint || !subscription.keys?.p256dh || !subscription.keys.auth) {
      throw new Error('push subscription is missing endpoint or keys')
    }
    await pushApi.upsertSubscription({
      endpoint: subscription.endpoint,
      keys: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth },
      timeZone: deviceTimeZone(),
    })
  }

  /**
   * The explicit opt-in: only meaningful in a standalone (installed) PWA -
   * in a regular tab browsers (notably iOS Safari) cannot grant push
   * permission, so the caller shows the install hint instead of calling
   * this. Never invoked automatically.
   */
  async function enable(): Promise<boolean> {
    if (!supported || enabling.value) return false
    error.value = false
    enabling.value = true
    try {
      const config = await pushApi.getConfig()
      if (!config.enabled || !config.vapidPublicKey) return false

      const granted = await window.Notification.requestPermission()
      permission.value = granted
      if (granted !== 'granted') return false

      const registration = await window.navigator.serviceWorker.ready
      const existing = await registration.pushManager.getSubscription()
      const subscription =
        existing ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToBytes(config.vapidPublicKey),
        }))
      await upsertToServer(subscription.toJSON())
      hasSubscription.value = true
      return true
    } catch {
      error.value = true
      return false
    } finally {
      enabling.value = false
    }
  }

  return {
    state,
    showOptIn,
    subscribed,
    enabling,
    refreshBrowserState,
    refreshServerState,
    ensureRegistered,
    enable,
  }
}
