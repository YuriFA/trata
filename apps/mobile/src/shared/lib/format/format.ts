// Display formatting for amounts, shared by the dashboard and the
// transactions tab: single-currency amounts via @trata/money
// (integer minor units, Intl-free). Date labels live in @trata/dates.

import { formatMoney, type CurrencyCode } from '@trata/money'

const RU_LOCALE = 'ru'

/**
 * Compact amount for the reference look: "26 813 ₽" instead of the money
 * package's always-two-digits "26 813,00 ₽". The currency is the amount's
 * NATIVE one (the account's, the debtor's, or the display currency for
 * account-less figures) - never a hardcoded default.
 */
export function formatAmount(amountMinor: number, currency: CurrencyCode): string {
  const formatted = formatMoney(amountMinor, currency, RU_LOCALE)
  return formatted.replace(/,00(?=\u00A0)/, '')
}
