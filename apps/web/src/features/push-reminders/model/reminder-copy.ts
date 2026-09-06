// Pure notification copy/route logic for reminder pushes - shared by the
// service worker entry (src/sw.ts) and unit-tested here, because the SW
// runtime itself is not unit-testable without heavy mocking.
//
// TODO(i18n): RU copy is hardcoded until the worker can read the app locale
// (same trade-off as the mobile reminder copy, openspec mobile-local-data).

/** Server payload (backend pushremind.ReminderPayload): presentational only. */
export interface ReminderPushPayload {
  planId?: string
  planName?: string
  confirmMode?: string
  type?: string
  amountMinor?: number
}

/** Parses raw push data; malformed JSON degrades to an empty payload. */
export function parseReminderPayload(raw: string | null | undefined): ReminderPushPayload {
  if (!raw) return {}
  try {
    const value = JSON.parse(raw) as ReminderPushPayload
    return typeof value === 'object' && value !== null ? value : {}
  } catch {
    return {}
  }
}

export function formatAmountMinor(minor: number): string {
  return `${(minor / 100).toLocaleString('ru-RU')} ₽`
}

/** Notification title: the plan's name, falling back to the section name. */
export function reminderTitle(payload: ReminderPushPayload): string {
  const name = payload.planName?.trim()
  return name && name.length > 0 ? name : 'Планы'
}

/** Copy per confirm mode: manual prompts an action, auto announces. */
export function reminderBody(payload: ReminderPushPayload): string {
  const amountText = formatAmountMinor(payload.amountMinor ?? 0)
  if (payload.confirmMode === 'manual') {
    return `Подтверди платёж ${amountText}`
  }
  return payload.type === 'income'
    ? `Сегодня зачислится ${amountText}`
    : `Сегодня спишется ${amountText}`
}

/** The confirm-flow route a notification activation opens. */
export function confirmRouteFor(planId: string | undefined): string {
  return planId ? `/plans?confirm=${encodeURIComponent(planId)}` : '/plans'
}

/** showNotification() options for a reminder payload (tag dedupes per plan). */
export function notificationOptions(payload: ReminderPushPayload): {
  body: string
  tag: string
  data: { planId: string | undefined }
} {
  return {
    body: reminderBody(payload),
    tag: payload.planId ? `plan-reminder-${payload.planId}` : 'plan-reminder',
    data: { planId: payload.planId },
  }
}

/**
 * The already-open window a notification activation should focus (and
 * navigate via postMessage, never a reload); undefined = open a new one.
 * Pure decision for the SW's notificationclick glue.
 */
export function pickFocusableClient<C extends object>(clients: readonly C[]): C | undefined {
  return clients.find((client) => 'focus' in client)
}
