import { enUS, ru } from 'date-fns/locale'
import type { Locale } from 'date-fns/locale'

// TODO(i18n): 'ru' stays the default because the mobile app's display copy is
// Russian; once mobile wires react-i18next, apps should pass the active locale
// from @trata/i18n explicitly.
export const DEFAULT_DATE_LOCALE = 'ru'

/** Resolve a BCP-47 locale string to the closest supported date-fns locale. */
export function resolveDateLocale(locale: string): Locale {
  return locale.toLowerCase().startsWith('ru') ? ru : enUS
}
