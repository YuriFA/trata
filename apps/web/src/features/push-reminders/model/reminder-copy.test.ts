import { describe, it, expect } from 'vitest'
import {
  confirmRouteFor,
  formatAmountMinor,
  notificationOptions,
  parseReminderPayload,
  pickFocusableClient,
  reminderBody,
  reminderTitle,
} from './reminder-copy'

describe('parseReminderPayload', () => {
  it('parses the server payload shape', () => {
    const payload = parseReminderPayload(
      '{"planId":"p1","planName":"Netflix","confirmMode":"manual","type":"expense","amountMinor":59900}',
    )
    expect(payload).toEqual({
      planId: 'p1',
      planName: 'Netflix',
      confirmMode: 'manual',
      type: 'expense',
      amountMinor: 59900,
    })
  })

  it('degrades malformed JSON to an empty payload', () => {
    expect(parseReminderPayload('not json')).toEqual({})
    expect(parseReminderPayload(null)).toEqual({})
    expect(parseReminderPayload(undefined)).toEqual({})
  })
})

describe('reminderTitle', () => {
  it('uses the plan name when present', () => {
    expect(reminderTitle({ planName: 'Квартплата' })).toBe('Квартплата')
  })

  it('falls back to the section name for unnamed or malformed payloads', () => {
    expect(reminderTitle({})).toBe('Планы')
    expect(reminderTitle({ planName: '   ' })).toBe('Планы')
  })
})

describe('reminderBody', () => {
  it('prompts an action for manual plans', () => {
    expect(reminderBody({ confirmMode: 'manual', amountMinor: 59900 })).toContain('Подтверди')
    expect(reminderBody({ confirmMode: 'manual', amountMinor: 59900 })).toContain('599')
  })

  it('announces the direction for auto plans', () => {
    expect(reminderBody({ confirmMode: 'auto', type: 'expense', amountMinor: 240000 })).toContain(
      'спишется',
    )
    expect(reminderBody({ confirmMode: 'auto', type: 'income', amountMinor: 240000 })).toContain(
      'зачислится',
    )
  })
})

describe('formatAmountMinor', () => {
  it('renders minor units as ruble majors', () => {
    expect(formatAmountMinor(59900)).toBe('599 ₽')
  })
})

describe('confirmRouteFor', () => {
  it('builds the confirm deep link for a plan', () => {
    expect(confirmRouteFor('p-1')).toBe('/plans?confirm=p-1')
  })

  it('falls back to the plans screen without a plan id', () => {
    expect(confirmRouteFor(undefined)).toBe('/plans')
  })
})

describe('notificationOptions', () => {
  it('carries copy, a per-plan dedupe tag, and the plan id for activation', () => {
    const options = notificationOptions({
      planId: 'p-1',
      confirmMode: 'manual',
      amountMinor: 59900,
    })
    expect(options.body).toContain('Подтверди')
    expect(options.tag).toBe('plan-reminder-p-1')
    expect(options.data).toEqual({ planId: 'p-1' })
  })

  it('degrades to the generic tag without a plan id', () => {
    expect(notificationOptions({}).tag).toBe('plan-reminder')
  })
})

describe('pickFocusableClient', () => {
  it('prefers focusing an already-open window', () => {
    const focusable = { focus: () => Promise.resolve() }
    expect(pickFocusableClient([{ postMessage: () => {} }, focusable])).toBe(focusable)
  })

  it('reports that a new window must be opened', () => {
    expect(pickFocusableClient([{ postMessage: () => {} }])).toBeUndefined()
    expect(pickFocusableClient([])).toBeUndefined()
  })
})
