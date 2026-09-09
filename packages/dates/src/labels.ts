// Day and period display labels shaped per locale on top of date-fns. The
// Russian forms rely on date-fns locale data (no Intl dependency), including
// the genitive month after a day number ("17 августа") and the plural rules
// of relative distances ("2 дня назад" / "5 дней назад").

import { differenceInCalendarDays, format, lastDayOfMonth } from 'date-fns'
import { DEFAULT_DATE_LOCALE, resolveDateLocale } from './locale'

/** Options for display labels computed against "now". */
export interface DateLabelOptions {
  /** BCP-47 locale; defaults to the package's display default (`ru`). */
  locale?: string
  /** "Now" that relative labels are computed against; defaults to current time. */
  now?: Date
}

const asDate = (value: Date | string): Date => (typeof value === 'string' ? new Date(value) : value)

// TODO(i18n): these two labels are app copy living here as the single source
// (mobile used to hardcode them twice); move them into the shared
// @trata/i18n bundle once mobile wires react-i18next.

/** "Сегодня" / "Today". */
export function todayLabel(locale: string = DEFAULT_DATE_LOCALE): string {
  return locale.toLowerCase().startsWith('ru') ? 'Сегодня' : 'Today'
}

/** "Вчера" / "Yesterday". */
export function yesterdayLabel(locale: string = DEFAULT_DATE_LOCALE): string {
  return locale.toLowerCase().startsWith('ru') ? 'Вчера' : 'Yesterday'
}

/** Reference-style period label: "1 АВГ. — 31 АВГ." (whole month span). */
export function monthRangeLabel(year: number, month: number, locale: string = DEFAULT_DATE_LOCALE): string {
  const dateLocale = resolveDateLocale(locale)
  const first = new Date(year, month, 1)
  const last = lastDayOfMonth(first)
  return `${format(first, 'd MMM', { locale: dateLocale })} — ${format(last, 'd MMM', { locale: dateLocale })}`.toUpperCase()
}

/** Lowercase period label for sheet subtitles: "1 авг. - 31 авг.". */
export function monthRangeLabelShort(year: number, month: number, locale: string = DEFAULT_DATE_LOCALE): string {
  const dateLocale = resolveDateLocale(locale)
  const first = new Date(year, month, 1)
  const last = lastDayOfMonth(first)
  return `${format(first, 'd MMM', { locale: dateLocale })} - ${format(last, 'd MMM', { locale: dateLocale })}`
}

/** Full day label for expense-list group headers: "17 августа". */
export function fullDayLabel(value: Date | string, locale: string = DEFAULT_DATE_LOCALE): string {
  return format(asDate(value), 'd MMMM', { locale: resolveDateLocale(locale) })
}

/** Short day label for quick-date chips: "17 авг.". */
export function shortDayLabel(value: Date | string, locale: string = DEFAULT_DATE_LOCALE): string {
  return format(asDate(value), 'd MMM', { locale: resolveDateLocale(locale) })
}

/** Whole calendar days between `value` and `now` (local midnights); negative = future. */
export function calendarDaysAgo(value: Date | string, now: Date = new Date()): number {
  return differenceInCalendarDays(now, asDate(value))
}

/** "Сегодня" / "Вчера" / "14 МАЯ" relative to `now` (local time). */
export function relativeDayLabel(value: Date | string, options: DateLabelOptions = {}): string {
  const diffDays = calendarDaysAgo(value, options.now ?? new Date())
  if (diffDays === 0) return todayLabel(options.locale)
  if (diffDays === 1) return yesterdayLabel(options.locale)
  return shortDayLabel(value, options.locale).toUpperCase()
}

/** Numeric date-time label for status lines: "17.08.2026, 14:30". */
export function dateTimeLabel(value: Date | string, locale: string = DEFAULT_DATE_LOCALE): string {
  const pattern = locale.toLowerCase().startsWith('ru') ? 'dd.MM.yyyy, HH:mm' : 'MMM d, yyyy, h:mm a'
  return format(asDate(value), pattern, { locale: resolveDateLocale(locale) })
}
