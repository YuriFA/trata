// Quick-date chips for the transaction sheet: the last seven days, labeled
// relative to "now" - today and yesterday by name, then the calendar date
// ("17 авг."). The chips re-derive from the current date instead of being
// hardcoded, and the ISO `occurredAt` they produce keeps the current time
// of day (the sheet picks a day, not a moment).

import { isoDaysAgo, shortDayLabel, todayLabel, yesterdayLabel } from '@trata/dates'

export interface QuickDateOption {
  daysAgo: number
  label: string
}

/** Today, yesterday, then each day's short date back to six days ago. */
export function quickDateOptions(now: Date = new Date()): QuickDateOption[] {
  return Array.from({ length: 7 }, (_, daysAgo) => ({
    daysAgo,
    label:
      daysAgo === 0
        ? todayLabel()
        : daysAgo === 1
          ? yesterdayLabel()
          : shortDayLabel(isoDaysAgo(daysAgo, now)),
  }))
}

/** The calendar day `daysAgo` back, at `now`'s time of day, as an ISO string. */
export function occurredAtForDaysAgo(daysAgo: number, now: Date = new Date()): string {
  return isoDaysAgo(daysAgo, now)
}
