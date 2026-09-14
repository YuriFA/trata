import { describe, it, expect } from 'vitest'
import {
  AVAILABLE_CURRENCIES,
  DEFAULT_CURRENCY,
  CURRENCY_MAP,
  isCurrencyCode,
  getDineroCurrency,
} from './currencies'

describe('currencies', () => {
  it('exports the fixed two-decimal currency catalog', () => {
    // The coordinated catalog (ADR-0008): every entry has two decimals so
    // the single minor-unit divisor (100) holds at every boundary. Zero-
    // and three-decimal currencies (JPY, KWD) are deliberately excluded.
    expect(AVAILABLE_CURRENCIES).toHaveLength(19)
    for (const code of ['USD', 'EUR', 'RUB', 'GBP', 'CNY', 'TRY', 'PLN', 'GEL', 'BYN']) {
      expect(AVAILABLE_CURRENCIES).toContain(code)
    }
    for (const code of ['JPY', 'KRW', 'KWD', 'BHD']) {
      expect(AVAILABLE_CURRENCIES).not.toContain(code)
    }
  })

  it('defaults to RUB (the household base and display fallback)', () => {
    expect(DEFAULT_CURRENCY).toBe('RUB')
  })

  it('maps each code to a dinero currency with code/base/exponent', () => {
    for (const code of AVAILABLE_CURRENCIES) {
      const currency = CURRENCY_MAP[code]
      expect(currency.code).toBe(code)
      expect(currency.base).toBe(10)
      expect(currency.exponent).toBe(2)
    }
  })

  it('exposes getDineroCurrency lookup', () => {
    expect(getDineroCurrency('USD').code).toBe('USD')
    expect(getDineroCurrency('EUR').code).toBe('EUR')
    expect(getDineroCurrency('RUB').code).toBe('RUB')
  })
})

describe('isCurrencyCode', () => {
  it('returns true for supported codes', () => {
    expect(isCurrencyCode('USD')).toBe(true)
    expect(isCurrencyCode('EUR')).toBe(true)
    expect(isCurrencyCode('RUB')).toBe(true)
    expect(isCurrencyCode('GBP')).toBe(true)
    expect(isCurrencyCode('TRY')).toBe(true)
  })

  it('returns false for codes outside the two-decimal catalog', () => {
    expect(isCurrencyCode('JPY')).toBe(false)
    expect(isCurrencyCode('KWD')).toBe(false)
  })

  it('returns false for non-string values', () => {
    expect(isCurrencyCode(null)).toBe(false)
    expect(isCurrencyCode(42)).toBe(false)
    expect(isCurrencyCode(undefined)).toBe(false)
  })
})
