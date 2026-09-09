// Local plan reminders (design D9, openspec mobile-local-data "Planned
// payment reminders"): each device schedules its own notifications for live
// plans with reminders enabled — 10:00 device-local, on the due day or the
// day before — entirely from local data; there is no server push. Reminder
// ids are deterministic (`plan-reminder-<planId>`), so rescheduling is
// idempotent: every notification carrying the `plan-reminder-` prefix is
// canceled first (deleted plans lose their reminders), then one notification
// per plan is scheduled, skipping dates already in the past. Denied
// notification permission degrades silently — the setting stays stored and
// synced, the scheduler simply no-ops.
// TODO(i18n): RU copy is hardcoded until react-i18next is wired.

import * as Notifications from 'expo-notifications'
import type { PlannedPayment } from '@trata/api'
import { formatAmount } from '@/shared/lib/format/format'

const ID_PREFIX = 'plan-reminder-'
const REMINDER_HOUR = 10

/** Asks the OS for notification permission; denial is silent (returns false). */
export async function requestNotificationPermissions(): Promise<boolean> {
  const settings = await Notifications.requestPermissionsAsync()
  return settings.granted
}

/**
 * The 10:00 device-local trigger date of the plan's next reminder, or null
 * when it is already in the past (never scheduled).
 */
export function planReminderDate(
  plan: Pick<PlannedPayment, 'nextDue' | 'reminder'>,
  now: Date,
): Date | null {
  const [year, month, day] = plan.nextDue.split('-').map(Number)
  if (!year || !month || !day) return null
  // `day - 1` on the 1st rolls into the previous month — exactly the intent.
  const dueDay = new Date(year, month - 1, plan.reminder === 'day_before' ? day - 1 : day)
  const trigger = new Date(
    dueDay.getFullYear(),
    dueDay.getMonth(),
    dueDay.getDate(),
    REMINDER_HOUR,
    0,
    0,
    0,
  )
  return trigger.getTime() <= now.getTime() ? null : trigger
}

/** Copy per confirm mode: auto announces the charge, manual prompts. */
function reminderBody(plan: PlannedPayment): string {
  const amountText = formatAmount(plan.amount)
  if (plan.confirmMode === 'manual') {
    return `Подтверди платёж ${amountText}`
  }
  return plan.type === 'expense'
    ? `Сегодня спишется ${amountText}`
    : `Сегодня зачислится ${amountText}`
}

/**
 * Re-syncs pending reminders with the given live plans: cancel every
 * `plan-reminder-*` notification, then schedule one per plan (reminder
 * enabled, trigger date in the future, permission granted).
 */
export async function reschedule(plans: PlannedPayment[], now: Date = new Date()): Promise<void> {
  // Only notifications this module owns are touched — other ids survive.
  const scheduled = await Notifications.getAllScheduledNotificationsAsync()
  for (const notification of scheduled) {
    if (notification.identifier.startsWith(ID_PREFIX)) {
      await Notifications.cancelScheduledNotificationAsync(notification.identifier)
    }
  }

  const { granted } = await Notifications.getPermissionsAsync()
  if (!granted) return

  for (const plan of plans) {
    if (plan.reminder === 'off') continue
    const date = planReminderDate(plan, now)
    if (!date) continue
    await Notifications.scheduleNotificationAsync({
      identifier: `${ID_PREFIX}${plan.id}`,
      content: { title: 'Планы', body: reminderBody(plan) },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date },
    })
  }
}
