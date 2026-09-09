// Display formatting for amounts, shared by the dashboard and the
// transactions tab: single-currency amounts via @trata/money
// (integer minor units, Intl-free). Date labels live in @trata/dates.

import { formatMoney, type CurrencyCode } from '@trata/money'

export const DEFAULT_CURRENCY: CurrencyCode = 'RUB'
const RU_LOCALE = 'ru'

/**
 * Compact amount for the reference look: "26 813 ₽" instead of the money
 * package's always-two-digits "26 813,00 ₽".
 */
export function formatAmount(amountMinor: number): string {
  const formatted = formatMoney(amountMinor, DEFAULT_CURRENCY, RU_LOCALE)
  return formatted.replace(/,00(?=\u00A0)/, '')
}
