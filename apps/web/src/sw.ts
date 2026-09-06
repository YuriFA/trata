/// <reference lib="webworker" />

// Custom service worker (web-push change, ADR-0007): the app-shell precache
// (unchanged posture - NO runtime caching, API requests always hit the
// network), the prompted-update handshake, and the two new push handlers:
// `push` displays planned-payment reminders with the app closed,
// `notificationclick` focuses an open window (navigating it via postMessage,
// so it is never reloaded) or opens the app at the plan's confirm flow.
//
// This file replaces the workbox generateSW output (vite-plugin-pwa
// injectManifest): the build injects the precache manifest in place of
// self.__WB_MANIFEST.

import { precacheAndRoute, createHandlerBoundToURL } from 'workbox-precaching'
import { registerRoute, NavigationRoute } from 'workbox-routing'
import {
  notificationOptions,
  parseReminderPayload,
  pickFocusableClient,
  reminderTitle,
  confirmRouteFor,
} from './features/push-reminders/model/reminder-copy'

declare let self: ServiceWorkerGlobalScope

precacheAndRoute(self.__WB_MANIFEST)

// SPA navigation fallback: same rule the generated worker had - every
// navigation serves the shell, except /api/* which passes through (the
// no-cached-API-responses posture).
registerRoute(
  new NavigationRoute(createHandlerBoundToURL('index.html'), {
    denylist: [/^\/api\//],
  }),
)

// Prompted updates (spec: web-pwa "Prompted updates"): the waiting worker
// activates only when the page asks for it (registerSW's updateSW(true)
// posts SKIP_WAITING); never on its own.
self.addEventListener('message', (event: ExtendableMessageEvent) => {
  if (event.data?.type === 'SKIP_WAITING') void self.skipWaiting()
})

// --- Reminder push handling -------------------------------------------------
//
// Copy and routing live in the pure, unit-tested reminder-copy module;
// only the SW event glue remains here.

self.addEventListener('push', (event: PushEvent) => {
  const payload = parseReminderPayload(event.data ? event.data.text() : null)
  const options = notificationOptions(payload)
  event.waitUntil(self.registration.showNotification(reminderTitle(payload), options))
})

self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close()
  const planId = (event.notification.data as { planId?: string } | undefined)?.planId
  event.waitUntil(focusOrOpen(confirmRouteFor(planId)))
})

/**
 * Focus an already-open app window and navigate it via postMessage (the app
 * translates the message into a router.push - no document reload, so no
 * in-progress form state is lost); with no window open, open the app at the
 * notification's route.
 */
async function focusOrOpen(url: string): Promise<void> {
  const windowClients = await self.clients.matchAll({
    type: 'window',
    includeUncontrolled: true,
  })
  const client = pickFocusableClient(windowClients)
  if (client) {
    await client.focus()
    client.postMessage({ type: 'NAVIGATE', url })
    return
  }
  await self.clients.openWindow(url)
}
