import { createI18n } from 'vue-i18n'

import { messages, type MessageSchema, DEFAULT_LOCALE, type AppLocale } from '@trata/i18n'

// Slavic plural forms for pipe-pluralized messages («операция | операции |
// операций»): vue-i18n's default rule is binary (1 vs other), which picks
// the wrong form for 2-4 and 11-14. Maps counts to the three-form pipe
// indices used by the ru locale.
function slavicPluralRule(choice: number): number {
  const mod100 = Math.abs(choice) % 100
  const mod10 = mod100 % 10
  if (mod10 === 1 && mod100 !== 11) return 0
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 1
  return 2
}

const pluralRules: Partial<Record<AppLocale, (choice: number) => number>> = {
  ru: slavicPluralRule,
}

const i18n = createI18n<MessageSchema, AppLocale, false>({
  legacy: false,
  locale: DEFAULT_LOCALE,
  fallbackLocale: 'en',
  messages,
  pluralRules,
})

export default i18n
