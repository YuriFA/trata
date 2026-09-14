import { describe, it, expect } from 'vitest'
import { aggregateByCurrency, resolveDisplayCurrency, type CurrencyBucket } from './aggregate'
import { DEFAULT_CURRENCY } from '@trata/money'
import type { CurrencyRates } from '@trata/money'

// KZT is deliberately absent: the never-cached pair of the degradation tests.
const USD_RATES: CurrencyRates = {
  base: 'USD',
  rates: { USD: 1, RUB: 90, EUR: 0.9, GEL: 2.7 },
  asOf: '2026-09-14T00:00:00.000Z',
}

describe('resolveDisplayCurrency', () => {
  it('prefers the explicit device setting', () => {
    expect(resolveDisplayCurrency('USD', 'EUR')).toBe('USD')
  })

  it('falls back to the household base currency', () => {
    expect(resolveDisplayCurrency(null, 'EUR')).toBe('EUR')
    expect(resolveDisplayCurrency(undefined, 'EUR')).toBe('EUR')
  })

  it('ends the chain at the catalog default', () => {
    expect(resolveDisplayCurrency(null, null)).toBe(DEFAULT_CURRENCY)
    expect(resolveDisplayCurrency(undefined, undefined)).toBe('RUB')
  })
})

describe('aggregateByCurrency', () => {
  it('sums buckets exactly within one currency', () => {
    const buckets: CurrencyBucket[] = [
      { currency: 'RUB', amount: 20_113 },
      { currency: 'RUB', amount: 10_212 },
    ]
    const aggregate = aggregateByCurrency(buckets, 'RUB', null)

    expect(aggregate.totals).toEqual([{ currency: 'RUB', amount: 30_325 }])
    expect(aggregate.isMixed).toBe(false)
    // Single-currency aggregates stay exact - no conversion, no «≈».
    expect(aggregate.converted).toBeNull()
  })

  it('leaves a single foreign-currency total exact and unconverted', () => {
    const aggregate = aggregateByCurrency([{ currency: 'USD', amount: 5_000 }], 'RUB', USD_RATES)

    expect(aggregate.isMixed).toBe(false)
    expect(aggregate.converted).toBeNull()
  })

  it('converts each bucket once into the display currency', () => {
    const buckets: CurrencyBucket[] = [
      { currency: 'RUB', amount: 19_072_055 },
      { currency: 'USD', amount: 124_000 },
      { currency: 'EUR', amount: 85_000 },
    ]
    const aggregate = aggregateByCurrency(buckets, 'RUB', USD_RATES)

    expect(aggregate.isMixed).toBe(true)
    // $1 240.00 → ₽111 600.00, €850.00 → ₽76 500.00 (each bucket rounded
    // once), plus the native ₽190 720.55.
    expect(aggregate.converted).toEqual({
      currency: 'RUB',
      amount: 11_160_000 + 8_500_000 + 19_072_055,
    })
  })

  it('orders the display currency first, then catalog order', () => {
    const buckets: CurrencyBucket[] = [
      { currency: 'THB', amount: 1 },
      { currency: 'RUB', amount: 2 },
      { currency: 'USD', amount: 3 },
    ]
    const aggregate = aggregateByCurrency(buckets, 'USD', USD_RATES)

    expect(aggregate.totals.map((total) => total.currency)).toEqual(['USD', 'RUB', 'THB'])
  })

  it('omits the converted total when a rate is missing, keeping per-currency figures', () => {
    const buckets: CurrencyBucket[] = [
      { currency: 'RUB', amount: 1_000 },
      { currency: 'GEL', amount: 5_000 },
    ]
    const aggregate = aggregateByCurrency(buckets, 'KZT', USD_RATES)

    expect(aggregate.isMixed).toBe(true)
    expect(aggregate.converted).toBeNull()
    expect(aggregate.totals).toEqual([
      { currency: 'RUB', amount: 1_000 },
      { currency: 'GEL', amount: 5_000 },
    ])
  })

  it('omits the converted total without any cached rates', () => {
    const buckets: CurrencyBucket[] = [
      { currency: 'RUB', amount: 1_000 },
      { currency: 'USD', amount: 100 },
    ]
    const aggregate = aggregateByCurrency(buckets, 'RUB', null)

    expect(aggregate.converted).toBeNull()
    expect(aggregate.totals).toHaveLength(2)
  })
})
