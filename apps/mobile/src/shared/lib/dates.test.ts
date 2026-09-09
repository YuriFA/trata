// Coverage for the @trata/dates package as consumed by the app.
// Local-time fixtures (`new Date(y, m, d, …)`) keep the calendar dates stable
// across timezones; ISO fixtures use midday UTC for the same reason.

import { describe, expect, it } from '@jest/globals'
import {
  calendarDayKey,
  calendarDaysAgo,
  dateTimeLabel,
  fullDayLabel,
  isCurrentOrFutureMonth,
  isoDaysAgo,
  monthGrid,
  monthLabel,
  monthRangeLabel,
  monthRangeLabelShort,
  nextMonth,
  nowIso,
  previousMonth,
  relativeDayLabel,
  shortDayLabel,
  todayLabel,
  transactionsInMonth,
  weekdayLabels,
  yesterdayLabel,
} from '@trata/dates'

describe('dates · period labels', () => {
  it('monthRangeLabel keeps the uppercase summary-card style', () => {
    expect(monthRangeLabel(2026, 7)).toBe('1 АВГ. — 31 АВГ.')
    expect(monthRangeLabel(2026, 1)).toBe('1 ФЕВ. — 28 ФЕВ.')
    expect(monthRangeLabel(2028, 1)).toBe('1 ФЕВ. — 29 ФЕВ.')
  })

  it('monthRangeLabelShort renders the lowercase sheet-subtitle style', () => {
    expect(monthRangeLabelShort(2026, 7)).toBe('1 авг. - 31 авг.')
    expect(monthRangeLabelShort(2026, 0)).toBe('1 янв. - 31 янв.')
    expect(monthRangeLabelShort(2026, 3)).toBe('1 апр. - 30 апр.')
  })
})

describe('dates · fullDayLabel', () => {
  it('renders the day with a genitive month name', () => {
    expect(fullDayLabel('2026-08-17T12:00:00.000Z')).toBe('17 августа')
    expect(fullDayLabel('2026-01-02T12:00:00.000Z')).toBe('2 января')
    expect(fullDayLabel('2026-12-31T12:00:00.000Z')).toBe('31 декабря')
  })
})

describe('dates · relative day labels', () => {
  const now = new Date(2026, 7, 19, 15, 0)

  it('labels today and yesterday', () => {
    expect(relativeDayLabel(new Date(2026, 7, 19, 3, 0), { now })).toBe('Сегодня')
    expect(relativeDayLabel(new Date(2026, 7, 18, 23, 30), { now })).toBe('Вчера')
  })

  it('falls back to the uppercase abbreviated day for older and future dates', () => {
    expect(relativeDayLabel(new Date(2026, 7, 5, 12, 0), { now })).toBe('5 АВГ.')
    expect(relativeDayLabel(new Date(2026, 4, 14, 12, 0), { now })).toBe('14 МАЯ')
    expect(relativeDayLabel(new Date(2026, 7, 21, 12, 0), { now })).toBe('21 АВГ.')
  })

  it('counts whole calendar days across midnight', () => {
    expect(calendarDaysAgo(new Date(2026, 7, 19, 0, 1), now)).toBe(0)
    expect(calendarDaysAgo(new Date(2026, 7, 18, 23, 59), now)).toBe(1)
    expect(calendarDaysAgo(new Date(2026, 7, 21, 12, 0), now)).toBe(-2)
  })
})

describe('dates · shortDayLabel', () => {
  it('renders the lowercase abbreviated day', () => {
    expect(shortDayLabel(new Date(2026, 7, 17))).toBe('17 авг.')
    expect(shortDayLabel(new Date(2026, 0, 2))).toBe('2 янв.')
    expect(shortDayLabel(new Date(2026, 4, 14))).toBe('14 мая')
  })
})

describe('dates · month cursor', () => {
  it('wraps navigation across year boundaries', () => {
    expect(previousMonth({ year: 2026, month: 0 })).toEqual({ year: 2025, month: 11 })
    expect(nextMonth({ year: 2026, month: 11 })).toEqual({ year: 2027, month: 0 })
    expect(previousMonth({ year: 2026, month: 7 })).toEqual({ year: 2026, month: 6 })
  })

  it('clamps future months', () => {
    const now = new Date(2026, 7, 19)
    expect(isCurrentOrFutureMonth({ year: 2026, month: 7 }, now)).toBe(true)
    expect(isCurrentOrFutureMonth({ year: 2026, month: 8 }, now)).toBe(true)
    expect(isCurrentOrFutureMonth({ year: 2026, month: 6 }, now)).toBe(false)
    expect(isCurrentOrFutureMonth({ year: 2027, month: 0 }, now)).toBe(true)
  })

  it('filters items by local occurredAt month', () => {
    const items = [
      { occurredAt: new Date(2026, 7, 17, 12).toISOString() },
      { occurredAt: new Date(2026, 6, 31, 12).toISOString() },
    ]
    expect(transactionsInMonth(items, { year: 2026, month: 7 })).toEqual([items[0]])
  })
})

describe('dates · monthLabel', () => {
  it('renders the capitalized nominative name for headers', () => {
    expect(monthLabel(2026, 7)).toBe('Август')
    expect(monthLabel(2026, 0)).toBe('Январь')
  })
})

describe('dates · month grid', () => {
  it('pads leading nulls Monday-first and chunks into weeks (Aug 2026, Sat start)', () => {
    const weeks = monthGrid(2026, 7)
    expect(weeks[0]).toEqual([null, null, null, null, null, 1, 2])
    expect(weeks).toHaveLength(6)
    expect(weeks[5]).toEqual([31])
  })

  it('handles leap February (Feb 2028, Tue start)', () => {
    const weeks = monthGrid(2028, 1)
    expect(weeks[0]).toEqual([null, 1, 2, 3, 4, 5, 6])
    expect(weeks).toHaveLength(5)
    expect(weeks[4]).toEqual([28, 29])
  })
})

describe('dates · weekday labels', () => {
  it('renders Monday-first uppercase abbreviations', () => {
    expect(weekdayLabels()).toEqual(['ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ', 'ВС'])
  })
})

describe('dates · keys and timestamps', () => {
  it('calendarDayKey pads month and day', () => {
    expect(calendarDayKey(new Date(2026, 7, 17))).toBe('2026-08-17')
    expect(calendarDayKey(new Date(2026, 0, 2))).toBe('2026-01-02')
  })

  it('isoDaysAgo keeps the reference time of day', () => {
    const now = new Date(2026, 7, 19, 15, 30, 10)
    expect(isoDaysAgo(3, now)).toBe(new Date(2026, 7, 16, 15, 30, 10).toISOString())
  })

  it('nowIso returns a UTC ISO-8601 timestamp', () => {
    const before = Date.now()
    const iso = nowIso()
    const after = Date.now()
    const time = Date.parse(iso)
    expect(time).toBeGreaterThanOrEqual(before)
    expect(time).toBeLessThanOrEqual(after)
  })
})

describe('dates · today/yesterday labels', () => {
  it('shapes per locale', () => {
    expect(todayLabel()).toBe('Сегодня')
    expect(yesterdayLabel()).toBe('Вчера')
    expect(todayLabel('en')).toBe('Today')
    expect(yesterdayLabel('en')).toBe('Yesterday')
  })
})

describe('dates · dateTimeLabel', () => {
  it('renders the numeric ru status-line style', () => {
    expect(dateTimeLabel(new Date(2026, 7, 17, 14, 30))).toBe('17.08.2026, 14:30')
    expect(dateTimeLabel(new Date(2026, 0, 2, 9, 5))).toBe('02.01.2026, 09:05')
  })
})
