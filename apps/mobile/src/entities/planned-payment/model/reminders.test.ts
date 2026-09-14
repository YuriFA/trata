// Reminder scheduling behavior (design D9, openspec mobile-local-data
// "Planned payment reminders"): 10:00 device-local trigger dates for
// `day_before` / `on_day`, past-date skipping, per-plan copy by confirm mode,
// prefix-scoped cancel (deleted plans lose reminders, foreign notifications
// survive), idempotent rescheduling via deterministic ids, and silent
// permission-denied degradation.

import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import type { PlannedPayment } from '@trata/api'
import * as Notifications from 'expo-notifications'
import { formatAmount } from '@/shared/lib/format/format'
import { planReminderDate, reschedule } from './reminders'

// In-memory scheduler store exposed on the mock for assertions.
jest.mock('expo-notifications', () => {
  const scheduled = new Map<
    string,
    { identifier?: string; content: { title?: string; body?: string }; trigger?: unknown }
  >()
  let granted = true
  return {
    __esModule: true,
    SchedulableTriggerInputTypes: { DATE: 'date' },
    _store: scheduled,
    _setGranted: (value: boolean) => {
      granted = value
    },
    getAllScheduledNotificationsAsync: async () => [...scheduled.values()],
    cancelScheduledNotificationAsync: async (identifier: string) => {
      scheduled.delete(identifier)
    },
    scheduleNotificationAsync: async (request: {
      identifier?: string
      content: { title?: string; body?: string }
      trigger?: unknown
    }) => {
      const identifier = request.identifier ?? `anon-${scheduled.size + 1}`
      scheduled.set(identifier, request)
      return identifier
    },
    getPermissionsAsync: async () => ({ granted }),
    requestPermissionsAsync: async () => {
      granted = true
      return { granted }
    },
  }
})

const mocked = Notifications as unknown as {
  _store: Map<
    string,
    { identifier: string; content: { title?: string; body?: string }; trigger?: { date?: Date } }
  >
  _setGranted: (value: boolean) => void
}

// Far-future "now" keeps every trigger date in the future deterministically.
const NOW = new Date(2099, 7, 1, 12, 0, 0)

function plan(overrides: Partial<PlannedPayment>): PlannedPayment {
  return {
    id: 'plan-1',
    type: 'expense',
    amount: 59_900,
    name: 'Netflix',
    accountId: 'acc-1',
    categoryId: 'cat-1',
    nextDue: '2099-09-05',
    anchorDate: '2099-09-05',
    regularity: 'monthly',
    confirmMode: 'manual',
    reminder: 'on_day',
    note: '',
    version: 1,
    ...overrides,
  }
}

function scheduledIds() {
  return [...mocked._store.keys()].sort()
}

beforeEach(() => {
  mocked._store.clear()
  mocked._setGranted(true)
})

describe('planReminderDate', () => {
  it('targets 10:00 on the due day, or the previous day for day_before', () => {
    expect(planReminderDate(plan({ reminder: 'on_day' }), NOW)).toEqual(
      new Date(2099, 8, 5, 10, 0, 0),
    )
    expect(planReminderDate(plan({ reminder: 'day_before' }), NOW)).toEqual(
      new Date(2099, 8, 4, 10, 0, 0),
    )
  })

  it('skips trigger dates already in the past, including day_before of today', () => {
    const todayNoon = new Date(2099, 8, 5, 12, 0, 0)
    expect(planReminderDate(plan({ reminder: 'on_day' }), todayNoon)).toBeNull()
    expect(planReminderDate(plan({ reminder: 'day_before' }), todayNoon)).toBeNull()
    // A due day later today still fires: 10:00 has not passed at 09:00.
    expect(planReminderDate(plan({ reminder: 'on_day' }), new Date(2099, 8, 5, 9, 0, 0))).toEqual(
      new Date(2099, 8, 5, 10, 0, 0),
    )
  })

  it('rolls day_before of the 1st into the previous month', () => {
    expect(planReminderDate(plan({ nextDue: '2099-09-01', reminder: 'day_before' }), NOW)).toEqual(
      new Date(2099, 7, 31, 10, 0, 0),
    )
  })
})

describe('reschedule', () => {
  it('schedules per-plan notifications with mode copy at the computed trigger', async () => {
    await reschedule(
      [
        plan({ id: 'plan-manual', reminder: 'day_before' }),
        plan({ id: 'plan-auto-expense', confirmMode: 'auto' }),
        plan({ id: 'plan-auto-income', type: 'income', confirmMode: 'auto' }),
      ],
      NOW,
    )

    expect(scheduledIds()).toEqual([
      'plan-reminder-plan-auto-expense',
      'plan-reminder-plan-auto-income',
      'plan-reminder-plan-manual',
    ])

    const manual = mocked._store.get('plan-reminder-plan-manual')
    expect(manual?.content).toEqual({
      title: 'Планы',
      body: `Подтверди платёж ${formatAmount(59_900, 'RUB')}`,
    })
    expect(manual?.trigger?.date).toEqual(new Date(2099, 8, 4, 10, 0, 0))

    expect(mocked._store.get('plan-reminder-plan-auto-expense')?.content.body).toBe(
      `Сегодня спишется ${formatAmount(59_900, 'RUB')}`,
    )
    expect(mocked._store.get('plan-reminder-plan-auto-income')?.content.body).toBe(
      `Сегодня зачислится ${formatAmount(59_900, 'RUB')}`,
    )
  })

  it('schedules nothing for reminders off or trigger dates in the past', async () => {
    await reschedule(
      [plan({ id: 'plan-off', reminder: 'off' }), plan({ id: 'plan-past', nextDue: '2020-01-01' })],
      NOW,
    )

    expect(scheduledIds()).toEqual([])
  })

  it('cancels deleted plans and leaves foreign notifications untouched', async () => {
    mocked._store.set('other-feature-1', { identifier: 'other-feature-1', content: {} })
    await reschedule([plan({ id: 'plan-kept' })], NOW)
    expect(scheduledIds()).toEqual(['other-feature-1', 'plan-reminder-plan-kept'])

    // The plan vanishes (deleted locally or via pull): its reminder cancels.
    await reschedule([], NOW)
    expect(scheduledIds()).toEqual(['other-feature-1'])
  })

  it('is idempotent — rescheduling the same plans yields the same single set', async () => {
    const plans = [plan({ id: 'plan-a' }), plan({ id: 'plan-b', reminder: 'day_before' })]
    await reschedule(plans, NOW)
    await reschedule(plans, NOW)

    expect(scheduledIds()).toEqual(['plan-reminder-plan-a', 'plan-reminder-plan-b'])
  })

  it('no-ops scheduling when permission is denied (silent degradation)', async () => {
    await reschedule([plan({ id: 'plan-1' })], NOW)
    mocked._setGranted(false)

    await reschedule([plan({ id: 'plan-1' })], NOW)

    // The stale reminders are canceled, nothing new is scheduled, and the
    // call still resolves — the setting stays stored and synced.
    expect(scheduledIds()).toEqual([])
  })
})
