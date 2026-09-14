import { describe, expect, it } from 'vitest'
import { AVAILABLE_CURRENCIES, DEFAULT_CURRENCY, isCurrencyCode } from './currencies'
import { formatMoney } from './format'

describe('currency catalog', () => {
  it('exposes the 18-currency catalog, all two-decimal', () => {
    expect(AVAILABLE_CURRENCIES).toEqual([
      'USD', 'EUR', 'RUB', 'GBP', 'CNY', 'TRY', 'PLN', 'GEL', 'KZT',
      'UAH', 'AMD', 'AZN', 'UZS', 'KGS', 'RSD', 'ILS', 'AED', 'THB',
    ])
    for (const code of AVAILABLE_CURRENCIES) {
      expect(isCurrencyCode(code)).toBe(true)
    }
  })

  it('keeps RUB as the fallback default and rejects non-catalog codes', () => {
    expect(DEFAULT_CURRENCY).toBe('RUB')
    expect(isCurrencyCode('JPY')).toBe(false)
    expect(isCurrencyCode('rub')).toBe(false)
    expect(isCurrencyCode(42)).toBe(false)
  })

  it('formats the previously unsupported catalog currencies natively', () => {
    const ru = 'ru'
    expect(formatMoney(124_000, 'USD', ru)).toBe('1\u202F240,00\u00A0$')
    expect(formatMoney(100_000, 'TRY', ru)).toBe('1\u202F000,00\u00A0₺')
    expect(formatMoney(250_000, 'UAH', ru)).toBe('2\u202F500,00\u00A0₴')
    expect(formatMoney(100_000, 'PLN', 'en')).toBe('zł1,000.00')
    // No narrow symbol in common use: falls back to the ISO code.
    expect(formatMoney(500_000, 'UZS', ru)).toBe('5\u202F000,00\u00A0UZS')
  })
})
