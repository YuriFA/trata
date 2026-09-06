import { watch } from 'vue'
import router from './router'
import { useAuthStore } from '@/entities/session'
import { usePushReminders } from '@/features/push-reminders'

// Boot wiring for the push reminder channel (web-push change, ADR-0007).
//
// NAVIGATE messages: the service worker's notificationclick focuses an open
// window and posts this message instead of navigating it - the router.push
// below changes the route without reloading the document, so in-progress
// form state survives (web-pwa spec: open windows are focused, never
// reloaded).
//
// Re-registration: once a session exists, the device's existing browser
// subscription (if any) is upserted to the server - an idempotent refresh
// of keys and timezone that never touches permissions. The permission
// prompt fires only from the explicit opt-in entry.

export function setupPushReminders(): void {
  if (typeof window === 'undefined' || !('serviceWorker' in window.navigator)) return

  window.navigator.serviceWorker.addEventListener('message', (event: MessageEvent) => {
    const data = event.data as { type?: string; url?: string } | null
    if (data?.type === 'NAVIGATE' && data.url) void router.push(data.url)
  })

  const push = usePushReminders()
  void push.refreshBrowserState()

  const auth = useAuthStore()
  watch(
    () => auth.isAuthenticated,
    (authenticated) => {
      if (!authenticated) return
      void push.refreshServerState()
      void push.ensureRegistered()
    },
    { immediate: true },
  )
}
